import type { Persona } from './types'

// Builder: investment >= 35%. Strategy: rent marked hard-to-decide (calm,
// neutral), most discretionary spend reframed as investment in growth/
// relationships/taste. Foundation = groceries + bills. Leak = one explicit
// mistake (takeaway on Tuesday).
//
// Decided total (excluding rent 950): 494.50
//   investment = gym(45) + dinner(42) + learning(29) + clothes(85) + gift(35) = 236 → 47.7%
//   foundation = groceries(62) + streaming(11) + electricity(67)           = 140 → 28.3%
//   leak       = takeaway(18.50)                                            = 18.50 → 3.7%
//   burden     = 0
// Priority: leak<25 ✓, burden<30 ✓, investment>=35 → builder ✓

const csvRows: string[] = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  // Salary
  'TRANSFER,2026-01-28,Salary Acme Ltd,3200.00,GBP,3200.00',
  'TRANSFER,2026-02-28,Salary Acme Ltd,3200.00,GBP,3400.00',
  'TRANSFER,2026-03-28,Salary Acme Ltd,3200.00,GBP,3580.00',
  // Rent
  'CARD_PAYMENT,2026-01-01,Rent Landlord,-1100.00,GBP,2100.00',
  'CARD_PAYMENT,2026-02-01,Rent Landlord,-1100.00,GBP,2300.00',
  'CARD_PAYMENT,2026-03-01,Rent Landlord,-1100.00,GBP,2480.00',
  // Utilities
  'CARD_PAYMENT,2026-01-05,Octopus Energy,-68.00,GBP,2032.00',
  'CARD_PAYMENT,2026-02-05,Octopus Energy,-72.00,GBP,2228.00',
  'CARD_PAYMENT,2026-03-05,Octopus Energy,-65.00,GBP,2415.00',
  'CARD_PAYMENT,2026-01-05,Thames Water,-32.00,GBP,2000.00',
  'CARD_PAYMENT,2026-02-05,Thames Water,-32.00,GBP,2196.00',
  'CARD_PAYMENT,2026-03-05,Thames Water,-32.00,GBP,2383.00',
  'CARD_PAYMENT,2026-01-10,BT Broadband,-35.00,GBP,1965.00',
  'CARD_PAYMENT,2026-02-10,BT Broadband,-35.00,GBP,2161.00',
  'CARD_PAYMENT,2026-03-10,BT Broadband,-35.00,GBP,2348.00',
  // Investment — core Builder signal
  'TRANSFER,2026-01-02,Vanguard ISA transfer,-500.00,GBP,1465.00',
  'TRANSFER,2026-02-02,Vanguard ISA transfer,-500.00,GBP,1661.00',
  'TRANSFER,2026-03-02,Vanguard ISA transfer,-500.00,GBP,1848.00',
  // Gym — recurring investment
  'CARD_PAYMENT,2026-01-15,PureGym Membership,-29.99,GBP,1435.01',
  'CARD_PAYMENT,2026-02-15,PureGym Membership,-29.99,GBP,1631.01',
  'CARD_PAYMENT,2026-03-15,PureGym Membership,-29.99,GBP,1818.01',
  // Courses / books (Investment)
  'CARD_PAYMENT,2026-01-18,Udemy course,-25.00,GBP,1410.01',
  'CARD_PAYMENT,2026-02-20,Coursera monthly,-39.00,GBP,1592.01',
  'CARD_PAYMENT,2026-01-22,Waterstones books,-32.50,GBP,1377.51',
  'CARD_PAYMENT,2026-03-22,Waterstones books,-28.00,GBP,1790.01',
  'CARD_PAYMENT,2026-02-25,Masterclass annual,-180.00,GBP,1412.01',
  // Groceries
  ...['2026-01-07', '2026-01-14', '2026-01-21', '2026-01-28', '2026-02-04', '2026-02-11', '2026-02-18', '2026-02-25', '2026-03-04', '2026-03-11', '2026-03-18', '2026-03-25'].map(
    (d, i) => `CARD_PAYMENT,${d},Tesco,-${(55 + ((i * 7) % 25)).toFixed(2)},GBP,0.00`
  ),
  // Healthy dining
  ...['2026-01-09', '2026-01-23', '2026-02-06', '2026-02-20', '2026-03-06', '2026-03-20'].map(
    (d) => `CARD_PAYMENT,${d},Farmer J,-18.50,GBP,0.00`
  ),
  ...['2026-01-16', '2026-02-13', '2026-03-13'].map(
    (d) => `CARD_PAYMENT,${d},Pret A Manger,-8.75,GBP,0.00`
  ),
  // Transport (TfL)
  ...['2026-01-03', '2026-01-10', '2026-01-17', '2026-01-24', '2026-01-31', '2026-02-07', '2026-02-14', '2026-02-21', '2026-02-28', '2026-03-07', '2026-03-14', '2026-03-21', '2026-03-28'].map(
    (d) => `CARD_PAYMENT,${d},TfL Travel Charge,-8.80,GBP,0.00`
  ),
  // Small subscriptions (Foundation/minor Leak)
  'CARD_PAYMENT,2026-01-12,Spotify,-10.99,GBP,0.00',
  'CARD_PAYMENT,2026-02-12,Spotify,-10.99,GBP,0.00',
  'CARD_PAYMENT,2026-03-12,Spotify,-10.99,GBP,0.00',
  'CARD_PAYMENT,2026-01-14,iCloud storage,-2.99,GBP,0.00',
  'CARD_PAYMENT,2026-02-14,iCloud storage,-2.99,GBP,0.00',
  'CARD_PAYMENT,2026-03-14,iCloud storage,-2.99,GBP,0.00',
]

