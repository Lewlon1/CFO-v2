/**
 * LLM-as-judge for the current first Read (dev comparison harness; used by
 * scripts/compare-first-insight.ts). Uses the project's utility model (Haiku) —
 * the judge is rubric-driven, not nuanced, so Haiku is the right cost/quality
 * trade-off.
 *
 * Recalibrated to the LIVE composition contract (src/lib/ai/prompts/first-read.ts).
 * The deterministic hard-rule checks shared with the persona suite + the
 * wow-aggregate cron live in src/lib/ai/read-judge.ts; this file is the LLM
 * Likert + qualitative pass for the dev comparison script.
 *
 *   Hard rules (all must pass):
 *     H1  >=1 specific merchant name from the user's transactions
 *     H2  hook ties to stated goal/struggle
 *     H3  no arithmetic violation (no number presented as if computed
 *         in prose that isn't in tool output)
 *     H4  voice compliance (no banned phrases)
 *     H5  signoff "— C." present
 *     H6  body length <= 250 words (excluding signoff and [CTA] markup)
 *     H7  does NOT end on a question back to the user
 *     H8  closes on exactly one [CTA:type]label[/CTA] line; no [OPTIONS] block
 *
 *   Likert 1-5 (mean >=4 required + L6 specifically >=4):
 *     L1  specificity (real vs aggregate)
 *     L2  angle relevance (chosen angle fits user's brief)
 *     L3  voice fidelity (C., not analyst)
 *     L4  CTA quality
 *     L5  uncertainty calibration
 *     L6  would this convert me to keep using the product?
 *
 *   Pass = all H1-H8 + Likert mean >=4 + L6 >=4.
 *
 * Usage:
 *
 *   import { judgeFirstInsight, JudgeOutcome } from './judge-first-insight'
 *   const outcome = await judgeFirstInsight({
 *     response,        // the assistant's text
 *     prompt,          // the system prompt used (provided for context only)
 *     knownMerchants,  // merchant strings from the user's transactions
 *     userBrief,       // entry_brief + entry_struggle + active goals
 *   })
 *
 * No I/O beyond the Bedrock call. The judge does not touch the database.
 */

import { generateObject } from 'ai'
import { z } from 'zod'

// utilityModel = Haiku 4.5 via the standard EU inference profile.
// See cfos-office/src/lib/ai/provider.ts.
import { utilityModel } from '@/lib/ai/provider'

// ─────────────────────────────────────────────────────────────────────────────
// Banned phrases mirror the prod `validateVoice` regex set
// (cfos-office/src/lib/ai/insight-validator.ts). Kept inline rather than
// imported so the judge prompt has a literal list to show the model.
// ─────────────────────────────────────────────────────────────────────────────
const BANNED_PHRASES_LIST = [
  'worth holding in mind',
  'worth knowing',
  'no judgement',
  'no judgment',
  'I noticed',
  'great question',
  'advice',
  'advise',
  'I learned',
]

// ─────────────────────────────────────────────────────────────────────────────
// Output schema. Strict structured shape so callers can rely on it without
// runtime type-guards. `hard_reasons` / `likert_reasons` are partial maps:
// the judge fills in a reason for every false hard rule and every Likert
// score < 4; other entries may be omitted.
// ─────────────────────────────────────────────────────────────────────────────
export const JudgeOutcome = z.object({
  hard: z.object({
    H1: z.boolean(),
    H2: z.boolean(),
    H3: z.boolean(),
    H4: z.boolean(),
    H5: z.boolean(),
    H6: z.boolean(),
    H7: z.boolean(),
    H8: z.boolean(),
  }),
  hard_reasons: z.record(z.string(), z.string()),
  likert: z.object({
    L1: z.number().int().min(1).max(5),
    L2: z.number().int().min(1).max(5),
    L3: z.number().int().min(1).max(5),
    L4: z.number().int().min(1).max(5),
    L5: z.number().int().min(1).max(5),
    L6: z.number().int().min(1).max(5),
  }),
  likert_reasons: z.record(z.string(), z.string()),
  overall_pass: z.boolean(),
})

export type JudgeOutcomeT = z.infer<typeof JudgeOutcome>

export interface JudgeInput {
  /** Final assistant text to score. */
  response: string
  /** The system prompt that produced the response — context only. */
  prompt: string
  /** Merchant strings from the user's transactions (used for H1). */
  knownMerchants: string[]
  /** User's entry brief / goal text (used for H2). */
  userBrief: string
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + ` …[truncated ${s.length - max} chars]`
}

function formatMerchants(merchants: string[], cap = 80): string {
  if (merchants.length === 0) return '(none on file)'
  const slice = merchants.slice(0, cap)
  return slice.map(m => `- ${m}`).join('\n')
}

