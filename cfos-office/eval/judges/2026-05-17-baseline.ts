// Baseline champion judge — first version of the self-improving wow-factor judge.
//
// Derived from the v2.2 first-insight judge (tests/onboarding/runner/judge-first-insight.ts)
// but with a unified output schema: a single scalar wow_score in [0,1] plus
// decomposed diagnostic sub-scores. The hard-rule / Likert split from the
// previous design is folded in:
//   - Old Likert dimensions → diagnostic sub-scores (named keys, NOT an array
//     this time — fixes the zod array-vs-object validation bug).
//   - Old hard rules → wow_score penalty in the LLM's own judgment, prompted
//     to apply a meaningful penalty when a key rule fires.
//
// This is the FIRST champion. Subsequent champions will be selected by
// tournament against Lewis's pairwise preferences and live in this same
// directory (with the active one pointed to by ../CHAMPION).

/* eslint-disable @typescript-eslint/no-require-imports */

import { z } from 'zod'
import { generateObject } from 'ai'
import type { JudgeInput, JudgeScore } from '../../scripts/eval/_lib/judge-runner'

// ── Module identity ───────────────────────────────────────────────────────────

export const judgeId = '2026-05-17-baseline'

// ── Output schema ─────────────────────────────────────────────────────────────
// Flat object with explicit keys. The old design had `likert` as either an
// object-with-named-keys OR an array-of-{dimension,score,reason} depending on
// what the LLM emitted; zod rejected the array form. Here every key is named
// at the top level, so no ambiguity.

const JudgeSchema = z.object({
  wow_score: z
    .number()
    .min(0)
    .max(1)
    .describe('Overall wow factor 0-1. Whether the user would feel "this CFO has read me, this is worth paying for".'),
  recognition: z
    .number()
    .min(0)
    .max(1)
    .describe('Does the response feel like the CFO has read the user\'s actual data? Names merchants, real numbers.'),
  goal_calibration: z
    .number()
    .min(0)
    .max(1)
    .describe('Is the insight anchored on the user\'s stated goal or struggle?'),
  surprise: z
    .number()
    .min(0)
    .max(1)
    .describe('Could the user have said this themselves, or is the observation new to them? Higher = more surprising.'),
  trust: z
    .number()
    .min(0)
    .max(1)
    .describe('Calibrated uncertainty — acknowledges what\'s known/unknown. No overreach.'),
  tangibility: z
    .number()
    .min(0)
    .max(1)
    .describe('Comparisons or analogies anchored in this user\'s actual life. Generic comparisons score low.'),
  voice: z
    .number()
    .min(0)
    .max(1)
    .describe('C. peer-tone CFO voice. Specific over vague. No banned phrases ("I noticed", "advice", etc.). Signoff "— C." present.'),
  reasoning: z
    .string()
    .min(10)
    .max(400)
    .describe('1-2 sentences explaining the wow_score. Cite which sub-scores drove the headline.'),
})

// ── Banned phrases (kept from v2.2 judge for voice scoring guidance) ──────────

const BANNED_PHRASES = [
  'worth holding in mind',
  'worth knowing',
  'no judgement',
  'no judgment',
  'I noticed',
  'great question',
  'I learned',
] as const

const BANNED_WORDS_CASE_INSENSITIVE = ['advice', 'advise'] as const

function listBannedPhrases(): string {
  return BANNED_PHRASES.map((p) => `"${p}"`).join(', ')
}

// ── Prompt assembly ───────────────────────────────────────────────────────────

