// VM-4 — the archetype reading prompt. The ONLY LLM touchpoint in the
// reveal: 2–3 sentences inside the assigned cell, bridging the receipt and
// the tension line. The system computed the position; the model narrates it.
//
// Constitution pass (v1.5, §1–2): short declarative sentences, second
// person, findings stated directly — no "I can see", no service-desk
// register, no flattery, no roasting, no characterological lecturing, never
// "advice/advise". The reading does NOT sign off "— C." — it renders inside
// a composed reveal, not as a direct message.
//
// Telemetry boundary: the model receives band counts and the pre-rendered
// receipt/tension lines only. Raw deliberation values never enter this file.

import {
  FAMILY_QUADRANT,
  type ArchetypeFamily,
  type CertaintyState,
} from './taxonomy-config'
import { QUADRANTS } from './constants'

export interface ReadingFacts {
  family: ArchetypeFamily
  certainty: CertaintyState
  displayName: string
  /** Deterministic receipt headline — rendered separately, do not restate. */
  receiptHeadline: string
  /** Deterministic band clause — rendered separately, do not restate. */
  receiptBands: string
  /** Deterministic tension line — rendered separately, do not restate. */
  tensionLine: string
}

// Few-shots — the four approved seed readings (Builder / Nester / Negotiator /
// Drifter), approved 2026-06-10. The `reading` fields carry the approved
// READING segments verbatim (VM-5 swap, closing VM-4 finding 2); the approved
// receipt and tension beats are trimmed into the facts block because those
// render deterministically and separately. Each cell demonstrates its register
// rule: certain asserts and sharpens, exploring names what is unresolved.
//
// Facts-block adaptations (structure-forced, not voice changes):
// - Receipt headlines recast into the pinned buildReceiptLines shape; ratio
//   phrases come from the pinned ratioPhrase mapping for the example's counts
//   (Builder: 5 of 11 → ratio 1.57 → 'more than most people'; the approved
//   beat's 'about twice what most people put there' implies a ratio ≥1.6 the
//   counts don't reach).
// - Band clauses recast into the bandSummaryClause shape, counts consistent
//   with the approved beats ('quick on nearly all' / 'several took real
//   thought, two hard to call' / 'no hesitation' / 'a few took some thought').
// - Tension beats kept verbatim from the approved texts.
const SEED_READINGS: ReadonlyArray<{ facts: ReadingFacts; reading: string }> = [
  {
    facts: {
      family: 'growth',
      certainty: 'certain',
      displayName: 'The Builder',
      receiptHeadline: 'You sorted 11 transactions. 5 went to Investment — more than most people.',
      receiptBands: '9 quick calls, 2 considered.',
      tensionLine:
        'One thing doesn’t fit: the category you protected hardest in the sort is the one that’s been shrinking in your actual spending for three months.',
    },
    reading:
      'Money, for you, is a tool with a direction: spending that builds something gets a fast yes, spending that just maintains gets tolerated. You’re not frugal. You’re selective.',
  },
  {
    facts: {
      family: 'security',
      certainty: 'exploring',
      displayName: 'The Nester',
      receiptHeadline: 'You sorted 10 transactions. 6 went to Foundation — more than most people.',
      receiptBands: '3 quick calls, 4 considered, 3 took real thought. 2 you flagged as hard to call.',
      tensionLine:
        'Your transactions back the instinct: almost everything funds the base. The open question is what the base is for.',
    },
    reading:
      'The base matters most: home, stability, the things that keep life running. What’s less settled is where the line sits — some of what you called essential, you hesitated over. That’s not indecision; it’s a map still being drawn.',
  },
  {
    facts: {
      family: 'agency',
      certainty: 'certain',
      displayName: 'The Negotiator',
      receiptHeadline: 'You sorted 10 transactions. 4 went to Burden — about twice the typical rate.',
      receiptBands: '8 quick calls, 2 considered.',
      tensionLine:
        'Three of those four haven’t changed price in over a year — the longest-standing prices anywhere in your fixed costs.',
    },
    reading:
      'You know exactly which costs you resent: necessary, paid on time, and quietly negotiable. That clarity is leverage.',
  },
  {
    facts: {
      family: 'candor',
      certainty: 'exploring',
      displayName: 'The Drifter',
      receiptHeadline: 'You sorted 9 transactions. 3 went to Leak — several times the typical rate.',
      receiptBands: '4 quick calls, 3 considered, 2 took real thought.',
      tensionLine:
        'Those three add up to €112 a month, and two of them you marked as spending you’d cut.',
    },
    reading:
      'That’s rare honesty: you can look at your own spending and name what isn’t earning its place. What’s not yet clear is what you’d want instead.',
  },
]