const csvContent = csvRows.join('\n')
const csvBase64 = Buffer.from(csvContent, 'utf-8').toString('base64')

export const builderClassic: Persona = {
  id: 'builder-classic',
  label: 'The Builder — Casual',
  profile: {
    displayName: 'Alex',
    country: 'GB',
    city: 'London',
    currency: 'GBP',
  },
  valueMapResponses: [
    // Rent → hard-to-decide (calm, sees rent as neutral background cost)
    { cardId: 'vm-rent', quadrant: null, confidence: 0, firstTapMs: 3500, cardTimeMs: 4800, deliberationMs: 1100, hardToDecide: true },
    // Groceries → foundation (fast, certain)
    { cardId: 'vm-groceries', quadrant: 'foundation', confidence: 5, firstTapMs: 700, cardTimeMs: 1100, deliberationMs: 200 },
    // Gym → investment (core Builder)
    { cardId: 'vm-gym', quadrant: 'investment', confidence: 5, firstTapMs: 1000, cardTimeMs: 1500, deliberationMs: 300 },
    // Takeaway → leak (clear-eyed about small mistakes)
    { cardId: 'vm-takeaway', quadrant: 'leak', confidence: 3, firstTapMs: 2000, cardTimeMs: 2900, deliberationMs: 700 },
    // Dinner with friends → investment (relationships)
    { cardId: 'vm-dinner-friends', quadrant: 'investment', confidence: 4, firstTapMs: 1400, cardTimeMs: 2100, deliberationMs: 500 },
    // Streaming → foundation (uses it, not a leak)
    { cardId: 'vm-streaming', quadrant: 'foundation', confidence: 3, firstTapMs: 1800, cardTimeMs: 2400, deliberationMs: 400 },
    // Learning → investment (core Builder)
    { cardId: 'vm-learning', quadrant: 'investment', confidence: 5, firstTapMs: 700, cardTimeMs: 1200, deliberationMs: 300 },
    // Electricity → foundation
    { cardId: 'vm-electricity', quadrant: 'foundation', confidence: 5, firstTapMs: 800, cardTimeMs: 1100, deliberationMs: 200 },
    // Clothes → investment (quality over quantity — presentation matters)
    { cardId: 'vm-clothes', quadrant: 'investment', confidence: 4, firstTapMs: 1600, cardTimeMs: 2400, deliberationMs: 600 },
    // Gift → investment (relationship investment)
    { cardId: 'vm-gift', quadrant: 'investment', confidence: 5, firstTapMs: 900, cardTimeMs: 1400, deliberationMs: 300 },
  ],
  csv: {
    filename: 'builder-classic-revolut-q1-2026.csv',
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
      user_profiles: { onboarding_completed_at: 'not-null' },
      financial_portrait: { archetype_name: 'exists' },
      transactions: { countBetween: [40, 80] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      archetype: {
        mustReferenceQuadrant: 'investment',
        mustMentionOneOf: ['invest', 'grow', 'build', 'intentional', 'purposeful'],
      },
      insight: {
        mustReferenceMerchantsFromCsv: ['gym', 'vanguard', 'course'],
        mustReferenceOneOf: ['investment', 'growth', 'discipline', 'habit'],
        numbersMustMatchCsv: true,
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
