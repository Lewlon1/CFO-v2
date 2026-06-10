// VM-4 — deterministic receipt and tension templates.
//
// Every string here is fully computed: card counts and money facts are exact,
// the over-index ratio renders only through the pinned ratio phrase, and
// timing renders only through band counts. No LLM touches these lines —
// they are the verbatim facts the reading bridges.

import { QUADRANTS } from './constants'
import { formatAmount } from './format'
import { bandSummaryClause } from './band-telemetry'
import {
  FAMILY_QUADRANT,
  type ArchetypeFamily,
  type CertaintyState,
} from './taxonomy-config'
import type { ClassificationReceipt } from './classify-archetype'
import type { ValueQuadrant } from './types'

export interface ReceiptLines {
  /** "You sorted 10. Four went to Foundation — more than most people." */
  headline: string
  /** "6 quick calls, 3 considered, 1 took real thought." (empty if unbanded) */
  bands: string
}

function quadrantName(q: ValueQuadrant): string {
  return QUADRANTS[q]?.name ?? q
}

/**
 * The receipt's first sentence mirrors the seed readings' opening shape:
 * what you did, where it leaned, how that compares — counts and the pinned
 * ratio phrase only.
 */
export function buildReceiptLines(
  family: ArchetypeFamily,
  receipt: ClassificationReceipt,
): ReceiptLines {
  const q = FAMILY_QUADRANT[family]
  const familyCount = receipt.countsByQuadrant[q]
  const headline = `You sorted ${receipt.answeredCards} transaction${
    receipt.answeredCards === 1 ? '' : 's'
  }. ${familyCount} went to ${quadrantName(q)} — ${receipt.ratioPhrase ?? 'more than most people'}.`

  const clause = bandSummaryClause(receipt.bands)
  const hard = receipt.bands.hardToCall
  const hardClause = hard > 0 ? ` ${hard} you flagged as hard to call.` : ''
  const bands = clause ? `${clause}.${hardClause}` : hardClause.trim()

  return { headline, bands }
}

// ── Tension lines ────────────────────────────────────────────────────────────

export type TensionType = 'stated_observed_mismatch' | 'protected_but_shrinking' | 'none'

export interface TensionLine {
  type: TensionType
  line: string
}

/**
 * D1 — stated–observed mismatch. The user's sorting says one thing; the
 * trailing three months of displayable value labels say another. Named once,
 * both sides verbatim, no judgement.
 */
export function buildMismatchLine(
  family: ArchetypeFamily,
  statedQuadrant: ValueQuadrant,
  observedQuadrant: ValueQuadrant,
  observedAmount: number,
  totalAmount: number,
  currency: string,
): TensionLine {
  return {
    type: 'stated_observed_mismatch',
    line: `Your sorting leaned ${quadrantName(statedQuadrant)}. The last three months lean ${quadrantName(
      observedQuadrant,
    )}: ${formatAmount(observedAmount, currency)} of ${formatAmount(totalAmount, currency)} sits there. Both can be true — one is what you want, the other is what's happening.`,
  }
}

/**
 * D2 — protected-but-shrinking. Something the user just called Foundation or
 * Investment is quietly declining. Trend percentage is a money fact — exact
 * values allowed.
 */
export function buildShrinkingLine(
  merchant: string,
  quadrant: ValueQuadrant,
  declinePct: number,
  currency: string,
  recentMonthly: number,
): TensionLine {
  return {
    type: 'protected_but_shrinking',
    line: `You called ${merchant} ${quadrantName(quadrant)} — and it's down ${declinePct}% over the last three months, now ${formatAmount(
      recentMonthly,
      currency,
    )} a month. Worth knowing whether that's a choice.`,
  }
}

/**
 * No-tension variants — never invent a tension. Certain register sharpens
 * the position; exploring register names what's still open (the Nester
 * shape: an honest question, not a verdict).
 */
const NO_TENSION_CERTAIN: Record<ArchetypeFamily, string> = {
  growth: 'No contradiction in the data. Your sorting and your spending point the same way: forward. The question is only pace.',
  security: 'No contradiction in the data. You protect the base first and the numbers agree. The next move is making the surplus work as hard as the foundations.',
  agency: 'No contradiction in the data. You know exactly which costs you resent — that list is a negotiation agenda, not a complaint.',
  candor: 'No contradiction in the data. You called your own waste without flinching — most people can’t. That honesty is the fastest route to found money.',
}

const NO_TENSION_EXPLORING: Record<ArchetypeFamily, string> = {
  growth: 'Nothing contradicts the picture yet — but what you’re building toward isn’t settled. That’s the open question worth sitting with.',
  security: 'Nothing contradicts the picture yet. What’s still open is what "enough protection" looks like for you — that line hasn’t been drawn.',
  agency: 'Nothing contradicts the picture yet. What’s unresolved is which of those burdens you’d actually change if it were easy — that’s where we start.',
  candor: 'Nothing contradicts the picture yet. What’s unresolved is which leaks you’d genuinely cut and which you’d quietly keep — both are allowed.',
}

export function buildNoTensionLine(
  family: ArchetypeFamily,
  certainty: CertaintyState,
): TensionLine {
  return {
    type: 'none',
    line: certainty === 'certain' ? NO_TENSION_CERTAIN[family] : NO_TENSION_EXPLORING[family],
  }
}
