// OB-2 — door classifier (server-only). Free text → internal family, behind a
// deterministic validation gauntlet so an LLM hiccup can never poison the door:
// any parse/allowlist/range/voice failure, or confidence < 0.6, or a timeout,
// degrades cleanly to the chip fallback (the UI offers the four situation
// chips and door_source becomes 'chip').
//
// The gauntlet (validateDoorOutput) is a pure function, unit-tested with canned
// JSON — no live Bedrock in tests. classifyDoor() is the thin runtime wrapper.

import { generateText } from 'ai'

import { utilityModel } from '@/lib/ai/provider'
import {
  DOOR_CONFIG,
  DOOR_FAMILIES,
  type DoorFamily,
} from './door-config'
import {
  DOOR_REFLECTION_MAX_WORDS,
  DOOR_SYSTEM_PROMPT,
  buildDoorUserPrompt,
} from './door-prompt'

/** Below this the family isn't trusted — degrade to the chip fallback. */
export const DOOR_MIN_CONFIDENCE = 0.6

export type DoorClassifyResult =
  | {
      status: 'classified'
      family: DoorFamily
      confidence: number
      /** Validated LLM line, or the family's deterministic fallback if the LLM
       *  line failed the voice gate. Always safe to show. */
      reflection: string
    }
  | { status: 'fallback'; reason: string }

// Phrases a CFO reflection must never contain (case-insensitive substring).
const BANNED_REFLECTION_PHRASES = [
  'as an ai',
  'i think',
  'i can help',
  'let me',
  'advice',
  'advise',
  "cfo's office",
  'unfortunately',
  'sorry',
]

// Emoji / pictographs / variation selectors / regional indicators.
const EMOJI_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u

function isDoorFamily(v: unknown): v is DoorFamily {
  return typeof v === 'string' && (DOOR_FAMILIES as readonly string[]).includes(v)
}

/** Does the reflection pass the deterministic voice gate? */
export function isValidReflection(reflection: unknown): reflection is string {
  if (typeof reflection !== 'string') return false
  const trimmed = reflection.trim()
  if (trimmed.length === 0) return false
  if (trimmed.split(/\s+/).length > DOOR_REFLECTION_MAX_WORDS) return false
  if (trimmed.includes('!') || trimmed.includes('?')) return false
  if (EMOJI_RE.test(trimmed)) return false
  const lower = trimmed.toLowerCase()
  if (BANNED_REFLECTION_PHRASES.some((p) => lower.includes(p))) return false
  return true
}

/** Strip code fences and isolate the first {...} object, then JSON.parse. */
function parseJson(raw: string): unknown {
  const noFences = raw.replace(/```(?:json)?/gi, '').trim()
  const start = noFences.indexOf('{')
  const end = noFences.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(noFences.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * The gauntlet. Pure and deterministic. Given the raw model text, returns a
 * trusted classification or a fallback. A valid family with an invalid voice
 * line still classifies — but with the family's deterministic fallback line,
 * never the unvalidated LLM line.
 */
export function validateDoorOutput(raw: string): DoorClassifyResult {
  const parsed = parseJson(raw)
  if (parsed === null || typeof parsed !== 'object') {
    return { status: 'fallback', reason: 'unparseable' }
  }
  const obj = parsed as Record<string, unknown>

  if (!isDoorFamily(obj.family)) {
    return { status: 'fallback', reason: 'bad_family' }
  }
  const family = obj.family

  const confidence = obj.confidence
  if (typeof confidence !== 'number' || Number.isNaN(confidence) || confidence < 0 || confidence > 1) {
    return { status: 'fallback', reason: 'bad_confidence' }
  }
  if (confidence < DOOR_MIN_CONFIDENCE) {
    return { status: 'fallback', reason: 'low_confidence' }
  }

  // Family + confidence are trusted. The reflection either passes the voice
  // gate (use it) or doesn't (use the deterministic fallback line).
  const reflection = isValidReflection(obj.reflection)
    ? obj.reflection.trim()
    : DOOR_CONFIG[family].fallbackReflection

  return { status: 'classified', family, confidence, reflection }
}

/** Runtime classify. Empty input and any Bedrock failure/timeout degrade to the
 *  chip fallback. ~200 tokens, temp 0, 6s ceiling. */
export async function classifyDoor(rawText: string): Promise<DoorClassifyResult> {
  const text = rawText.trim()
  if (text.length === 0) {
    return { status: 'fallback', reason: 'empty' }
  }
  try {
    const result = await generateText({
      model: utilityModel,
      system: DOOR_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildDoorUserPrompt(text) }],
      temperature: 0,
      maxOutputTokens: 200,
      abortSignal: AbortSignal.timeout(6000),
    })
    return validateDoorOutput(result.text)
  } catch (err) {
    console.error('[classify-door] classification failed:', err)
    return { status: 'fallback', reason: 'error' }
  }
}
