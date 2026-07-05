/**
 * Runtime persona-leak sanitiser.
 *
 * The CFO persona forbids first-person speech ("I", "I'd", "let me", "advice"
 * etc. — see system-prompt.ts BASE_PERSONA). Source prompts already enforce
 * this, but the LLM still drifts in production. This module is a runtime
 * guard: detect forbidden patterns in an assistant message; if any are
 * found, rewrite the message with Haiku before persisting to the DB.
 *
 * Clean messages cost nothing (regex only). Dirty messages incur one extra
 * Haiku call but keep the historical record clean — that matters because the
 * persisted text feeds the prompt cache on subsequent turns.
 */

import { generateText } from 'ai'
import { utilityModel, utilityModelId } from './provider'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'

const LEAK_PATTERNS: ReadonlyArray<RegExp> = [
  /\bI'd\b/gi,
  /\bI'll\b/gi,
  /\bI'm\b/gi,
  /\bI\b/g,
  /\bme\b/g,
  /\bmy\b/gi,
  /\blet me\b/gi,
  /\bthe system\b/gi,
  /\bthe app\b/gi,
  /\badvice\b/gi,
  /\badvise\b/gi,
]

export interface LeakReport {
  count: number
  hits: Array<{ pattern: string; matches: number }>
}

export interface SanitiseResult {
  text: string
  leaks_detected: number
  rewritten: boolean
}

export function detectLeaks(text: string): LeakReport {
  const hits = LEAK_PATTERNS.map((re) => ({
    pattern: re.source,
    matches: (text.match(re) ?? []).length,
  })).filter((h) => h.matches > 0)
  return { count: hits.reduce((s, h) => s + h.matches, 0), hits }
}

const REWRITE_PROMPT = (original: string) => `Rewrite the following CFO message to remove all first-person references and forbidden phrases. Keep every number, merchant name, date, percentage, currency symbol, and recommendation exactly the same. Only change the wording.

FORBIDDEN: "I", "me", "my", "I'd", "I'll", "I'm", "let me", "the system", "the app", "advice", "advise".
ALLOWED self-reference (rare): "your CFO". Default to no self-reference at all.

Original:
${original}

Rewritten (same content, no forbidden phrases, no preamble):`

export async function sanitisePersona(text: string): Promise<SanitiseResult> {
  const report = detectLeaks(text)
  if (report.count === 0) {
    return { text, leaks_detected: 0, rewritten: false }
  }

  try {
    const result = await generateText({
      model: utilityModel,
      temperature: 0.2,
      prompt: REWRITE_PROMPT(text),
      maxOutputTokens: 800,
    })
    const rewritten = result.text

    // Usage accounting (previously invisible to llm_usage_log).
    void trackLLMUsage({
      callType: 'persona_sanitiser',
      model: utilityModelId,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      metadata: { leaks_detected: report.count },
    })

    return {
      text: rewritten.trim(),
      leaks_detected: report.count,
      rewritten: true,
    }
  } catch (err) {
    // Never block the message on sanitiser failure — log and pass original through.
    console.error('[persona-sanitiser] Haiku rewrite failed, persisting original', err)
    return { text, leaks_detected: report.count, rewritten: false }
  }
}
