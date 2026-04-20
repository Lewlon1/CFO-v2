import type { Persona } from './types'

// Drifter: leak >= 25%. Barcelona expat, EUR. Lewis-flavoured profile.
// rent → hard_to_decide. Remaining: 494.50
//   leak        = clothes(85) + takeaway(18.50) + streaming(11) + dinner(42) + gift(35) = 191.50 → 38.7%
//   foundation  = groceries(62) + electricity(67)                                        = 129 → 26.1%
//   investment  = gym(45) + learning(29)                                                 = 74 → 15.0%
//   burden      = 0
// Priority: leak>=25 → drifter ✓ (first threshold checked)

const csvRows: string[] = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  'TRANSFER,2026-01-28,Salary Tech SL,2700.00,EUR,2700.00',
  'TRANSFER,2026-02-28,Salary Tech SL,2700.00,EUR,2900.00',
  'TRANSFER,2026-03-28,Salary Tech SL,2700.00,EUR,2650.00',
  'CARD_PAYMENT,2026-01-01,Alquiler Piso,-950.00,EUR,1750.00',
  'CARD_PAYMENT,2026-02-01,Alquiler Piso,-950.00,EUR,1950.00',
  'CARD_PAYMENT,2026-03-01,Alquiler Piso,-950.00,EUR,1700.00',
  // Bi-monthly gas (Spain quirk)
  'CARD_PAYMENT,2026-01-15,Naturgy Gas,-85.00,EUR,0.00',
  'CARD_PAYMENT,2026-03-15,Naturgy Gas,-78.00,EUR,0.00',
  // Electricity monthly
  'CARD_PAYMENT,2026-01-08,Endesa,-62.00,EUR,0.00',
  'CARD_PAYMENT,2026-02-08,Endesa,-58.00,EUR,0.00',
  'CARD_PAYMENT,2026-03-08,Endesa,-67.00,EUR,0.00',
  'CARD_PAYMENT,2026-01-10,Movistar Fibra,-45.00,EUR,0.00',
  'CARD_PAYMENT,2026-02-10,Movistar Fibra,-45.00,EUR,0.00',
  'CARD_PAYMENT,2026-03-10,Movistar Fibra,-45.00,EUR,0.00',
  // UK student loan (expat signal)
  'TRANSFER,2026-01-15,Student Loans Company,-95.00,GBP,0.00',
  'TRANSFER,2026-02-15,Student Loans Company,-95.00,GBP,0.00',
  'TRANSFER,2026-03-15,Student Loans Company,-95.00,GBP,0.00',
  // Unused gym
  'CARD_PAYMENT,2026-01-15,DIR Eixample Gym,-49.00,EUR,0.00',
  'CARD_PAYMENT,2026-02-15,DIR Eixample Gym,-49.00,EUR,0.00',
  'CARD_PAYMENT,2026-03-15,DIR Eixample Gym,-49.00,EUR,0.00',
  // Multiple subscriptions (the drift)
  'CARD_PAYMENT,2026-01-12,Netflix,-14.99,EUR,0.00',
  'CARD_PAYMENT,2026-02-12,Netflix,-14.99,EUR,0.00',
  'CARD_PAYMENT,2026-03-12,Netflix,-14.99,EUR,0.00',
  'CARD_PAYMENT,2026-01-18,Spotify Premium,-10.99,EUR,0.00',
  'CARD_PAYMENT,2026-02-18,Spotify Premium,-10.99,EUR,0.00',
  'CARD_PAYMENT,2026-03-18,Spotify Premium,-10.99,EUR,0.00',
  'CARD_PAYMENT,2026-01-20,HBO Max,-9.99,EUR,0.00',
  'CARD_PAYMENT,2026-02-20,HBO Max,-9.99,EUR,0.00',
  'CARD_PAYMENT,2026-03-20,HBO Max,-9.99,EUR,0.00',
  'CARD_PAYMENT,2026-01-22,Disney Plus,-8.99,EUR,0.00',
  'CARD_PAYMENT,2026-02-22,Disney Plus,-8.99,EUR,0.00',
  'CARD_PAYMENT,2026-03-22,Disney Plus,-8.99,EUR,0.00',
  // Heavy dining — the leak signature
  ...['2026-01-03', '2026-01-05', '2026-01-09', '2026-01-12', '2026-01-16', '2026-01-19', '2026-01-23', '2026-01-26', '2026-01-30',
      '2026-02-02', '2026-02-06', '2026-02-09', '2026-02-13', '2026-02-17', '2026-02-20', '2026-02-24', '2026-02-27',
      '2026-03-02', '2026-03-06', '2026-03-09', '2026-03-13', '2026-03-17', '2026-03-20', '2026-03-24', '2026-03-27'].map(
    (d, i) => `CARD_PAYMENT,${d},${['Glovo', 'Deliveroo', 'Bar Mut', 'Cerveceria Catalana', 'La Pepita', 'Cafe del Mar', 'Flax & Kale'][i % 7]},-${(18 + ((i * 3) % 28)).toFixed(2)},EUR,0.00`
  ),
  // Groceries
  ...['2026-01-07', '2026-01-14', '2026-01-21', '2026-01-28', '2026-02-04', '2026-02-11', '2026-02-18', '2026-02-25', '2026-03-04', '2026-03-11', '2026-03-18', '2026-03-25'].map(
    (d, i) => `CARD_PAYMENT,${d},Mercadona,-${(48 + ((i * 5) % 18)).toFixed(2)},EUR,0.00`
  ),
  // Impulse shopping
  ...['2026-01-11', '2026-01-24', '2026-02-08', '2026-02-22', '2026-03-05', '2026-03-18', '2026-03-29'].map(
    (d, i) => `CARD_PAYMENT,${d},${['Amazon.es', 'Zara', 'El Corte Ingles', 'FNAC'][i % 4]},-${(32 + ((i * 7) % 40)).toFixed(2)},EUR,0.00`
  ),
]

