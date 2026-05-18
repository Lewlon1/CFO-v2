import { generateObject } from 'ai'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { utilityModel, utilityModelId } from '@/lib/ai/provider'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
import { logBedrockUsage } from '@/lib/ai/usage-logger'
import { calculateProfileCompleteness } from '@/lib/profiling/engine'

// Post-conversation extractor for profile FIELDS (not behavioural traits).
//
// Complements lib/ai/portrait-extraction.ts, which writes behavioural traits
// to `financial_portrait`. This module writes structured user_profiles fields
// that the live `update_user_profile` tool didn't capture during the chat —
// either because the LLM didn't recognise them, or because the user revealed
// them in passing without an explicit moment for the tool to fire.
//
// Behaviour mirrors portrait-extraction.ts:
//   - same conversation-completed trigger
//   - same Haiku call shape
//   - stamps `conversations.profile_extracted_at` on terminal outcomes
//   - throws on Bedrock or DB failure so the daily cron retries
//
// Confidence rules:
//   - >= 0.7 AND the field is currently NULL on user_profiles → write
//   - 0.4 <= conf < 0.7 → write to profile_extraction_candidates for review
//   - < 0.4 → discard

const profileFieldEnum = z.enum([
  'display_name',
  'age_range',
  'employment_status',
  'net_monthly_income',
  'gross_salary',
  'pay_frequency',
  'housing_type',
  'monthly_rent',
  'relationship_status',
  'partner_employment_status',
  'dependents',
  'country',
  'tax_residency_country',
  'years_in_country',
])

export type ProfileFieldName = z.infer<typeof profileFieldEnum>

export const profileFieldsSchema = z.object({
  candidates: z.array(
    z.object({
      field: profileFieldEnum,
      value: z.union([z.string(), z.number()]),
      currency: z.string().optional().describe('Currency code for amount fields, ISO 4217'),
      confidence: z.number().min(0).max(1),
      evidence: z.string().describe('Verbatim user quote'),
    }),
  ),
})

const MIN_MESSAGES_FOR_EXTRACTION = 4
const AUTO_APPLY_THRESHOLD = 0.7
const CANDIDATE_THRESHOLD = 0.4

// Number-typed columns in user_profiles. Used to coerce the LLM's value
// (which may arrive as a stringified number) before writing.
const NUMBER_FIELDS = new Set<ProfileFieldName>([
  'net_monthly_income',
  'gross_salary',
  'monthly_rent',
  'dependents',
  'years_in_country',
])

export type ExtractProfileFieldsResult =
  | { status: 'skipped'; reason: 'too_few_messages'; applied: 0; candidates: 0 }
  | { status: 'success'; applied: number; candidates: number }

export interface ExtractProfileFieldsParams {
  conversationId: string
  userId: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function stampProfileExtractedAt(supabase: SupabaseClient<any>, conversationId: string): Promise<void> {
  await supabase
    .from('conversations')
    .update({ profile_extracted_at: new Date().toISOString() })
    .eq('id', conversationId)
}

function coerceValue(field: ProfileFieldName, value: string | number): string | number | null {
  if (NUMBER_FIELDS.has(field)) {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n) || n < 0) return null
    return Number(field === 'dependents' || field === 'years_in_country' ? Math.round(n) : n)
  }
  // Text fields — trim and normalise empty to null.
  const s = String(value).trim()
  return s.length > 0 ? s : null
}

