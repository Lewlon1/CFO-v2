import type { Persona } from './types'

// Finance expert. Builder archetype. Wants automation, NOT advice.
// All 10 cards decided. Investment-dominant pattern: rent + gym + dinner +
// learning + gift → investment. Total 1444.50.
//   investment = rent(950) + gym(45) + dinner(42) + learning(29) + gift(35) = 1101 → 76.2%
//   foundation = groceries(62) + streaming(11) + electricity(67)             = 140 → 9.7%
//   leak       = takeaway(18.50) + clothes(85)                               = 103.50 → 7.2%
//   burden     = 0
// Priority: leak<25 ✓, burden<30 ✓, investment>=35 → builder ✓

const csvRows: string[] = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  // High salary
  'TRANSFER,2026-01-28,Salary Bank PLC,6200.00,GBP,6200.00',
  'TRANSFER,2026-02-28,Salary Bank PLC,6200.00,GBP,7100.00',
  'TRANSFER,2026-03-28,Salary Bank PLC,6200.00,GBP,8050.00',
  // Rent
  'CARD_PAYMENT,2026-01-01,Rent Flat Zone 1,-1800.00,GBP,4400.00',
  'CARD_PAYMENT,2026-02-01,Rent Flat Zone 1,-1800.00,GBP,5300.00',
  'CARD_PAYMENT,2026-03-01,Rent Flat Zone 1,-1800.00,GBP,6250.00',
  // Automated investment — the signal
  'TRANSFER,2026-01-02,Vanguard ISA DD,-1666.00,GBP,2734.00',
  'TRANSFER,2026-02-02,Vanguard ISA DD,-1666.00,GBP,3634.00',
  'TRANSFER,2026-03-02,Vanguard ISA DD,-1666.00,GBP,4584.00',
  'TRANSFER,2026-01-02,SIPP contribution,-800.00,GBP,1934.00',
  'TRANSFER,2026-02-02,SIPP contribution,-800.00,GBP,2834.00',
  'TRANSFER,2026-03-02,SIPP contribution,-800.00,GBP,3784.00',
  'TRANSFER,2026-01-03,InvestEngine GIA,-500.00,GBP,1434.00',
  'TRANSFER,2026-02-03,InvestEngine GIA,-500.00,GBP,2334.00',
  'TRANSFER,2026-03-03,InvestEngine GIA,-500.00,GBP,3284.00',
  // Premium professional subs
  'CARD_PAYMENT,2026-01-05,Financial Times,-39.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-05,Financial Times,-39.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-05,Financial Times,-39.00,GBP,0.00',
  'CARD_PAYMENT,2026-01-07,Bloomberg Digital,-34.99,GBP,0.00',
  'CARD_PAYMENT,2026-02-07,Bloomberg Digital,-34.99,GBP,0.00',
  'CARD_PAYMENT,2026-03-07,Bloomberg Digital,-34.99,GBP,0.00',
  'CARD_PAYMENT,2026-01-10,Notion Plus,-10.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-10,Notion Plus,-10.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-10,Notion Plus,-10.00,GBP,0.00',
  'CARD_PAYMENT,2026-01-12,GitHub Pro,-4.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-12,GitHub Pro,-4.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-12,GitHub Pro,-4.00,GBP,0.00',
  'CARD_PAYMENT,2026-01-15,Netflix,-14.99,GBP,0.00',
  'CARD_PAYMENT,2026-02-15,Netflix,-14.99,GBP,0.00',
  'CARD_PAYMENT,2026-03-15,Netflix,-14.99,GBP,0.00',
  'CARD_PAYMENT,2026-01-18,Spotify Premium Family,-16.99,GBP,0.00',
  'CARD_PAYMENT,2026-02-18,Spotify Premium Family,-16.99,GBP,0.00',
  'CARD_PAYMENT,2026-03-18,Spotify Premium Family,-16.99,GBP,0.00',
  // Bills
  'CARD_PAYMENT,2026-01-08,Octopus Energy,-88.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-08,Octopus Energy,-92.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-08,Octopus Energy,-85.00,GBP,0.00',
  'CARD_PAYMENT,2026-01-10,BT Broadband,-42.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-10,BT Broadband,-42.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-10,BT Broadband,-42.00,GBP,0.00',
  // Groceries — Waitrose
  ...['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23', '2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23'].map(
    (d, i) => `CARD_PAYMENT,${d},Waitrose,-${(72 + ((i * 5) % 25)).toFixed(2)},GBP,0.00`
  ),
  // Business lunches
  ...['2026-01-14', '2026-01-28', '2026-02-11', '2026-02-25', '2026-03-11', '2026-03-25'].map(
    (d) => `CARD_PAYMENT,${d},Sweetgreen,-14.50,GBP,0.00`
  ),
]

