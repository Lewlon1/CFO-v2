/**
 * Composition prompt for the ESTIMATE Read (OB-2) — the first thing a user sees
 * after sketching their month from band estimates, BEFORE any statement upload.
 *
 * This is a sibling of the value-first first Read (prompts/first-read.ts), not a
 * mode of it: everything the first Read fetches is transaction-shaped and absent
 * here. The estimate Read stands on the deterministic derive() engine
 * (estimates/derive.ts) plus the user's own verdicts. There are NO merchants,
 * NO dates, NO transactions — inventing any is the hard failure this prompt
 * exists to prevent.
 *
 * Every figure that comes from a band estimate (or anything derived from one) is
 * rendered with a "≈" prefix and is NEVER presented as observed or checked. The
 * one stated fact is income — it carries no ≈. The Read closes by handing the
 * user into the optional statement-check mission that verifies the estimates.
 *
 * Voice / honesty / "— C." sign-off are carried over from the value-first first
 * Read verbatim (thread consistency); only STRUCTURE and the CLOSE differ.
 */

import { currencySymbol, formatMoney } from '@/lib/format/money'
import type { DerivedEstimates } from '@/lib/onboarding-v2/estimates/derive'
import type { FirstReadComposeOutput } from './first-read'

/** The estimate Read reuses the first Read's output shape (message + metadata,
 *  metadata.mode = 'estimate_first'). */
export type EstimateReadComposeOutput = FirstReadComposeOutput

/** A user verdict on one estimated cluster. Stored verbatim in
 *  onboarding_estimates.verdicts. */
export type EstimateVerdict = 'worth_it' | 'leak' | 'unsure'

export interface EstimateReadGoal {
  /** The CFO's short name for the goal (goal-config goalNoun), e.g. "the deposit". */
  noun: string
  /** Provisional target amount (≈-labelled — it's a default, not a stated number). */
  targetAmount: number
  /** Human deadline label, e.g. "in 3 months" / "within 2 years"; null = no date. */
  deadlineLabel: string | null
}

export interface EstimateReadComposeInput {
  currency: string
  goal: EstimateReadGoal | null
  /** Deterministic derive() output — the only source of every figure. */
  derived: DerivedEstimates
  /** The three domain verdicts (each paired in the prompt with the user's own ≈ figure). */
  verdicts: {
    subscriptions: EstimateVerdict | null
    foodOut: EstimateVerdict | null
    drift: EstimateVerdict | null
  }
  /** The user's top-value chip label, or null. */
  topValue: string | null
  /** composite_truer_line — quote-only, optional. */
  truerLine: string | null
  /** The exact "C. knows you · n%" close sentence, quoted VERBATIM in the HANDOFF. */
  knowsYouLine: string
}