export async function extractProfileFields(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  { conversationId, userId }: ExtractProfileFieldsParams,
): Promise<ExtractProfileFieldsResult> {
  const { data: messages } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (!messages || messages.length < MIN_MESSAGES_FOR_EXTRACTION) {
    await stampProfileExtractedAt(supabase, conversationId)
    return { status: 'skipped', reason: 'too_few_messages', applied: 0, candidates: 0 }
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select(
      'display_name, age_range, employment_status, net_monthly_income, gross_salary, pay_frequency, housing_type, monthly_rent, relationship_status, partner_employment_status, dependents, country, tax_residency_country, years_in_country, primary_currency',
    )
    .eq('id', userId)
    .maybeSingle()

  const knownFields: string[] = []
  for (const [k, v] of Object.entries(profile ?? {})) {
    if (k === 'primary_currency') continue
    if (v !== null && v !== undefined && v !== '') {
      knownFields.push(`- ${k}: ${String(v)}`)
    }
  }

  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'USER' : 'CFO'}: ${m.content}`)
    .join('\n\n')

  const prompt = `You are reading a conversation between a user and their personal CFO,
extracting profile FIELDS that the user revealed but were not captured during the chat.

Already known on file (do NOT re-extract these unless the user gave a clearly
newer value):
${knownFields.length > 0 ? knownFields.join('\n') : '(nothing yet)'}

Extractable fields and confidence guidance:

- display_name: text. "I'm Sarah" → 0.95. "my wife Sarah and I" → DO NOT extract.
- age_range: one of '18-24', '25-34', '35-44', '45-54', '55-64', '65+'. Only extract
  when the user states their age directly or maps unambiguously. "I'm 31" → '25-34' at 0.95.
  "I have kids in college" → DO NOT extract.
- employment_status: 'employed' | 'self_employed' | 'student' | 'retired' | 'between_jobs' | 'freelance' | 'other'.
  "I work for the government" → 'employed' at 0.9. "I'm a freelancer" → 'self_employed' or 'freelance' at 0.9.
- net_monthly_income: number, take-home per month. Include currency. "I get £3,400 after tax"
  → 3400 GBP at 0.95. "I make around 60k a year" → DO NOT extract net_monthly_income
  (extract gross_salary if currency is clear).
- gross_salary: number, ANNUAL gross. Currency required. "60k a year" → 60000 + currency at 0.9.
- pay_frequency: 'monthly' | 'weekly' | 'biweekly' | 'irregular'. Only when user states clearly.
- housing_type: 'owner' | 'renter' | 'family' | 'other'. "I bought a flat in 2011" →
  'owner' at 0.85. "we rent" → 'renter' at 0.95. Just having a mortgage in chat doesn't
  imply 'owner' unless they say they bought/own.
- monthly_rent: number, monthly housing payment. Include currency. "rent is 1200" → 1200 + currency at 0.95.
- relationship_status: 'single' | 'partnered' | 'married' | 'divorced'. "my wife" → 'married' at 0.95.
  "we've been together" → 'partnered' at 0.8.
- partner_employment_status: same enum as employment_status. Only when partner is mentioned.
- dependents: integer. "two kids" → 2 at 0.95. "kids" alone (no count) → DO NOT extract.
- country: text country name. "I live in Spain" → 'Spain' at 0.95. Currency symbol alone is
  NOT enough — $ could be US, Canada, Australia.
- tax_residency_country: text. Only when user mentions tax residency explicitly.
- years_in_country: integer. "moved here 5 years ago" → 5 at 0.85.

RULES:
- Only extract what the user STATED. Never infer from indirect cues.
- Return an empty candidates array if nothing meets the bar.
- A single field can only appear once. Pick the highest-confidence quote.
- Use the verbatim user quote in evidence, max ~100 chars.

Conversation transcript:
${transcript}
`

  const startTime = Date.now()
  const { object, usage } = await generateObject({
    model: utilityModel,
    schema: profileFieldsSchema,
    prompt,
  })

  const durationMs = Date.now() - startTime
  void trackLLMUsage({
    userId,
    callType: 'post_conversation_profile_extraction',
    model: utilityModelId,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    durationMs,
    metadata: { conversation_id: conversationId, message_count: messages.length },
  })

  logBedrockUsage({
    callSite: 'profile_extraction',
    model: 'haiku',
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    userId,
    conversationId,
    timestamp: new Date().toISOString(),
  })

  // Apply high-confidence candidates to user_profiles only when the column is
  // currently NULL. Never silently overwrite a value the user has already
  // confirmed elsewhere (structured input, prior turn).
  const fieldsToWrite: Record<string, string | number> = {}
  const candidateRows: Array<{
    field_name: string
    candidate_value: { value: string | number; currency?: string }
    confidence: number
    evidence: string
  }> = []

  for (const candidate of object.candidates) {
    if (candidate.confidence < CANDIDATE_THRESHOLD) continue

    const coerced = coerceValue(candidate.field, candidate.value)
    if (coerced === null) continue

    const currentValue = (profile as Record<string, unknown> | null)?.[candidate.field]
    const fieldIsEmpty = currentValue === null || currentValue === undefined || currentValue === ''

    if (candidate.confidence >= AUTO_APPLY_THRESHOLD && fieldIsEmpty) {
      fieldsToWrite[candidate.field] = coerced
    } else {
      candidateRows.push({
        field_name: candidate.field,
        candidate_value: {
          value: coerced,
          ...(candidate.currency ? { currency: candidate.currency } : {}),
        },
        confidence: candidate.confidence,
        evidence: candidate.evidence,
      })
    }
  }

  let applied = 0
  if (Object.keys(fieldsToWrite).length > 0) {
    const { error } = await supabase
      .from('user_profiles')
      .update({ ...fieldsToWrite, updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (error) throw new Error(`user_profiles update failed: ${error.message}`)
    applied = Object.keys(fieldsToWrite).length

    // Recompute completeness so the profile-completeness UI surface stays
    // accurate without waiting for the next live edit.
    const { data: updatedProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (updatedProfile) {
      const completeness = calculateProfileCompleteness(updatedProfile)
      await supabase
        .from('user_profiles')
        .update({ profile_completeness: completeness })
        .eq('id', userId)
    }
  }

  let candidates = 0
  for (const row of candidateRows) {
    const { error } = await supabase.from('profile_extraction_candidates').insert({
      user_id: userId,
      conversation_id: conversationId,
      field_name: row.field_name,
      candidate_value: row.candidate_value,
      confidence: row.confidence,
      evidence: row.evidence,
    })
    if (error) {
      console.error('[profile-extraction] candidate insert failed:', error.message)
      continue
    }
    candidates++
  }

  await stampProfileExtractedAt(supabase, conversationId)

  return { status: 'success', applied, candidates }
}
