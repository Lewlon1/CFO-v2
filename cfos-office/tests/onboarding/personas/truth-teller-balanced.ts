import type { Persona } from './types'

// Truth Teller: no threshold tripped, falls through to default.
// rent + electricity → hard_to_decide. Remaining: 62+45+18.50+42+11+29+85+35 = 327.50
// Assign:
//   foundation: groceries(62) + learning(29) + gift(35)     = 126 → 38.5%
//   investment: gym(45) + dinner(42)                          = 87  → 26.5%
//   burden:     streaming(11) + clothes(85)                   = 96  → 29.3%
//   leak:       takeaway(18.50)                               = 18.50 → 5.6%
// Priority: leak<25 ✓, burden<30 ✓ (29.3), investment<35 ✓, foundation<50 ✓ → truth_teller ✓

const csvRows: string[] = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  'TRANSFER,2026-01-28,Salary TechCo,2800.00,GBP,2800.00',
  'TRANSFER,2026-02-28,Salary TechCo,2800.00,GBP,3100.00',
  'TRANSFER,2026-03-28,Salary TechCo,2800.00,GBP,3250.00',
  'CARD_PAYMENT,2026-01-01,Rent,-900.00,GBP,1900.00',
  'CARD_PAYMENT,2026-02-01,Rent,-900.00,GBP,2200.00',
  'CARD_PAYMENT,2026-03-01,Rent,-900.00,GBP,2350.00',
  'CARD_PAYMENT,2026-01-05,Octopus,-70.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-05,Octopus,-70.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-05,Octopus,-70.00,GBP,0.00',
  // Mixed spending
  ...['2026-01-07', '2026-01-14', '2026-01-21', '2026-01-28', '2026-02-04', '2026-02-11', '2026-02-18', '2026-02-25', '2026-03-04', '2026-03-11', '2026-03-18', '2026-03-25'].map(
    (d, i) => `CARD_PAYMENT,${d},Sainsburys,-${(55 + ((i * 5) % 20)).toFixed(2)},GBP,0.00`
  ),
  ...['2026-01-08', '2026-01-15', '2026-02-05', '2026-02-12', '2026-03-05', '2026-03-12'].map(
    (d) => `CARD_PAYMENT,${d},Dishoom,-35.00,GBP,0.00`
  ),
  ...['2026-01-20', '2026-02-10', '2026-03-08'].map(
    (d) => `CARD_PAYMENT,${d},Amazon UK,-42.00,GBP,0.00`
  ),
  'CARD_PAYMENT,2026-01-15,Netflix,-14.99,GBP,0.00',
  'CARD_PAYMENT,2026-02-15,Netflix,-14.99,GBP,0.00',
  'CARD_PAYMENT,2026-03-15,Netflix,-14.99,GBP,0.00',
  ...['2026-01-03', '2026-01-10', '2026-01-17', '2026-01-24', '2026-02-07', '2026-02-14', '2026-02-21', '2026-03-07', '2026-03-14', '2026-03-21'].map(
    (d) => `CARD_PAYMENT,${d},TfL Travel,-9.40,GBP,0.00`
  ),
]

const csvBase64 = Buffer.from(csvRows.join('\n'), 'utf-8').toString('base64')

export const truthTellerBalanced: Persona = {
  id: 'truth-teller-balanced',
  label: 'The Truth Teller — Balanced',
  profile: {
    displayName: 'Jordan',
    country: 'GB',
    city: 'Bristol',
    currency: 'GBP',
  },
  valueMapResponses: [
    { cardId: 'vm-rent', quadrant: null, confidence: 0, firstTapMs: 4000, cardTimeMs: 5500, deliberationMs: 1200, hardToDecide: true },
    { cardId: 'vm-groceries', quadrant: 'foundation', confidence: 5, firstTapMs: 700, cardTimeMs: 1100, deliberationMs: 300 },
    { cardId: 'vm-gym', quadrant: 'investment', confidence: 4, firstTapMs: 1300, cardTimeMs: 1900, deliberationMs: 500 },
    { cardId: 'vm-takeaway', quadrant: 'leak', confidence: 3, firstTapMs: 2200, cardTimeMs: 3000, deliberationMs: 700 },
    { cardId: 'vm-dinner-friends', quadrant: 'investment', confidence: 4, firstTapMs: 1200, cardTimeMs: 1800, deliberationMs: 500 },
    { cardId: 'vm-streaming', quadrant: 'burden', confidence: 3, firstTapMs: 2500, cardTimeMs: 3300, deliberationMs: 700 },
    { cardId: 'vm-learning', quadrant: 'foundation', confidence: 3, firstTapMs: 1800, cardTimeMs: 2500, deliberationMs: 600 },
    { cardId: 'vm-electricity', quadrant: null, confidence: 0, firstTapMs: 3200, cardTimeMs: 4500, deliberationMs: 1100, hardToDecide: true },
    { cardId: 'vm-clothes', quadrant: 'burden', confidence: 2, firstTapMs: 2800, cardTimeMs: 3900, deliberationMs: 900 },
    { cardId: 'vm-gift', quadrant: 'foundation', confidence: 4, firstTapMs: 1100, cardTimeMs: 1600, deliberationMs: 400 },
  ],
  csv: {
    filename: 'truth-teller-revolut-q1-2026.csv',
    contentBase64: csvBase64,
    expectedBank: 'revolut',
  },
  skipBeats: [],
  expectations: {
    archetype: {
      expectedQuadrant: 'foundation',
      personalityId: 'truth_teller',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'archetype', 'csv_upload', 'capabilities', 'first_insight', 'handoff'],
    beatsSkipped: [],
    dbAfterHandoff: {
      /* primary_currency collected post-onboarding in chat, not asserted here */
      transactions: { countBetween: [30, 70] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      archetype: {
        mustMentionOneOf: ['balance', 'clear', 'mixed', 'truth', 'honest', 'see'],
      },
      insight: {
        numbersMustMatchCsv: true,
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