export const ESTIMATE_READ_SYSTEM_PROMPT = `You are the user's CFO. They have just walked in and sketched their month for you from quick estimates — a goal, their income, five rough band taps (housing, subscriptions, bills, eating out, what they could save), and a verdict on a few of those. NO statement has been uploaded yet. You have NOT seen a single real transaction.

Your job: write the user's first Read from those estimates. Not a summary — a move. It is honest about being built from their own guesses, lands one concrete action, hands their own verdicts back, and closes by inviting the one thing that turns guesses into facts: checking a real month. Tight, specific, no fluff. Sign off "— C." on its own line.

THE ≈ RULE (this is the spine of the whole Read):
- Every figure below that comes from a band estimate — or anything derived from one (free cash, fixed base, drift, the lever/transfer amount, the goal's monthly pace) — is given to you with a "≈" prefix, e.g. "≈€460". Render it WITH the ≈ every time. These are sketches, not measurements.
- The ONE exception is income: the user stated it, so it carries no ≈.
- NEVER present an ≈ figure as something you observed, checked, confirmed, or saw on a statement. You haven't. There is no statement.

STRUCTURE (this is the contract — POSITION, then one action, then their verdict, then the handoff):
1. POSITION — open on the ≈ free-cash picture and where the goal sits against it: what it needs per month (≈) vs what's free (≈). Use the ESTIMATED FACTS and GOAL figures verbatim; do NOT recompute. Name ONCE, plainly, that this is built from their own estimates and not yet checked — not as an apology, as the honest frame ("This is your sketch, not your statement — but even a sketch this rough tells me…").
2. ONE ACTION — exactly the single move the ACTION block names (the system already chose the branch). Quote its magnitude (≈) verbatim; never compute a new one. If the branch is accuracy-first, the move IS checking, not cutting — say so plainly and do not invent a trim. If it is a payday transfer or a starting transfer, name the ≈ amount and, if a months-sooner figure is given, the impact.
3. THEIR VERDICT — hand back ONE of the user's own verdicts as a given, paired with its ≈ figure and what checking would settle: "You called your ≈€48 of subscriptions a leak — a real month says whether it's that, or just three you forgot." Use the VERDICTS block; quote the ≈ figure that goes with the verdict. Never invent a verdict they didn't give.
4. HANDOFF — what checking adds, in two beats: (a) it swaps every ≈ for a real number — estimate vs reality, side by side; (b) name plainly that the habits half of the picture is still EMPTY — timing, patterns, what's recurring — because estimates can't see it, and only real transactions can. Then the knows-you line VERBATIM from the KNOWS-YOU block, then the CTA on its own line immediately before "— C.": [CTA:start_statement_check]Check my numbers[/CTA].

BANNED IN THE READ:
- Any merchant name, any date, any specific transaction, any count of transactions. None exist. Inventing one is the hard failure.
- Presenting an ≈ figure as observed/checked/confirmed/"your statement shows"/"your transactions".
- Narration of observing: "I see", "I notice", "On reviewing". State what the estimate says.
- Surfacing a figure only to disclaim it past the one honest "this is a sketch" frame.
- A vague question-back close: "What do you think?" / "Does that sound right?".
- Apology or boundary-stating language: "unfortunately", "I'm not able to advise", "I can't recommend", "sorry".
- Emoji. The words "advice" or "advise" anywhere.
- Product names or buy/sell/switch calls on instruments.
- Inventing magnitudes. If a number isn't in the blocks below, you don't have it.
- More than one CTA, or a CTA other than [CTA:start_statement_check].

BOUNDARY (felt, not stated):
Directness applies to behaviour and cash flow — start a transfer, check the numbers, size the gap. A contribution figure is a calculation ("the goal needs ≈€420/mo"), never an instruction to fund a product. No disclaimers, no apologies.

VOICE (Constitution v1.4 §2):
- State findings directly. "Your ≈ free cash is €640 a month" — never "I can see your free cash looks like…". Don't narrate the act of observing.
- Plain English, short sentences, warm authority — not a service desk ("Let me…", "I can help…").
- Second person for the user's facts. First person only when it carries a real stance.

LENGTH & FORMAT:
- Target 120–220 words. A reveal is tight — a few short paragraphs, not an essay.
- Plain prose. The CTA is on its own line, immediately before "— C.".
- Sign off "— C." on its own line.`

function verdictWord(v: EstimateVerdict): string {
  switch (v) {
    case 'worth_it':
      return 'worth it'
    case 'leak':
      return 'a leak'
    case 'unsure':
      return 'unsure'
  }
}

/** Build the user-prompt blocks. Every band-derived figure is ≈-prefixed here so
 *  the model can copy them verbatim; income (stated) is the only bare figure. */
