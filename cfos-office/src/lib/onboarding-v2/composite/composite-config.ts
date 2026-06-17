// OB-1d — composite persona config (v1).
//
// After the door classifies the user's opening line into a family
// (door/door-config.ts), the office introduces "someone in your situation" —
// a composite persona card with four concrete bullets.
//
// HONESTY FRAMING (binding product decision): these are illustrative
// composites, never presented as real clients. The card label says so in so
// many words, and the fourth bullet frames the fix as "the kind of move that
// fixes it" — it never claims a real outcome for a real person. Editing that
// framing weakens a trust commitment, not just copy.
//
// PINNED-CONTENT DISCIPLINE (same as estimates/bands.ts): every persona,
// bullet, and label is pinned under COMPOSITE_CONFIG_VERSION. Changing any of
// them is a NEW version, never an edit to v1.
//
// Country skins: figures are identical across GB and ES in v1; the currency
// symbol (£/€) is baked into the bullet strings, and merchant names swap —
// delivery is Deliveroo (GB) / Glovo (ES), energy is Octopus (GB) /
// Iberdrola (ES). Copy is English for both countries in v1; Castilian
// localisation is a tracked follow-up, not a render-time concern here.

import type { DoorFamily } from '../door/door-config'

export const COMPOSITE_CONFIG_VERSION = 'v1' as const

export type CompositeCountry = 'GB' | 'ES'

export interface CompositePersona {
  /** Stable identity for telemetry and persistence (family_country). */
  key: string
  name: string
  age: number
  city: string
  /** Exactly four: situation, the steady part, the pattern, the kind of move that fixes it. */
  bullets: [string, string, string, string]
}

export const COMPOSITE_PERSONAS: Record<
  DoorFamily,
  Record<CompositeCountry, CompositePersona>
> = {
  growth: {
    GB: {
      key: 'growth_gb',
      name: 'Callum',
      age: 31,
      city: 'Leeds',
      bullets: [
        "Saving £50,000 for a place — £18,400 in, on track for October 2028 at today's pace.",
        'The locked-in part of the month holds steady at £1,340. Nothing wasted there.',
        '41 Deliveroo orders in 90 days — £486, two-thirds of them after 9pm on weeknights.',
        'The kind of move that fixes it: plan half those orders ahead — £81 a month back, and the place lands in August instead.',
      ],
    },
    ES: {
      key: 'growth_es',
      name: 'Carlos',
      age: 31,
      city: 'Madrid',
      bullets: [
        "Saving €50,000 for a place — €18,400 in, on track for October 2028 at today's pace.",
        'The locked-in part of the month holds steady at €1,340. Nothing wasted there.',
        '41 Glovo orders in 90 days — €486, two-thirds of them after 9pm on weeknights.',
        'The kind of move that fixes it: plan half those orders ahead — €81 a month back, and the place lands in August instead.',
      ],
    },
  },
  security: {
    GB: {
      key: 'security_gb',
      name: 'Dorcas',
      age: 34,
      city: 'Bristol',
      bullets: [
        'In the overdraft the same three days every month — the 25th to the 27th.',
        '£31 a month goes on fees. Never more than £180 spare at any point in 90 days.',
        'Five bills go out just before payday. A calendar problem, not a spending one.',
        'The kind of move that fixes it: shift two payment dates — the dip vanishes, £372 a year back.',
      ],
    },
    ES: {
      key: 'security_es',
      name: 'Lucía',
      age: 34,
      city: 'Valencia',
      bullets: [
        'In the overdraft the same three days every month — the 25th to the 27th.',
        '€31 a month goes on fees. Never more than €180 spare at any point in 90 days.',
        'Five bills go out just before payday. A calendar problem, not a spending one.',
        'The kind of move that fixes it: shift two payment dates — the dip vanishes, €372 a year back.',
      ],
    },
  },
  agency: {
    GB: {
      key: 'agency_gb',
      name: 'Theo',
      age: 29,
      city: 'Manchester',
      bullets: [
        'Three invoices averaging £2,900 — but the gaps between them ran 9 to 47 days.',
        'Spending is the steady one: £1,940 a month, barely moves.',
        'Two tight squeezes in 90 days, both pure timing. Each froze new work for a week.',
        'The kind of move that fixes it: pay yourself £2,100 on the 1st from a holding pot — the bumps stay in the pot.',
      ],
    },
    ES: {
      key: 'agency_es',
      name: 'Marta',
      age: 29,
      city: 'Barcelona',
      bullets: [
        'Three invoices averaging €2,900 — but the gaps between them ran 9 to 47 days.',
        'Spending is the steady one: €1,940 a month, barely moves.',
        'Two tight squeezes in 90 days, both pure timing. Each froze new work for a week.',
        'The kind of move that fixes it: pay yourself €2,100 on the 1st from a holding pot — the bumps stay in the pot.',
      ],
    },
  },
  candor: {
    GB: {
      key: 'candor_gb',
      name: 'Priya',
      age: 36,
      city: 'London',
      bullets: [
        '14 quiet price rises absorbed in a year — £43 a month added without a single decision made.',
        'Statement opened twice in six months. The creep costs £516 a year.',
        'Subscriptions up £19, Octopus up £14, the gym up £10 — none refused, none accepted either.',
        'The kind of move that fixes it: re-decide the top three — about £29 a month back, and the habit of deciding with it.',
      ],
    },
    ES: {
      key: 'candor_es',
      name: 'Andrés',
      age: 36,
      city: 'Sevilla',
      bullets: [
        '14 quiet price rises absorbed in a year — €43 a month added without a single decision made.',
        'Statement opened twice in six months. The creep costs €516 a year.',
        'Subscriptions up €19, Iberdrola up €14, the gym up €10 — none refused, none accepted either.',
        'The kind of move that fixes it: re-decide the top three — about €29 a month back, and the habit of deciding with it.',
      ],
    },
  },
}

/** Card heading above the composite persona. */
export const COMPOSITE_CARD_HEADING = 'Someone in your situation'

/** The honesty label under the heading — names the sketch as a sketch. */
export function compositeCardLabel(name: string): string {
  return `"${name}" is a sketch, not a client — a composite drawn to match situations like yours.`
}

/** "Does this land?" chips under the composite card. */
export const RELATE_OPTIONS = [
  { id: 'spot_on', label: 'Spot on' },
  { id: 'close', label: 'Close enough' },
  { id: 'not_me', label: 'Not really me' },
] as const

export type RelateOptionId = (typeof RELATE_OPTIONS)[number]['id']

/** Free-text prompt shown when the user wants to correct the sketch. */
export const COMPOSITE_TRUER_PROMPT =
  'One line — what would make your version truer?'

export const COMPOSITE_TRUER_PLACEHOLDER =
  "e.g. 'mine's worse since the rent went up'"
