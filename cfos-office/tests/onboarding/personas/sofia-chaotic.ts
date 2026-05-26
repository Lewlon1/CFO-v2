import type { Persona } from './types'

// Sofia — Chaotic / freelance (Session 32 C, persona expansion).
//
// Freelance designer with irregular project income (some weeks 2 client
// payments, some weeks zero), spending that bursts around invoices, no
// stable rent (sublets month-to-month). The behavioural engine will see
// high CV across nearly everything: low recurrence confidence, broad amount
// ranges. The first Read must NOT impose order that isn't there — no
// "climbing trend" claims, no "every week you spend X". The right read is
// pattern-of-no-pattern + a question.

const csvRows: string[] = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  // Irregular client deposits over Q1
  'TRANSFER,2026-01-08,Client invoice — Acme Studio,1850.00,GBP,1850.00',
  'TRANSFER,2026-01-22,Client invoice — Folk & Co,920.00,GBP,2770.00',
  'TRANSFER,2026-02-05,Client invoice — Acme Studio,2400.00,GBP,5170.00',
  'TRANSFER,2026-02-19,Client invoice — Marshfield,640.00,GBP,5810.00',
  'TRANSFER,2026-03-04,Client invoice — Acme Studio,1100.00,GBP,6910.00',
  'TRANSFER,2026-03-25,Client invoice — Penlight,1780.00,GBP,8690.00',
  // Irregular rent — sublets, varying amounts
  'CARD_PAYMENT,2026-01-04,Sublet — Hackney,-680.00,GBP,1170.00',
  'CARD_PAYMENT,2026-02-04,Sublet — Bermondsey,-820.00,GBP,4990.00',
  'CARD_PAYMENT,2026-03-04,Sublet — Hackney again,-680.00,GBP,6230.00',
  // Bursty discretionary spending — clusters around invoice arrivals
  ...['2026-01-09', '2026-01-10', '2026-01-11'].map(
    (d, i) => `CARD_PAYMENT,${d},Dishoom Shoreditch,-${(38 + i * 12).toFixed(2)},GBP,0.00`,
  ),
  ...['2026-02-06', '2026-02-07'].map(
    (d, i) => `CARD_PAYMENT,${d},Selfridges,-${(220 - i * 60).toFixed(2)},GBP,0.00`,
  ),
  'CARD_PAYMENT,2026-02-20,Eurostar to Paris,-185.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-22,Hôtel des Marronniers,-310.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-05,Apple Store — replacement Magic Mouse,-99.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-26,Aesop Marylebone,-128.00,GBP,0.00',
  // Groceries — irregular, varying amounts
  ...['2026-01-12', '2026-01-29', '2026-02-08', '2026-02-23', '2026-03-09', '2026-03-21'].map(
    (d, i) => `CARD_PAYMENT,${d},Whole Foods Market,-${(42 + (i * 13) % 35).toFixed(2)},GBP,0.00`,
  ),
  // Coffee — semi-regular but variable count per week
  ...['2026-01-13', '2026-01-15', '2026-01-20', '2026-02-02', '2026-02-09', '2026-02-12', '2026-03-02', '2026-03-15', '2026-03-22', '2026-03-27'].map(
    (d) => `CARD_PAYMENT,${d},Allpress Espresso,-4.80,GBP,0.00`,
  ),
  // One-off conference (an investment Sofia would call it)
  'CARD_PAYMENT,2026-01-18,Brand New Conference,-540.00,GBP,0.00',
  // Subscriptions (the rare recurring thing)
  'CARD_PAYMENT,2026-01-15,Adobe Creative Cloud,-30.34,GBP,0.00',
  'CARD_PAYMENT,2026-02-15,Adobe Creative Cloud,-30.34,GBP,0.00',
  'CARD_PAYMENT,2026-03-15,Adobe Creative Cloud,-30.34,GBP,0.00',
  'CARD_PAYMENT,2026-01-22,Figma Professional,-12.00,GBP,0.00',
  'CARD_PAYMENT,2026-02-22,Figma Professional,-12.00,GBP,0.00',
  'CARD_PAYMENT,2026-03-22,Figma Professional,-12.00,GBP,0.00',
]

