import { generateText } from 'ai'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { bedrock } from '@/lib/ai/provider'
import { logChatUsage } from '@/lib/chat/cost-tracker'
import {
  buildArchetypePrompt,
  getFallbackArchetype,
  type ArchetypeResult,
} from '@/lib/onboarding/archetype-prompt'
import type { ValueMapResult } from '@/lib/value-map/types'

const BEDROCK_MODEL = process.env.BEDROCK_CLAUDE_MODEL ?? 'eu.anthropic.claude-sonnet-4-6'
const TIMEOUT_MS = 15_000

// ── Validation ────────────────────────────────────────────────────────────────

function validateResponses(responses: unknown): responses is ValueMapResult[] {
  if (!Array.isArray(responses) || responses.length === 0) return false
  return responses.every(
    (r) =>
      typeof r === 'object' &&
      r !== null &&
      'transaction_id' in r &&
      'merchant' in r &&
      'amount' in r &&
      'card_time_ms' in r,
  )
}

function validateArchetype(data: unknown): data is ArchetypeResult {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    typeof d.archetype_name === 'string' &&
    typeof d.archetype_subtitle === 'string' &&
    Array.isArray(d.traits) &&
    d.traits.length === 3 &&
    d.traits.every((t: unknown) => typeof t === 'string') &&
    Array.isArray(d.certainty_areas) &&
    Array.isArray(d.conflict_areas)
  )
}

// ── Parse JSON from LLM response ──────────────────────────────────────────────

function parseArchetypeJSON(text: string): ArchetypeResult | null {
  // Try direct parse first
  try {
    const parsed = JSON.parse(text)
    if (validateArchetype(parsed)) return parsed as ArchetypeResult
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch?.[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim())
        if (validateArchetype(parsed)) return parsed as ArchetypeResult
      } catch {
        // fall through
      }
    }

    // Try finding first { to last }
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1))
        if (validateArchetype(parsed)) return parsed as ArchetypeResult
      } catch {
        // fall through
      }
    }
  }
  return null
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const startTime = Date.now()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { responses, personalityType, userName } = body as {
    responses: unknown
    personalityType: string
    userName: string
  }

  if (!validateResponses(responses)) {
    return NextResponse.json(
      { error: 'Invalid responses: expected array of ValueMapResult objects' },
      { status: 400 },
    )
  }

  if (!personalityType || typeof personalityType !== 'string') {
    return NextResponse.json(
      { error: 'Missing personalityType' },
      { status: 400 },
    )
  }

  // ── Generate archetype via Bedrock ────────────────────────────────────────

  const prompt = buildArchetypePrompt(responses, personalityType, userName || 'there')

  let archetype: ArchetypeResult | null = null
  let usedFallback = false

  try {
    const result = await Promise.race([
      generateText({
        model: bedrock(BEDROCK_MODEL),
        prompt,
        maxOutputTokens: 1024,
        temperature: 0.7,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Bedrock timeout')), TIMEOUT_MS),
      ),
    ])

    archetype = parseArchetypeJSON(result.text)

    // If parse failed, retry once with stricter instructions
    if (!archetype) {
      console.warn('[archetype] First parse failed, retrying with strict format')
      const retryResult = await Promise.race([
        generateText({
          model: bedrock(BEDROCK_MODEL),
          prompt: prompt + '\n\nIMPORTANT: Your response must be ONLY a valid JSON object. No markdown, no explanation, no code fences. Start with { and end with }.',
          maxOutputTokens: 1024,
          temperature: 0.5,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Bedrock retry timeout')), TIMEOUT_MS),
        ),
      ])
      archetype = parseArchetypeJSON(retryResult.text)
    }

    if (!archetype) {
      console.warn('[archetype] Both parse attempts failed, using fallback')
      archetype = getFallbackArchetype(personalityType)
      usedFallback = true
    }
  } catch (err) {
    console.error('[archetype] Bedrock error:', err instanceof Error ? err.message : err)
    archetype = getFallbackArchetype(personalityType)
    usedFallback = true
  }

  // ── Persist to value_map_results ──────────────────────────────────────────

  const { error: updateError } = await supabase
    .from('value_map_results')
    .update({
      archetype_name: archetype.archetype_name,
      archetype_subtitle: archetype.archetype_subtitle,
      full_analysis: JSON.stringify(archetype.traits),
      certainty_areas: archetype.certainty_areas,
      conflict_areas: archetype.conflict_areas,
    })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (updateError) {
    console.error('[archetype] Failed to persist to value_map_results:', updateError)
  }

  // ── Persist to financial_portrait ─────────────────────────────────────────

  const portraitEntries = [
    {
      user_id: user.id,
      trait_type: 'archetype',
      trait_key: 'archetype_name',
      trait_value: archetype.archetype_name,
      confidence: usedFallback ? 0.5 : 0.9,
      evidence: archetype.archetype_subtitle,
      source: 'value_map',
    },
    ...archetype.traits.map((trait, i) => ({
      user_id: user.id,
      trait_type: 'archetype',
      trait_key: `archetype_trait_${i + 1}`,
      trait_value: trait,
      confidence: usedFallback ? 0.5 : 0.85,
      evidence: `From Value Map archetype generation (${archetype!.archetype_name})`,
      source: 'value_map',
    })),
  ]

  for (const entry of portraitEntries) {
    const { error: portraitError } = await supabase
      .from('financial_portrait')
      .upsert(entry, { onConflict: 'user_id,trait_key' })

    if (portraitError) {
      console.error('[archetype] Failed to upsert portrait entry:', entry.trait_key, portraitError)
    }
  }

  // ── Log usage ─────────────────────────────────────────────────────────────

  await logChatUsage({
    profileId: user.id,
    action: 'archetype_generation',
    model: BEDROCK_MODEL,
    durationMs: Date.now() - startTime,
  }).catch(() => {})

  return NextResponse.json({
    archetype,
    usedFallback,
  })
}
