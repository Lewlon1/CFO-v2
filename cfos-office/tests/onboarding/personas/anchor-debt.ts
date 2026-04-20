import type { Persona } from './types'

// Anchor: burden >= 30%. Debt-heavy profile.
// rent → hard_to_decide. Remaining: 494.50
//   burden     = groceries(62) + takeaway(18.50) + streaming(11) + electricity(67) + clothes(85) = 243.50 → 49.2%
//   investment = gym(45) + dinner(42) + learning(29)                                              = 116 → 23.5%
//   leak       = gift(35)                                                                         = 35 → 7.1%
//   foundation = 0                                                                                = 0
// Priority: leak<25 ✓, burden>=30 → anchor ✓

const csvRows: string[] = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  'TRANSFER,2026-01-28,Salary Retail Co,2300.00,GBP,2300.00',
  'TRANSFER,2026-02-28,Salary Retail Co,2300.00,GBP,2100.00',
  'TRANSFER,2026-03-28,Salary Retail Co,2300.00,GBP,1950.00',
  'CARD_PAYMENT,2026-01-01,Rent,-780.00,GBP,1520.00',
  'CARD_PAYMENT,2026-02-01,Rent,-780.00,GBP,1320.00',
  'CARD_PAYMENT,2026-03-01,Rent,-780.00,GBP,1170.00',
  // Debt repayments — the Anchor signature
  'TRANSFER,2026-01-05,Credit card repayment,-320.00,GBP,0.00',
  'TRANSFER,2026-02-05,Credit card repayment,-320.00,GBP,0.00',
  'TRANSFER,2026-03-05,Credit card repayment,-320.00,GBP,0.00',
  'TRANSFER,2026-01-15,Personal loan payment,-215.00,GBP,0.00',
  'TRANSFER,2026-02-15,Personal loan payment,-215.00,GBP,0.00',
  'TRANSFER,2026-03-15,Personal loan payment,-215.00,GBP,0.00',
  'TRANSFER,2026-01-20,Car finance,-189.00,GBP,0.00',
  'TRANSFER,2026-02-20,Car finance,-189.00,GBP,0.00',
  'TRANSFER,2026-03-20,Car finance,-189.00,GBP,0.00',
  // Bills
  'CARD_PAYMENT,2026-01-08,British Gas,-78.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-08,British Gas,-82.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-08,British Gas,-68.00,GBP,0.00',
  'CARD_PAYMENT,2026-01-12,Council Tax,-115.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-12,Council Tax,-115.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-12,Council Tax,-115.00,GBP,0.00',
  'CARD_PAYMENT,2026-01-14,TalkTalk,-32.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-14,TalkTalk,-32.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-14,TalkTalk,-32.00,GBP,0.00',
  // Basic groceries
  ...['2026-01-06', '2026-01-13', '2026-01-20', '2026-01-27', '2026-02-03', '2026-02-10', '2026-02-17', '2026-02-24', '2026-03-03', '2026-03-10', '2026-03-17', '2026-03-24'].map(
    (d, i) => `CARD_PAYMENT,${d},Morrisons,-${(42 + ((i * 4) % 15)).toFixed(2)},GBP,0.00`
  ),
  // Occasional takeaway
  ...['2026-01-19', '2026-02-11', '2026-03-14'].map(
    (d) => `CARD_PAYMENT,${d},Just Eat,-18.00,GBP,0.00`
  ),
  // Transport minimal
  ...['2026-01-02', '2026-02-02', '2026-03-02'].map(
    (d) => `CARD_PAYMENT,${d},Bus pass monthly,-60.00,GBP,0.00`
  ),
]

const csvBase64 = Buffer.from(csvRows.join('\n'), 'utf-8').toString('base64')

export const anchorDebt: Persona = {
  id: 'anchor-debt',
  label: 'The Anchor — Debt-heavy',
  profile: {
    displayName: 'Riley',
    country: 'GB',
    city: 'Leeds',
    currency: 'GBP',
  },
  valueMapResponses: [
    { cardId: 'vm-rent', quadrant: null, confidence: 0, firstTapMs: 3800, cardTimeMs: 5100, deliberationMs: 1300, hardToDecide: true },
    { cardId: 'vm-groceries', quadrant: 'burden', confidence: 3, firstTapMs: 1800, cardTimeMs: 2500, deliberationMs: 600 },
    { cardId: 'vm-gym', quadrant: 'investment', confidence: 3, firstTapMs: 1500, cardTimeMs: 2200, deliberationMs: 600 },
    { cardId: 'vm-takeaway', quadrant: 'burden', confidence: 2, firstTapMs: 2800, cardTimeMs: 3800, deliberationMs: 900 },
    { cardId: 'vm-dinner-friends', quadrant: 'investment', confidence: 3, firstTapMs: 1900, cardTimeMs: 2600, deliberationMs: 600 },
    { cardId: 'vm-streaming', quadrant: 'burden', confidence: 4, firstTapMs: 1400, cardTimeMs: 2000, deliberationMs: 500 },
    { cardId: 'vm-learning', quadrant: 'investment', confidence: 3, firstTapMs: 1700, cardTimeMs: 2400, deliberationMs: 600 },
    { cardId: 'vm-electricity', quadrant: 'burden', confidence: 4, firstTapMs: 1100, cardTimeMs: 1600, deliberationMs: 400 },
    { cardId: 'vm-clothes', quadrant: 'burden', confidence: 2, firstTapMs: 2500, cardTimeMs: 3400, deliberationMs: 800 },
    { cardId: 'vm-gift', quadrant: 'leak', confidence: 2, firstTapMs: 3200, cardTimeMs: 4400, deliberationMs: 1100 },
  ],
  csv: {
    filename: 'anchor-debt-revolut-q1-2026.csv',
    contentBase64: csvBase64,
    expectedBank: 'revolut',
  },
  skipBeats: [],
  expectations: {
    archetype: {
      expectedQuadrant: 'burden',
      personalityId: 'anchor',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'archetype', 'csv_upload', 'capabilities', 'first_insight', 'handoff'],
    beatsSkipped: [],
    dbAfterHandoff: {
      user_profiles: { primary_currency: 'GBP' },
      financial_portrait: { archetype_name: 'exists' },
      transactions: { countBetween: [40, 70] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      bannedPatterns: [
        'just\\s+(need|have)\\s+to',
        'simply',
        'discipline|willpower',
      ],
      archetype: {
        mustReferenceQuadrant: 'burden',
        mustMentionOneOf: ['weight', 'burden', 'anchor', 'carrying', 'heavy'],
      },
      insight: {
        mustReferenceMerchantsFromCsv: ['credit', 'loan', 'finance'],
        mustReferenceOneOf: ['debt', 'refinance', 'reduce', 'priority'],
        numbersMustMatchCsv: true,
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