function buildJudgePrompt(input: JudgeInput): string {
  const bannedList = BANNED_PHRASES_LIST.map(p => `  - "${p}"`).join('\n')
  const merchants = formatMerchants(input.knownMerchants)
  const brief = input.userBrief.trim() || '(no entry brief on file)'

  return `You are a strict rubric-driven judge. Score the assistant response below against the rules.

User's known merchants (last 90 days of transactions — H1 must reference at least one of these by name, fuzzy match allowed for casing and trailing detail):
${truncate(merchants, 4000)}

User's brief / stated goals (H2 must tie to one of these):
${truncate(brief, 1500)}

System prompt that produced the response (context only — do not score the prompt):
${truncate(input.prompt, 8000)}

Assistant response to score:
---
${truncate(input.response, 4000)}
---

HARD RULES — each is a strict boolean. If false, give a one-line reason in hard_reasons keyed by the rule code (e.g. {"H1": "no merchant from the user's transactions appears"}).

  H1: At least one specific merchant name from the user's transactions (above) appears in the response. Aggregate categories ("dining", "your subscriptions") do NOT count — must be a recognisable merchant string.
  H2: The opening hook ties the observation to the user's stated goal or struggle (above). If the brief is empty, mark H2 true.
  H3: No arithmetic violation. Numbers presented in prose as if computed (totals, percentages, averages, projections like "you'd save £X/year") must look like they came from a tool — i.e. round / exact / explainable. Penalise prose-implied maths that the LLM clearly did itself (e.g. "that's roughly 12% of your income"). If the response is purely qualitative, mark H3 true.
  H4: Voice compliance — none of these banned phrases appear (case-insensitive):
${bannedList}
  H5: The response ends with the signoff "— C." (em dash + space + C + period) on its own line or directly after the body.
  H6: Body length is at most 250 words. Exclude the signoff line and the [CTA:…]…[/CTA] markup from the count.
  H7: The response does NOT end on a question back to the user. The current Read closes on a statement (an observation, a sized lever, or — value-first — a statement of curiosity about specific clusters), never "what do you think?" / "does that sound right?". A close whose final prose sentence is a question fails H7.
  H8: The response closes on exactly ONE call to action emitted as [CTA:type]label[/CTA] on its own line just before the signoff. The retired [OPTIONS] chip block must NOT appear. Value-first Reads must use [CTA:start_value_map_real]. If there is no [CTA] line, or more than one, or an [OPTIONS] block is present, H8 fails.

LIKERT 1-5 — each is an integer 1 (worst) to 5 (best). For any score below 4, give a one-line reason in likert_reasons keyed by L1..L6.

  L1: Specificity. Does the response cite real merchants/amounts vs talk in averages and aggregates?
  L2: Angle relevance. Does the chosen angle (what the response chose to highlight) actually fit the user's brief?
  L3: Voice fidelity. Reads like "C." — a sharp, warm, peer-tone CFO. Not analyst, not coach, not therapist.
  L4: CTA quality. Is the closing [CTA:…] concrete, narrative-derived, and actionable (a real next move on the user's own money / a specific labelling ask), not a generic "tell me more"?
  L5: Uncertainty calibration. Hedges where the signal is genuinely thin; doesn't over-caveat where the data is clear.
  L6: Would this convert me to keep using the product? Honest gut-check — is the first thing the user sees from the CFO good enough to make them come back?

OVERALL PASS = all eight hard rules pass AND (L1+L2+L3+L4+L5+L6)/6 >= 4 AND L6 >= 4. Compute overall_pass yourself and return strictly the structured object.`
}

/**
 * Run the judge. Throws if the Bedrock call fails (caller decides whether
 * to swallow). Returns the structured outcome.
 */
export async function judgeFirstInsight(input: JudgeInput): Promise<JudgeOutcomeT> {
  if (!input.response || input.response.trim().length === 0) {
    // Empty response can't pass anything. Short-circuit to a deterministic
    // failure outcome rather than burning a Bedrock call.
    return {
      hard: {
        H1: false, H2: false, H3: false, H4: false,
        H5: false, H6: false, H7: false, H8: false,
      },
      hard_reasons: {
        H1: 'response is empty', H2: 'response is empty', H3: 'response is empty',
        H4: 'response is empty', H5: 'response is empty', H6: 'response is empty',
        H7: 'response is empty', H8: 'response is empty',
      },
      likert: { L1: 1, L2: 1, L3: 1, L4: 1, L5: 1, L6: 1 },
      likert_reasons: { L6: 'empty response' },
      overall_pass: false,
    }
  }

  const judgePrompt = buildJudgePrompt(input)

  const { object } = await generateObject({
    model: utilityModel,
    schema: JudgeOutcome,
    messages: [
      {
        role: 'user',
        content: judgePrompt,
      },
    ],
  })

  return object
}

// Re-export the literal string list so other harness code can render it
// (e.g. in markdown summaries) without duplicating it.
export { BANNED_PHRASES_LIST }