export function buildEstimateReadUserPrompt(input: EstimateReadComposeInput): string {
  const { currency, derived, goal, verdicts } = input
  const symbol = currencySymbol(currency).trim() || currency
  const approx = (v: number) => `≈${formatMoney(Math.round(v), currency)}`
  const money = (v: number) => formatMoney(Math.round(v), currency)

  const sections: string[] = [
    `CURRENCY: All amounts are in ${currency}. Always format money with "${symbol}" — never any other symbol.`,
    ``,
    `WHAT YOU HAVE: the user's own ESTIMATES. No statement, no transactions, no merchants, no dates. Every figure below except stated income is a sketch — render it with its ≈ prefix and never call it observed.`,
    ``,
  ]

  // GOAL block.
  if (goal) {
    const goalLines = [
      `- Goal: ${goal.noun}, target ${approx(goal.targetAmount)}${goal.deadlineLabel ? ` (${goal.deadlineLabel})` : ' (no deadline yet)'}.`,
    ]
    if (derived.requiredMonthly != null && derived.paceVerdict != null) {
      goalLines.push(
        `- Pace it needs: ${approx(derived.requiredMonthly)}/mo` +
          (derived.requiredPctOfIncome != null
            ? ` — that's ≈${derived.requiredPctOfIncome}% of take-home`
            : '') +
          ` (${derived.paceVerdict === 'steep' ? 'STEEP' : 'doable'}).`,
      )
    } else {
      goalLines.push(
        `- No deadline set, so there's no required monthly pace yet — frame the goal as direction, not a dated target.`,
      )
    }
    sections.push(`GOAL:`, goalLines.join('\n'), ``)
  } else {
    sections.push(`GOAL:`, `(none set — lead on the free-cash position itself)`, ``)
  }

  // ESTIMATED FACTS block.
  const factLines = [
    `- Income (STATED — no ≈): ${money(derived.freeCash + derived.fixedBase)}/mo take-home.`,
    `- Fixed base (housing + subs + bills, from band taps): ${approx(derived.fixedBase)}/mo.`,
    `- Free cash after fixed: ${approx(derived.freeCash)}/mo.`,
    `- Eating out (band): ${approx(derived.foodOutMonthly)}/mo.`,
    `- Could-save reach (band): ${approx(derived.saveMonthly)}/mo.`,
    `- Drift (free cash not explained by saving or eating out): ${approx(derived.drift)}/mo.`,
  ]
  sections.push(`ESTIMATED FACTS (band-derived — every line is ≈ except stated income):`, factLines.join('\n'), ``)

  // ACTION block — the single branch the engine chose, with its magnitude.
  const actionLines: string[] = []
  switch (derived.actionBranch) {
    case 'accuracy_first':
      actionLines.push(
        `- BRANCH: accuracy-first. The estimates don't leave honest headroom to suggest a cut, so the move is CHECKING, not cutting. Do NOT invent a trim amount. Frame the action as: one real month settles whether there's room to move at all.`,
      )
      break
    case 'payday_boost':
      actionLines.push(
        `- BRANCH: payday transfer. Set up a standing transfer of ${approx(derived.leverAmount ?? 0)}/mo on payday — sized at about half the drift, so it doesn't bite.`,
      )
      if (derived.monthsAtBoosted != null && derived.monthsAtCurrent != null) {
        actionLines.push(
          `- Months-sooner impact (≈): at that pace ${goal?.noun ?? 'the goal'} lands in ≈${derived.monthsAtBoosted} months instead of ≈${derived.monthsAtCurrent}. Quote both numbers.`,
        )
      }
      break
    case 'starter_transfer':
      actionLines.push(
        `- BRANCH: starting transfer. The save-reach band says nothing is going aside yet, so the first move is STARTING one: a standing transfer of ${approx(derived.starterAmount ?? 0)}/mo on payday. Frame it as starting the habit, not optimising it.`,
      )
      break
  }
  sections.push(`ACTION (the one move — quote the ≈ magnitude verbatim, never compute a new one):`, actionLines.join('\n'), ``)

  // VERDICTS block — hand back ONE, paired with its ≈ figure.
  const verdictLines: string[] = []
  if (verdicts.subscriptions) {
    verdictLines.push(
      `- Subscriptions (${approx(derived.subsMonthly)}/mo): the user called this ${verdictWord(verdicts.subscriptions)}.`,
    )
  }
  if (verdicts.foodOut) {
    verdictLines.push(
      `- Eating out (${approx(derived.foodOutMonthly)}/mo): the user called this ${verdictWord(verdicts.foodOut)}.`,
    )
  }
  if (verdicts.drift) {
    verdictLines.push(
      `- The drift (${approx(derived.drift)}/mo, unexplained): the user called this ${verdictWord(verdicts.drift)}.`,
    )
  }
  sections.push(
    `VERDICTS (the user's own calls — hand back exactly ONE in the THEIR VERDICT beat, paired with its ≈ figure; never invent one they didn't give):`,
    verdictLines.length > 0 ? verdictLines.join('\n') : '(no verdicts captured — skip the THEIR VERDICT beat and go straight to the handoff)',
    ``,
  )

  if (input.topValue) {
    sections.push(
      `TOP VALUE: the user said what matters most to them is "${input.topValue}". You may let it colour the framing in one clause; do not make it the headline.`,
      ``,
    )
  }

  if (input.truerLine) {
    sections.push(
      `TRUER LINE (the user's own words on what would make the sketch truer — quote or paraphrase at most once, never contradict it):`,
      `"${input.truerLine}"`,
      ``,
    )
  }

  sections.push(
    `KNOWS-YOU (the exact close sentence — reproduce it VERBATIM in the HANDOFF, right before the CTA):`,
    input.knowsYouLine,
    ``,
    `COMPOSE THE ESTIMATE READ NOW. POSITION on the ≈ free-cash picture + goal pace (name once it's a sketch, not checked), then the ONE ACTION the ACTION block names with its ≈ magnitude, then hand back ONE verdict with its ≈ figure and what checking settles, then the HANDOFF (estimate-vs-real, habits half named as EMPTY, the knows-you line verbatim) and the [CTA:start_statement_check]Check my numbers[/CTA] line. Output the composed message text only — no markdown fences, no preamble. Sign off "— C." on its own line.`,
  )

  return sections.join('\n')
}
