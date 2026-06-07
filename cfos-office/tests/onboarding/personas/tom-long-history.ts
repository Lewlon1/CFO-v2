import type { Persona } from './types'

// Tom — Long history (Session 32 C, persona expansion).
//
// 18 months of imported transactions. The cluster-behaviour engine should
// default its window to 90 days and not let older data corrupt the read.
// This is a regression check: if the windowDays default drifts, the engine
// would pick up Tom's 2024 holidays as "recent" trends.
//
// Stable profile: tech professional, balanced spending, recurring savings
// transfer (the Builder signature). Investments grew over the year; the
// 90-day window should reflect the recent flat plateau, NOT the multi-month
// growth.

function isoDates(start: string, intervalDays: number, count: number): string[] {
  const out: string[] = []
  const base = new Date(start).getTime()
  for (let i = 0; i < count; i++) {
    out.push(new Date(base + i * intervalDays * 86_400_000).toISOString().slice(0, 10))
  }
  return out
}

// Build 18 months Sep 2024 → Mar 2026
const csvRows: string[] = [
  'Type,Started Date,Description,Amount,Currency,Balance',

  // ── Salary: monthly, every 25th ──────────────────────────────────────────
  ...isoDates('2024-09-25', 30, 18).map(
    (d) => `TRANSFER,${d},Salary Lighthouse Labs,4200.00,GBP,0.00`,
  ),

  // ── Rent: monthly, every 1st (£1,420) ────────────────────────────────────
  ...isoDates('2024-09-01', 30, 18).map(
    (d) => `CARD_PAYMENT,${d},Rent — Norwood Lettings,-1420.00,GBP,0.00`,
  ),

  // ── Savings: monthly transfer (£500/m), the Builder signature ────────────
  ...isoDates('2024-09-26', 30, 18).map(
    (d) => `TRANSFER,${d},Stocks & Shares ISA,-500.00,GBP,0.00`,
  ),

  // ── Groceries: weekly Waitrose, gentle £ drift across the year ───────────
  ...isoDates('2024-09-07', 7, 78).map(
    (d, i) => `CARD_PAYMENT,${d},Waitrose,-${(58 + ((i * 3) % 22)).toFixed(2)},GBP,0.00`,
  ),

  // ── Gym: monthly ──────────────────────────────────────────────────────────
  ...isoDates('2024-09-04', 30, 18).map(
    (d) => `CARD_PAYMENT,${d},PureGym Brixton,-22.99,GBP,0.00`,
  ),

  // ── Streaming subs ────────────────────────────────────────────────────────
  ...isoDates('2024-09-12', 30, 18).map(
    (d) => `CARD_PAYMENT,${d},Netflix,-15.99,GBP,0.00`,
  ),
  ...isoDates('2024-09-18', 30, 18).map(
    (d) => `CARD_PAYMENT,${d},Spotify Family,-17.99,GBP,0.00`,
  ),

  // ── Utilities ─────────────────────────────────────────────────────────────
  ...isoDates('2024-09-15', 30, 18).map(
    (d, i) => `CARD_PAYMENT,${d},Octopus Energy,-${(74 + ((i * 5) % 28)).toFixed(2)},GBP,0.00`,
  ),

  // ── Older "drift": 2024 had occasional holiday spending we DON'T want
  //    the 90-day window to surface as recent. These are deliberately
  //    placed in the 2024 portion of the data.
  'CARD_PAYMENT,2024-10-04,Booking.com — Lisbon,-485.00,GBP,0.00',
  'CARD_PAYMENT,2024-10-06,Cervejaria Ramiro,-72.00,GBP,0.00',
  'CARD_PAYMENT,2024-10-07,Pasteis de Belém,-12.00,GBP,0.00',
  'CARD_PAYMENT,2024-11-12,easyJet — return Madrid,-220.00,GBP,0.00',

  // ── Recent (Q1 2026): the steady plateau the first Read should see ───────
  ...['2026-01-08', '2026-01-22', '2026-02-05', '2026-02-19', '2026-03-05', '2026-03-19'].map(
    (d) => `CARD_PAYMENT,${d},Dishoom King's Cross,-44.00,GBP,0.00`,
  ),
  ...['2026-01-14', '2026-02-12', '2026-03-10'].map(
    (d) => `CARD_PAYMENT,${d},Foyles,-28.00,GBP,0.00`,
  ),
]

