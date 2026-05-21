import { generateObject } from 'ai'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { utilityModel, utilityModelId } from '@/lib/ai/provider'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
import { logBedrockUsage } from '@/lib/ai/usage-logger'
import type { HypothesisSourceSignals } from './source-signals'

export const HypothesisLineSchema = z.object({
  text: z.string().min(20).max(140),
  confidence: z.number().min(0).max(1),
})

export const HypothesisOutputSchema = z.object({
  lines: z.array(HypothesisLineSchema).length(3),
})

export type HypothesisOutput = z.infer<typeof HypothesisOutputSchema>

/**
 * Resolve the system prompt at call time rather than module-load so tests
 * can swap it out (and so a build environment without filesystem access
 * still imports the module cleanly).
 */
function loadSystemPrompt(): string {
  return readFileSync(
    join(process.cwd(), 'src/lib/hypothesis/prompts/hypothesis-system.md'),
    'utf-8',
  )
}

/**
 * Generate a 3-line working hypothesis from source signals.
 * Returns null on any failure (timeout, schema parse error, Bedrock error).
 * The caller falls through to the no-hypothesis path silently.
 */
export async function generateHypothesis(
  signals: HypothesisSourceSignals,
): Promise<HypothesisOutput | null> {
  const startTime = Date.now()
  try {
    const result = await generateObject({
      model: utilityModel,
      temperature: 0.4,
      schema: HypothesisOutputSchema,
      system: loadSystemPrompt(),
      prompt: renderSignalsForLLM(signals),
      maxOutputTokens: 600,
    })

    const durationMs = Date.now() - startTime
    void trackLLMUsage({
      userId: signals.user_id,
      callType: 'hypothesis_generation',
      model: utilityModelId,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      durationMs,
    })

    logBedrockUsage({
      callSite: 'hypothesis_generation',
      model: 'haiku',
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      userId: signals.user_id,
      conversationId: '',
      timestamp: new Date().toISOString(),
    })

    return result.object
  } catch (err) {
    console.error('[hypothesis] generation failed:', err)
    return null
  }
}

/**
 * Render the source signals into a structured block the LLM can read.
 * NEVER pass raw transactions, merchant names, dates, or money amounts —
 * the model only sees labels. This is the second line of defence after
 * the validator (Phase 4) against the model echoing forbidden content.
 */
export function renderSignalsForLLM(signals: HypothesisSourceSignals): string {
  const lines: string[] = [
    '## User',
    `- Country: ${signals.country ?? 'unknown'}`,
    '',
    '## Income signal',
    `- Confidence: ${labelConfidence(signals.income.confidence)}`,
    `- Cadence: ${signals.income.cadence}`,
    '',
    '## Goal signal',
    signals.goal.present
      ? `- Goal present, type: ${signals.goal.type ?? 'unspecified'}, structure: ${signals.goal.structure_quality}`
      : '- No goal stated',
    '',
    '## Value Map',
    signals.value_map.completed
      ? `- Archetype: ${signals.value_map.archetype ?? 'unknown'}`
      : '- Not yet completed',
  ]

  if (signals.value_map.dominant_quadrant) {
    lines.push(`- Dominant perception: ${signals.value_map.dominant_quadrant}`)
  }

  if (signals.value_map.has_personal_data) {
    const foundation = signals.value_map.top_foundation_categories.join(', ') || 'none'
    const leak = signals.value_map.top_leak_categories.join(', ') || 'none'
    lines.push(
      `- Personal value profile available. Top Foundation: ${foundation}. Top Leak: ${leak}.`,
    )
  } else {
    lines.push('- Personal value profile not yet derived from real spending.')
  }

  lines.push(
    '',
    '## Behaviour',
    `- ${signals.behaviour.months_of_data} months of data, discipline read: ${signals.behaviour.discipline_label}`,
    `- Subscription density: ${signals.behaviour.subscription_density}`,
    `- Zero-spend days in window: ${signals.behaviour.has_zero_spend_days ? 'yes' : 'no'}`,
    '',
    '## Entry',
    signals.entry.struggle_type
      ? `- Entry struggle: ${signals.entry.struggle_type}`
      : '- No entry struggle captured',
  )

  return lines.join('\n')
}

export function meanConfidence(lines: HypothesisOutput['lines']): number {
  if (lines.length === 0) return 0
  const m = lines.reduce((a, l) => a + l.confidence, 0) / lines.length
  return Number(m.toFixed(2))
}

function labelConfidence(c: number): 'high' | 'medium' | 'low' {
  if (c >= 0.7) return 'high'
  if (c >= 0.4) return 'medium'
  return 'low'
}