function buildPrompt(input: JudgeInput): string {
  const merchantHint = input.known_merchants.length === 0
    ? '(no known merchants on file — judge specificity by qualitative cues only)'
    : input.known_merchants.slice(0, 25).join(', ')

  return `You are calibrating a financial-coaching CFO assistant. You are scoring a single first-insight response on its "wow factor" — would the user feel "this CFO has read my data, this is worth paying for"?

You score a single response (not a pair). You will be re-run on different responses; consistency across runs matters.

## What the response is

The "first insight" is the CFO's FIRST message to the user after they upload their bank data. It should make them feel seen — name real merchants, anchor on their goal, surface something they couldn't have said themselves, sign off "— C.".

## User context

Brief (in their own words):
${input.user_brief || '(none provided)'}

Known merchants in the last 90 days of transactions (the judge's grounding for specificity):
${merchantHint}

## CFO voice rules (failing these tanks the voice sub-score)

- First-person "you" / "your" addressed at the user; signoff "— C." on its own line
- Specific merchants and amounts > aggregates and percentages
- 100–180 words for the body (excluding signoff and [OPTIONS] block)
- Banned phrases: ${listBannedPhrases()}; banned words: ${BANNED_WORDS_CASE_INSENSITIVE.join(', ')}
- No projections without grounding (e.g. "€500/year saved" must trace to a tool output)

## Response under evaluation

\`\`\`
${input.response.text}
\`\`\`

Tool calls the model made (for ground truth on what the prose can legitimately cite):
${input.response.tool_calls.length === 0
  ? '(no tool calls — prose claims must be self-grounded in the brief above)'
  : input.response.tool_calls.map((t, i) => `${i + 1}. ${t.toolName}`).join('\n')}

## Scoring

Score each dimension 0–1. Use the full range — 0.5 is neutral, not the default.

- **recognition** — Does the prose name specific merchants from the known list? Cite real amounts that the tool calls would plausibly produce? Anchor on dates/days-of-week? Pure aggregates ("travel", "subscriptions") with no named merchant scores ≤ 0.3.
- **goal_calibration** — Does the insight land *against* the user's brief? Not just mention the goal — tie the observation to it. If the brief is empty, score 0.5 (neutral).
- **surprise** — Could the user have said this themselves? Restating the obvious ("you spent €X on category Y") scores low; a non-obvious pattern (concentration in a time window, hidden cluster) scores high.
- **trust** — Calibrated uncertainty. Hedges when the signal is thin (e.g. "based on 4 months"), doesn't overreach with projections. Over-hedging on clear data also hurts.
- **tangibility** — Comparisons anchored in this user's life ("a weekend in Lisbon every month" only if Lisbon is in their data). Generic comparisons ("a Netflix subscription") score ≤ 0.3.
- **voice** — Peer-tone, sharp, no banned phrases/words, signoff present, body length roughly 100–180 words.

Then **wow_score**: your overall judgment, expressing whether this response would make the user feel seen enough to come back. Use a weighted blend of the above but apply your judgment — a response with great specificity but condescending voice is not wow; a response with average voice but a genuinely surprising observation can still be wow. Anchor: 0.4 = passable; 0.6 = solid; 0.8 = genuine wow moment.

**reasoning**: 1–2 sentences. Name the 1–2 sub-scores that drove the headline. Be concrete (cite the specific noun or pattern). Avoid hedge-words like "could be improved" — say what's missing.

Return strictly the structured output.`
}

// ── Score entry point ─────────────────────────────────────────────────────────

export async function score(input: JudgeInput): Promise<JudgeScore> {
  // Lazy require to avoid loading the model client at module-import time —
  // tests and pair-storage helpers that just touch the types shouldn't need
  // Bedrock credentials in env.
  const { utilityModel } = require('../../src/lib/ai/provider')

  const { object } = await generateObject({
    model: utilityModel,
    schema: JudgeSchema,
    prompt: buildPrompt(input),
  })

  return {
    wow_score: object.wow_score,
    diagnostic: {
      recognition: object.recognition,
      goal_calibration: object.goal_calibration,
      surprise: object.surprise,
      trust: object.trust,
      tangibility: object.tangibility,
      voice: object.voice,
    },
    reasoning: object.reasoning,
  }
}
