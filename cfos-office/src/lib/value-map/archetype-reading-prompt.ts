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

// Few-shots — the four seed readings (Builder / Nester / Negotiator /
// Drifter), showing ONLY the reading segment. Each demonstrates the register
// rule for its cell: certain asserts and sharpens, exploring names what is
// unresolved.
const SEED_READINGS: ReadonlyArray<{ facts: ReadingFacts; reading: string }> = [
  {
    facts: {
      family: 'growth',
      certainty: 'certain',
      displayName: 'The Builder',
      receiptHeadline: 'You sorted 10 transactions. 5 went to Investment — about twice the typical rate.',
      receiptBands: '7 quick calls, 2 considered, 1 took real thought.',
      tensionLine:
        'No contradiction in the data. Your sorting and your spending point the same way: forward. The question is only pace.',
    },
    reading:
      'You sort money by what it gets you later, and you barely hesitated doing it. That kind of clarity about direction is rare — most people protect first and build with what’s left. Your numbers should be working as deliberately as you do.',
  },
  {
    facts: {
      family: 'security',
      certainty: 'exploring',
      displayName: 'The Nester',
      receiptHeadline: 'You sorted 9 transactions. 6 went to Foundation — more than most people.',
      receiptBands: '3 quick calls, 4 considered, 2 took real thought. 2 you flagged as hard to call.',
      tensionLine:
        'Nothing contradicts the picture yet. What’s still open is what "enough protection" looks like for you — that line hasn’t been drawn.',
    },
    reading:
      'You build the nest first — most of what you sorted is the ground you stand on. But several of those calls took real thought, which says the line between "this protects me" and "this just feels safe" isn’t settled yet. That line is worth drawing on purpose, not by habit.',
  },
  {
    facts: {
      family: 'agency',
      certainty: 'certain',
      displayName: 'The Negotiator',
      receiptHeadline: 'You sorted 10 transactions. 4 went to Burden — several times the typical rate.',
      receiptBands: '8 quick calls, 2 considered.',
      tensionLine:
        'No contradiction in the data. You know exactly which costs you resent — that list is a negotiation agenda, not a complaint.',
    },
    reading:
      'You called out the costs you resent without blinking — fast, certain, no second-guessing. That’s not grievance, it’s leverage: you already know exactly where the terms are wrong. The work now is renegotiating them, one by one.',
  },
  {
    facts: {
      family: 'candor',
      certainty: 'exploring',
      displayName: 'The Drifter',
      receiptHeadline: 'You sorted 8 transactions. 3 went to Leak — several times the typical rate.',
      receiptBands: '2 quick calls, 3 considered, 3 took real thought. 1 you flagged as hard to call.',
      tensionLine:
        'Nothing contradicts the picture yet. What’s unresolved is which leaks you’d genuinely cut and which you’d quietly keep — both are allowed.',
    },
    reading:
      'You admitted more waste than most people will, and you slowed down over the calls that mattered. The honesty is there; what drifts is the follow-through — naming a leak and deciding about it are different acts. The deciding is the part we do together.',
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
