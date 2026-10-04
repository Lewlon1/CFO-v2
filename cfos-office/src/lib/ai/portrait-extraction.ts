import { generateObject } from 'ai'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { utilityModel, utilityModelId } from '@/lib/ai/provider'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
import { logBedrockUsage } from '@/lib/ai/usage-logger'
import { refreshMemoryDigests } from '@/lib/memory/digests'

export const traitSchema = z.object({
  new_traits: z.array(
    z.object({
      trait_key: z.string().describe('Short snake_case identifier'),
      trait_value: z.string().describe('Human-readable description of the trait'),
      trait_type: z.string().describe('Category: behavioral, financial_style, personality, value_preference'),
      confidence: z.number().min(0.5).max(1.0),
      evidence: z.string().describe('Quote or paraphrase from conversation'),
    })
  ),
  suggested_follow_ups: z.array(z.string()).describe('Questions to ask in future conversations'),
})

const MIN_MESSAGES_FOR_EXTRACTION = 4

export type ExtractFromConversationResult =
  | { status: 'skipped'; reason: 'too_few_messages'; traits_inserted: 0; follow_ups: 0 }
  | { status: 'success'; traits_inserted: number; follow_ups: number }

export interface ExtractFromConversationParams {
  conversationId: string
  userId: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function stampAnalysedAt(supabase: SupabaseClient<any>, conversationId: string): Promise<void> {
  await supabase
    .from('conversations')
    .update({ analysed_at: new Date().toISOString() })
    .eq('id', conversationId)
}

// Run the post-conversation portrait extractor for a single conversation.
//
// Stamps `conversations.analysed_at` on terminal outcomes (success or
// "too few messages"). Throws on Bedrock or DB failure so callers can alert
// and the daily fallback cron can retry — analysed_at stays NULL on throw.
export async function extractFromConversation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  { conversationId, userId }: ExtractFromConversationParams,
): Promise<ExtractFromConversationResult> {
  const { data: messages } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (!messages || messages.length < MIN_MESSAGES_FOR_EXTRACTION) {
    await stampAnalysedAt(supabase, conversationId)
    return { status: 'skipped', reason: 'too_few_messages', traits_inserted: 0, follow_ups: 0 }
  }

  const { data: existingTraits } = await supabase
    .from('financial_portrait')
    .select('trait_key, trait_value')
    .eq('user_id', userId)
    .is('dismissed_at', null)

  const existingKeys = new Set((existingTraits ?? []).map((t) => t.trait_key))
  const existingList = (existingTraits ?? [])
    .map((t) => `- ${t.trait_key}: ${t.trait_value}`)
    .join('\n')

  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'USER' : 'CFO'}: ${m.content}`)
    .join('\n\n')

  const startTime = Date.now()
  const { object, usage } = await generateObject({
    model: utilityModel,
    schema: traitSchema,
    prompt: `You are analysing a conversation between a user and their personal CFO.
Extract any NEW behavioral traits, patterns, or profile-relevant information
that was revealed but not explicitly captured by a tool call during the conversation.

Current known traits:
${existingList || '(none yet)'}

Conversation transcript:
${transcript}

Rules:
- Only extract traits with confidence >= 0.5
- Don't duplicate existing traits listed above
- Keep trait_value concise but specific
- Return empty arrays if nothing new was found
- Focus on: spending behavior, financial attitudes, life circumstances, goals, personality traits relevant to financial advice`,
  })

  const durationMs = Date.now() - startTime
  void trackLLMUsage({
    userId,
    callType: 'post_conversation_analysis',
    model: utilityModelId,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    durationMs,
    metadata: { conversation_id: conversationId, message_count: messages.length },
  })

  logBedrockUsage({
    callSite: 'portrait',
    model: 'haiku',
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    userId,
    conversationId,
    timestamp: new Date().toISOString(),
  })

  let inserted = 0
  for (const trait of object.new_traits) {
    if (existingKeys.has(trait.trait_key)) continue
    await supabase.from('financial_portrait').upsert(
      {
        user_id: userId,
        trait_type: trait.trait_type,
        trait_key: trait.trait_key,
        trait_value: trait.trait_value,
        confidence: trait.confidence,
        evidence: trait.evidence,
        source: 'post_conversation',
        source_conversation_id: conversationId,
      },
      { onConflict: 'user_id,trait_key' },
    )
    inserted++
  }

  let followUpsWritten = 0
  for (const suggestion of object.suggested_follow_ups) {
    if (!suggestion) continue
    await supabase.from('profiling_queue').insert({
      user_id: userId,
      field: 'follow_up',
      status: 'pending',
      source: 'post_conversation',
      conversation_id: conversationId,
    })
    await supabase.from('financial_portrait').upsert(
      {
        user_id: userId,
        trait_type: 'follow_up_suggestion',
        trait_key: `follow_up_${Date.now()}_${followUpsWritten}`,
        trait_value: suggestion,
        confidence: 0.5,
        evidence: 'Generated from post-conversation analysis',
        source: 'post_conversation',
        source_conversation_id: conversationId,
      },
      { onConflict: 'user_id,trait_key' },
    )
    followUpsWritten++
  }

  await stampAnalysedAt(supabase, conversationId)

  // The prompt no longer carries traits directly — it carries the digest files
  // derived from them, so a trait that never reaches a digest is a trait the CFO
  // never sees. Deterministic and cheap; never throws.
  if (inserted > 0) await refreshMemoryDigests(supabase, userId)

  return {
    status: 'success',
    traits_inserted: inserted,
    follow_ups: object.suggested_follow_ups.length,
  }
}
