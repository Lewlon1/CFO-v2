import type { Persona } from './types'

// Fortress: foundation >= 50%. All 10 cards decided (no hard_to_decide).
// Total: 1444.50
//   foundation = rent(950) + groceries(62) + streaming(11) + electricity(67) + gift(35) = 1125 → 77.9%
//   leak       = gym(45) + takeaway(18.50) + clothes(85)                                  = 148.50 → 10.3%
//   burden     = dinner(42)                                                               = 42 → 2.9%
//   investment = learning(29)                                                             = 29 → 2.0%
// Priority: leak<25 ✓, burden<30 ✓, investment<35 ✓, foundation>=50 → fortress ✓

const csvRows: string[] = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  // Salary
  'TRANSFER,2026-01-28,Salary Civil Service,2650.00,GBP,2650.00',
  'TRANSFER,2026-02-28,Salary Civil Service,2650.00,GBP,2850.00',
  'TRANSFER,2026-03-28,Salary Civil Service,2650.00,GBP,2990.00',
  // Rent (share)
  'CARD_PAYMENT,2026-01-01,Rent - Shared house,-650.00,GBP,2000.00',
  'CARD_PAYMENT,2026-02-01,Rent - Shared house,-650.00,GBP,2200.00',
  'CARD_PAYMENT,2026-03-01,Rent - Shared house,-650.00,GBP,2340.00',
  // Bills
  'CARD_PAYMENT,2026-01-05,British Gas,-48.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-05,British Gas,-52.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-05,British Gas,-41.00,GBP,0.00',
  'CARD_PAYMENT,2026-01-06,EDF Electricity,-39.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-06,EDF Electricity,-44.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-06,EDF Electricity,-37.00,GBP,0.00',
  'CARD_PAYMENT,2026-01-10,Council Tax,-98.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-10,Council Tax,-98.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-10,Council Tax,-98.00,GBP,0.00',
  'CARD_PAYMENT,2026-01-12,Virgin Media Broadband,-28.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-12,Virgin Media Broadband,-28.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-12,Virgin Media Broadband,-28.00,GBP,0.00',
  // Mobile
  'CARD_PAYMENT,2026-01-15,Giffgaff Goodybag,-10.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-15,Giffgaff Goodybag,-10.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-15,Giffgaff Goodybag,-10.00,GBP,0.00',
  // Savings transfer
  'TRANSFER,2026-01-30,Savings Transfer,-300.00,GBP,0.00',
  'TRANSFER,2026-02-28,Savings Transfer,-300.00,GBP,0.00',
  'TRANSFER,2026-03-28,Savings Transfer,-300.00,GBP,0.00',
  // Groceries (heavy, Aldi-dominant)
  ...['2026-01-04', '2026-01-11', '2026-01-18', '2026-01-25', '2026-02-01', '2026-02-08', '2026-02-15', '2026-02-22', '2026-03-01', '2026-03-08', '2026-03-15', '2026-03-22', '2026-03-29'].map(
    (d, i) => `CARD_PAYMENT,${d},Aldi,-${(38 + ((i * 3) % 12)).toFixed(2)},GBP,0.00`
  ),
  // Minimal dining out (cheap)
  ...['2026-01-13', '2026-02-10', '2026-03-14'].map(
    (d) => `CARD_PAYMENT,${d},Wetherspoons,-14.50,GBP,0.00`
  ),
  // Essential transport only
  ...['2026-01-03', '2026-01-17', '2026-02-07', '2026-02-21', '2026-03-07', '2026-03-21'].map(
    (d) => `CARD_PAYMENT,${d},National Rail,-12.00,GBP,0.00`
  ),
]

const csvBase64 = Buffer.from(csvRows.join('\n'), 'utf-8').toString('base64')

export const fortressSaver: Persona = {
  id: 'fortress-saver',
  label: 'The Fortress — Saver',
  profile: {
    displayName: 'Sam',
    country: 'GB',
    city: 'Manchester',
    currency: 'GBP',
  },
  valueMapResponses: [
    { cardId: 'vm-rent', quadrant: 'foundation', confidence: 5, firstTapMs: 600, cardTimeMs: 900, deliberationMs: 200 },
    { cardId: 'vm-groceries', quadrant: 'foundation', confidence: 5, firstTapMs: 500, cardTimeMs: 800, deliberationMs: 200 },
    { cardId: 'vm-gym', quadrant: 'leak', confidence: 3, firstTapMs: 2500, cardTimeMs: 3500, deliberationMs: 800 },
    { cardId: 'vm-takeaway', quadrant: 'leak', confidence: 4, firstTapMs: 1400, cardTimeMs: 2000, deliberationMs: 500 },
    { cardId: 'vm-dinner-friends', quadrant: 'burden', confidence: 3, firstTapMs: 2800, cardTimeMs: 3800, deliberationMs: 900 },
    { cardId: 'vm-streaming', quadrant: 'foundation', confidence: 4, firstTapMs: 900, cardTimeMs: 1300, deliberationMs: 300 },
    { cardId: 'vm-learning', quadrant: 'investment', confidence: 3, firstTapMs: 1600, cardTimeMs: 2200, deliberationMs: 500 },
    { cardId: 'vm-electricity', quadrant: 'foundation', confidence: 5, firstTapMs: 500, cardTimeMs: 800, deliberationMs: 200 },
    { cardId: 'vm-clothes', quadrant: 'leak', confidence: 4, firstTapMs: 1800, cardTimeMs: 2400, deliberationMs: 500 },
    { cardId: 'vm-gift', quadrant: 'foundation', confidence: 4, firstTapMs: 1200, cardTimeMs: 1700, deliberationMs: 400 },
  ],
  csv: {
    filename: 'fortress-saver-generic-q1-2026.csv',
    contentBase64: csvBase64,
    expectedBank: 'revolut',
  },
  skipBeats: [],
  expectations: {
    archetype: {
      expectedQuadrant: 'foundation',
      personalityId: 'fortress',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'archetype', 'csv_upload', 'capabilities', 'first_insight', 'handoff'],
    beatsSkipped: [],
    dbAfterHandoff: {
      user_profiles: { primary_currency: 'GBP' },
      financial_portrait: { archetype_name: 'exists' },
      transactions: { countBetween: [30, 70] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      archetype: {
        mustReferenceQuadrant: 'foundation',
        mustMentionOneOf: ['careful', 'fortress', 'foundation', 'disciplined', 'protected'],
      },
      insight: {
        mustReferenceOneOf: ['savings', 'foundation', 'stable', 'buffer'],
        numbersMustMatchCsv: true,
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