const csvBase64 = Buffer.from(csvRows.join('\n'), 'utf-8').toString('base64')

export const timeSaverExpert: Persona = {
  id: 'time-saver-expert',
  label: 'The Time-Saver — Finance Expert',
  profile: {
    displayName: 'Dr. Priya',
    country: 'GB',
    city: 'London',
    currency: 'GBP',
  },
  valueMapResponses: [
    { cardId: 'vm-rent', quadrant: 'investment', confidence: 5, firstTapMs: 500, cardTimeMs: 800, deliberationMs: 200 },
    { cardId: 'vm-groceries', quadrant: 'foundation', confidence: 5, firstTapMs: 400, cardTimeMs: 700, deliberationMs: 200 },
    { cardId: 'vm-gym', quadrant: 'investment', confidence: 5, firstTapMs: 500, cardTimeMs: 800, deliberationMs: 200 },
    { cardId: 'vm-takeaway', quadrant: 'leak', confidence: 3, firstTapMs: 1200, cardTimeMs: 1700, deliberationMs: 400 },
    { cardId: 'vm-dinner-friends', quadrant: 'investment', confidence: 5, firstTapMs: 600, cardTimeMs: 900, deliberationMs: 200 },
    { cardId: 'vm-streaming', quadrant: 'foundation', confidence: 4, firstTapMs: 800, cardTimeMs: 1200, deliberationMs: 300 },
    { cardId: 'vm-learning', quadrant: 'investment', confidence: 5, firstTapMs: 500, cardTimeMs: 800, deliberationMs: 200 },
    { cardId: 'vm-electricity', quadrant: 'foundation', confidence: 5, firstTapMs: 400, cardTimeMs: 700, deliberationMs: 200 },
    { cardId: 'vm-clothes', quadrant: 'leak', confidence: 4, firstTapMs: 1000, cardTimeMs: 1400, deliberationMs: 300 },
    { cardId: 'vm-gift', quadrant: 'investment', confidence: 5, firstTapMs: 600, cardTimeMs: 900, deliberationMs: 200 },
  ],
  csv: {
    filename: 'time-saver-expert-revolut-q1-2026.csv',
    contentBase64: csvBase64,
    expectedBank: 'revolut',
  },
  skipBeats: [],
  expectations: {
    archetype: {
      expectedQuadrant: 'investment',
      personalityId: 'builder',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'archetype', 'csv_upload', 'capabilities', 'first_insight', 'handoff'],
    beatsSkipped: [],
    dbAfterHandoff: {
      user_profiles: { primary_currency: 'GBP' },
      financial_portrait: { archetype_name: 'exists' },
      transactions: { countBetween: [50, 90] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      // Critical persona-specific rules: no unsolicited investment advice,
      // no over-explanation of finance basics.
      bannedPatterns: [
        'you\\s+(should|could|might want to)\\s+(invest|save|allocate|consider)',
        'have you thought about',
        '(an ISA|compound interest|diversification)\\s+(is|means)',
      ],
      archetype: {
        mustReferenceQuadrant: 'investment',
        mustAcknowledgeOneOf: ['have a plan', 'know what you', 'clear', 'intentional', 'in control', 'system already', 'dialled in'],
      },
      insight: {
        mustReferenceOneOf: ['track', 'watch', 'flag', 'automate', 'monitor', 'tell you when', 'subscription', 'bill', 'change'],
        numbersMustMatchCsv: true,
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