function factsBlock(facts: ReadingFacts): string {
  const quadrantName = QUADRANTS[FAMILY_QUADRANT[facts.family]]?.name ?? facts.family
  return [
    `Cell: ${facts.displayName} (family: ${facts.family}, leans ${quadrantName}; register: ${facts.certainty})`,
    `Receipt (already shown to the user, do not restate its numbers): ${facts.receiptHeadline} ${facts.receiptBands}`.trim(),
    `Tension line (already shown to the user, do not restate it): ${facts.tensionLine}`,
  ].join('\n')
}

export function buildReadingSystemPrompt(): string {
  const examples = SEED_READINGS.map(
    (ex, i) => `Example ${i + 1}:\n${factsBlock(ex.facts)}\n\nReading:\n${ex.reading}`,
  ).join('\n\n---\n\n')

  return `You are the user's CFO, writing the short reading on their archetype reveal. The system has already classified them — the archetype name, the receipt, and the tension line are computed and rendered separately. Your job is ONLY the reading: 2–3 sentences that bridge the receipt and the tension line, written from inside the assigned cell.

Rules:
- Stay inside the assigned cell. Never rename the archetype, never hedge it toward another one, never invent facts beyond the ones supplied.
- Do not restate the receipt's or tension line's numbers — they are on screen. Interpret, don't repeat.
- Register: when the cell is "certain", assert and sharpen — tell them what their pattern means. When the cell is "exploring", name what is unresolved — an honest open edge, not a verdict.
- Voice: short declarative sentences. Second person. State findings directly — never "I can see", "I noticed", "Let me". No flattery, no roasting, no lecturing, no jargon. Never the words "advice" or "advise".
- Describe what they did, not what kind of person they are.
- Output the reading only: 2–3 sentences, no headers, no sign-off, no quotation marks.

${examples}`
}

export function buildReadingUserMessage(facts: ReadingFacts): string {
  return `${factsBlock(facts)}\n\nReading:`
}

// ── Static fallback blurbs ───────────────────────────────────────────────────
// Shipped in code, constitution-checked. Rendered when Bedrock times out or
// errors — the reveal never blocks on generation. One per cell.

export const STATIC_READINGS: Record<ArchetypeFamily, Record<CertaintyState, string>> = {
  growth: {
    certain:
      'You sort money by what it gets you later, and you didn’t hesitate. Direction isn’t your problem — making the numbers move at the same pace you do is the work.',
    exploring:
      'You lean toward building, but what you’re building toward isn’t fully settled. That’s not a flaw — it’s the first question worth answering together.',
  },
  security: {
    certain:
      'You protect the base first and you know exactly why. The next move isn’t more protection — it’s making the surplus work as hard as the foundations.',
    exploring:
      'You build the nest first, but where "enough protection" ends isn’t drawn yet. Drawing that line on purpose changes what every other euro is allowed to do.',
  },
  agency: {
    certain:
      'You know exactly which costs you resent, and you named them fast. That list isn’t a complaint — it’s a negotiation agenda, and we work it one line at a time.',
    exploring:
      'You carry costs you resent, but which ones you’d actually change is still open. Settling that turns frustration into a to-do list.',
  },
  candor: {
    certain:
      'You called your own waste without flinching — most people can’t. That honesty is the fastest route to found money, and it’s already yours.',
    exploring:
      'You admitted more waste than most people will. What’s unresolved is which leaks you’d genuinely cut and which you’d quietly keep — both are allowed, but the choosing is the work.',
  },
}

export function getStaticReading(family: ArchetypeFamily, certainty: CertaintyState): string {
  return STATIC_READINGS[family][certainty]
}

/** The unnamed fallback state never calls the LLM — one static line. */
export const STILL_READING_BLURB =
  'Your answers didn’t lean hard enough in one direction to name yet — that’s information, not a failure. A few more sessions and the shape shows itself.'