const csvBase64 = Buffer.from(csvRows.join('\n'), 'utf-8').toString('base64')

export const tomLongHistory: Persona = {
  id: 'tom-long-history',
  label: 'Tom — Long history (18 months)',
  profile: {
    displayName: 'Tom',
    country: 'GB',
    city: 'London',
    currency: 'GBP',
    monthlyIncome: 4000,
    monthlyRent: 1420,
  },
  // Tom is "builder"-shape: investment ≥ 35% of decided. Rent is
  // hard-to-decide (he sees it as background noise after 18 months of paying
  // the same amount, mirrors builder-classic's pattern). Investments are
  // gym + dinner-friends + learning + gift + clothes (he's intentional about
  // a good wardrobe for client meetings). With rent excluded, investment ≈ 60%.
  valueMapResponses: [
    { cardId: 'vm-rent', quadrant: null, confidence: 0, firstTapMs: 3400, cardTimeMs: 4700, deliberationMs: 1100, hardToDecide: true },
    { cardId: 'vm-groceries', quadrant: 'foundation', confidence: 5, firstTapMs: 1000, cardTimeMs: 1500, deliberationMs: 400 },
    { cardId: 'vm-gym', quadrant: 'investment', confidence: 5, firstTapMs: 900, cardTimeMs: 1400, deliberationMs: 400 },
    { cardId: 'vm-takeaway', quadrant: 'leak', confidence: 3, firstTapMs: 2100, cardTimeMs: 2800, deliberationMs: 700 },
    { cardId: 'vm-dinner-friends', quadrant: 'investment', confidence: 4, firstTapMs: 1500, cardTimeMs: 2100, deliberationMs: 500 },
    { cardId: 'vm-streaming', quadrant: 'foundation', confidence: 4, firstTapMs: 1300, cardTimeMs: 1900, deliberationMs: 500 },
    { cardId: 'vm-learning', quadrant: 'investment', confidence: 5, firstTapMs: 1000, cardTimeMs: 1500, deliberationMs: 400 },
    { cardId: 'vm-electricity', quadrant: 'foundation', confidence: 5, firstTapMs: 1100, cardTimeMs: 1600, deliberationMs: 400 },
    { cardId: 'vm-clothes', quadrant: 'investment', confidence: 4, firstTapMs: 1900, cardTimeMs: 2600, deliberationMs: 600 },
    { cardId: 'vm-gift', quadrant: 'investment', confidence: 4, firstTapMs: 1700, cardTimeMs: 2300, deliberationMs: 600 },
  ],
  csv: {
    filename: 'tom-long-history-revolut.csv',
    contentBase64: csvBase64,
    expectedBank: 'revolut',
  },
  expectations: {
    entryStruggle: 'dont_know',
    archetype: {
      expectedQuadrant: 'investment',
      personalityId: 'builder',
    },
    stagesCompleted: [
      'struggle_submitted',
      'goal_done',
      'upload_done',
      'essentials_done',
      'confirm_done',
      'first_read',
    ],
    dbAfterHandoff: {
      user_profiles: { onboarding_step: 'first_read_delivered', onboarding_completed_at: 'not-null' },
      // 18 months: salary x18 + rent x18 + ISA x18 + groceries x78 + gym x18
      // + Netflix x18 + Spotify x18 + utility x18 + holidays + dishoom/foyles
      transactions: { countBetween: [200, 280] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      bannedPatterns: [
        // Failure mode: the 90-day window broken / leak from 2024 holidays.
        'lisbon|madrid|cervejaria|pasteis|easyjet',
      ],
      insight: {
        // The 90-day window should surface the top merchant.
        mustReferenceMerchantsFromCsv: ['rent'],
        mustReferenceOneOf: ['snapshot', 'fixed costs', 'take-home', 'housing'],
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