const csvBase64 = Buffer.from(csvRows.join('\n'), 'utf-8').toString('base64')

export const sofiaChaotic: Persona = {
  id: 'sofia-chaotic',
  label: 'Sofia — Chaotic freelancer',
  profile: {
    displayName: 'Sofia',
    country: 'GB',
    city: 'London',
    currency: 'GBP',
  },
  // Sofia is "drifter"-shape: leak ≥ 25% of decided. Rent is hard-to-decide
  // (she sublets month-to-month — never sure what "rent" even means for her).
  // Groceries, gym, takeaway, streaming, clothes all read as leaks: stuff she
  // pays for in bursts and barely uses or regrets later. Investment is
  // social + learning; burden is electricity. With rent excluded, leak ≈ 56%.
  valueMapResponses: [
    { cardId: 'vm-rent', quadrant: null, confidence: 0, firstTapMs: 4100, cardTimeMs: 5400, deliberationMs: 1200, hardToDecide: true },
    { cardId: 'vm-groceries', quadrant: 'leak', confidence: 3, firstTapMs: 2200, cardTimeMs: 2900, deliberationMs: 700 },
    { cardId: 'vm-gym', quadrant: 'leak', confidence: 4, firstTapMs: 1900, cardTimeMs: 2500, deliberationMs: 600 },
    { cardId: 'vm-takeaway', quadrant: 'leak', confidence: 3, firstTapMs: 2400, cardTimeMs: 3200, deliberationMs: 700 },
    { cardId: 'vm-dinner-friends', quadrant: 'investment', confidence: 4, firstTapMs: 1600, cardTimeMs: 2200, deliberationMs: 500 },
    { cardId: 'vm-streaming', quadrant: 'leak', confidence: 3, firstTapMs: 2100, cardTimeMs: 2800, deliberationMs: 700 },
    { cardId: 'vm-learning', quadrant: 'investment', confidence: 5, firstTapMs: 1200, cardTimeMs: 1800, deliberationMs: 400 },
    { cardId: 'vm-electricity', quadrant: 'burden', confidence: 4, firstTapMs: 1400, cardTimeMs: 2000, deliberationMs: 500 },
    { cardId: 'vm-clothes', quadrant: 'leak', confidence: 3, firstTapMs: 2700, cardTimeMs: 3500, deliberationMs: 800 },
    { cardId: 'vm-gift', quadrant: 'investment', confidence: 4, firstTapMs: 1900, cardTimeMs: 2500, deliberationMs: 600 },
  ],
  csv: {
    filename: 'sofia-chaotic-revolut-q1-2026.csv',
    contentBase64: csvBase64,
    expectedBank: 'revolut',
  },
  expectations: {
    entryStruggle: 'dont_know',
    archetype: {
      expectedQuadrant: 'leak',
      personalityId: 'drifter',
    },
    stagesCompleted: [
      'struggle_submitted',
      'value_map_done',
      'upload_done',
      'archetype_shown',
      'complete',
    ],
    dbAfterHandoff: {
      financial_portrait: { archetype_name: 'exists' },
      transactions: { countBetween: [30, 50] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      bannedPatterns: [
        // Imposing order that isn't there is the failure mode.
        '(rising|falling|climbing)\\s+(steadily|consistently)',
        'every\\s+week\\s+you\\s+spend',
        'monthly\\s+(rent|housing)',
      ],
      insight: {
        // The recurring software subs (Adobe, Figma) are the rare regular
        // pattern; the first Read should ground in those + the actually-recurring
        // merchants rather than inventing rhythms in chaotic categories.
        mustReferenceMerchantsFromCsv: ['adobe', 'figma', 'allpress', 'dishoom'],
        mustReferenceOneOf: ['irregular', 'bursts', 'varies', 'spike', 'project', 'invoice', 'uneven', 'freelance'],
        numbersMustMatchCsv: true,
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