const csvBase64 = Buffer.from(csvRows.join('\n'), 'utf-8').toString('base64')

export const drifterExpat: Persona = {
  id: 'drifter-expat',
  label: 'The Drifter — Expat',
  profile: {
    displayName: 'Marta',
    country: 'ES',
    city: 'Barcelona',
    currency: 'EUR',
  },
  valueMapResponses: [
    { cardId: 'vm-rent', quadrant: null, confidence: 0, firstTapMs: 5500, cardTimeMs: 7200, deliberationMs: 1500, hardToDecide: true },
    { cardId: 'vm-groceries', quadrant: 'foundation', confidence: 4, firstTapMs: 800, cardTimeMs: 1300, deliberationMs: 300 },
    { cardId: 'vm-gym', quadrant: 'investment', confidence: 2, firstTapMs: 3200, cardTimeMs: 4800, deliberationMs: 1200 },
    { cardId: 'vm-takeaway', quadrant: 'leak', confidence: 2, firstTapMs: 2800, cardTimeMs: 3900, deliberationMs: 900 },
    { cardId: 'vm-dinner-friends', quadrant: 'leak', confidence: 2, firstTapMs: 3500, cardTimeMs: 4800, deliberationMs: 1100 },
    { cardId: 'vm-streaming', quadrant: 'leak', confidence: 4, firstTapMs: 1400, cardTimeMs: 2000, deliberationMs: 500 },
    { cardId: 'vm-learning', quadrant: 'investment', confidence: 2, firstTapMs: 3000, cardTimeMs: 4200, deliberationMs: 1000 },
    { cardId: 'vm-electricity', quadrant: 'foundation', confidence: 5, firstTapMs: 600, cardTimeMs: 900, deliberationMs: 200 },
    { cardId: 'vm-clothes', quadrant: 'leak', confidence: 2, firstTapMs: 2500, cardTimeMs: 3600, deliberationMs: 900 },
    { cardId: 'vm-gift', quadrant: 'leak', confidence: 1, firstTapMs: 4000, cardTimeMs: 5500, deliberationMs: 1300 },
  ],
  csv: {
    filename: 'drifter-expat-revolut-q1-2026.csv',
    contentBase64: csvBase64,
    expectedBank: 'revolut',
  },
  skipBeats: [],
  expectations: {
    archetype: {
      expectedQuadrant: 'leak',
      personalityId: 'drifter',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'archetype', 'csv_upload', 'capabilities', 'first_insight', 'handoff'],
    beatsSkipped: [],
    dbAfterHandoff: {
      /* primary_currency collected post-onboarding in chat, not asserted here */
      financial_portrait: { archetype_name: 'exists' },
      transactions: { countBetween: [70, 120] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      archetype: {
        mustReferenceQuadrant: 'leak',
        mustMentionOneOf: ['drift', 'impulse', 'leak', 'habit', 'small'],
      },
      insight: {
        mustReferenceMerchantsFromCsv: ['glovo', 'deliveroo', 'netflix', 'hbo', 'disney', 'subscription'],
        mustReferenceOneOf: ['subscription', 'dining', 'delivery', 'leak'],
        numbersMustMatchCsv: true,
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
