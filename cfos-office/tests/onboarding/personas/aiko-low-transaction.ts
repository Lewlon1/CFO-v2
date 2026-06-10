import type { Persona } from './types'

// Aiko — Sparse data (Session 32 C, persona expansion).
//
// A new account holder: 21 days of transactions, ~14 distinct rows. The
// behavioural engine will report low data_completeness for nearly every
// cluster, and many derivations (trend, recurrence) will be null because the
// 28-day windows can't be filled. The first Read must NOT over-claim from
// this — it should reference what's seen, acknowledge the thinness, and
// avoid confident pattern claims like "every Friday" or "climbing trend".
//
// 21 days of data → falls in the bottom of the engine's data_completeness
// window. Cluster pickers should filter most of these out as
// data_completeness < 0.3, leaving only the salary + one or two recurring
// bills.

const csvRows: string[] = [
  'Type,Started Date,Description,Amount,Currency,Balance',
  // Salary
  'TRANSFER,2026-03-08,Salary Engineering Co,3100.00,GBP,3100.00',
  // Rent + bills (Aiko just moved in)
  'CARD_PAYMENT,2026-03-09,Rent — landlord,-1150.00,GBP,1950.00',
  'CARD_PAYMENT,2026-03-12,Thames Water,-32.00,GBP,1918.00',
  'CARD_PAYMENT,2026-03-15,EE Mobile,-22.00,GBP,1896.00',
  // Sparse spending — moving-in mode
  'CARD_PAYMENT,2026-03-09,IKEA Croydon,-184.50,GBP,1711.50',
  'CARD_PAYMENT,2026-03-10,Sainsbury\'s Local,-38.20,GBP,1673.30',
  'CARD_PAYMENT,2026-03-13,Pret a Manger,-7.40,GBP,1665.90',
  'CARD_PAYMENT,2026-03-14,Tesco Express,-14.60,GBP,1651.30',
  'CARD_PAYMENT,2026-03-17,Sainsbury\'s Local,-29.00,GBP,1622.30',
  'CARD_PAYMENT,2026-03-19,Pret a Manger,-8.10,GBP,1614.20',
  'CARD_PAYMENT,2026-03-21,Uber,-12.50,GBP,1601.70',
  'CARD_PAYMENT,2026-03-23,Tesco Express,-17.80,GBP,1583.90',
  'CARD_PAYMENT,2026-03-26,Sainsbury\'s Local,-31.40,GBP,1552.50',
  'CARD_PAYMENT,2026-03-28,Pret a Manger,-6.20,GBP,1546.30',
]

const csvBase64 = Buffer.from(csvRows.join('\n'), 'utf-8').toString('base64')

export const aikoLowTransaction: Persona = {
  id: 'aiko-low-transaction',
  label: 'Aiko — Sparse data (21 days)',
  profile: {
    displayName: 'Aiko',
    country: 'GB',
    city: 'London',
    currency: 'GBP',
    monthlyIncome: 3100,
    monthlyRent: 1150,
  },
  // Confidence levels skew toward 'don't really know' — Aiko hasn't built
  // strong opinions yet. Several `hardToDecide` taps.
  valueMapResponses: [
    { cardId: 'vm-rent', quadrant: 'foundation', confidence: 3, firstTapMs: 2200, cardTimeMs: 3100, deliberationMs: 800 },
    { cardId: 'vm-groceries', quadrant: 'foundation', confidence: 3, firstTapMs: 1900, cardTimeMs: 2700, deliberationMs: 700 },
    { cardId: 'vm-gym', quadrant: null, confidence: 0, firstTapMs: 4100, cardTimeMs: 5200, deliberationMs: 1100, hardToDecide: true },
    { cardId: 'vm-takeaway', quadrant: 'leak', confidence: 2, firstTapMs: 2400, cardTimeMs: 3300, deliberationMs: 800 },
    { cardId: 'vm-dinner-friends', quadrant: 'investment', confidence: 3, firstTapMs: 2100, cardTimeMs: 2800, deliberationMs: 700 },
    { cardId: 'vm-streaming', quadrant: 'burden', confidence: 3, firstTapMs: 1700, cardTimeMs: 2400, deliberationMs: 600 },
    { cardId: 'vm-learning', quadrant: 'investment', confidence: 4, firstTapMs: 1500, cardTimeMs: 2200, deliberationMs: 500 },
    { cardId: 'vm-electricity', quadrant: 'burden', confidence: 4, firstTapMs: 1400, cardTimeMs: 2000, deliberationMs: 500 },
    { cardId: 'vm-clothes', quadrant: null, confidence: 0, firstTapMs: 3800, cardTimeMs: 4800, deliberationMs: 1000, hardToDecide: true },
    { cardId: 'vm-gift', quadrant: 'investment', confidence: 2, firstTapMs: 3300, cardTimeMs: 4200, deliberationMs: 900 },
  ],
  csv: {
    filename: 'aiko-sparse-revolut-q1-2026.csv',
    contentBase64: csvBase64,
    expectedBank: 'revolut',
  },
  expectations: {
    entryStruggle: 'dont_know',
    archetype: {
      // Rent + groceries marked foundation dominate the decided pot (gym +
      // clothes are hard-to-decide), pushing foundation% past the 50%
      // fortress threshold. The persona's *narrative* purpose is sparse-data
      // testing (see hardRules.insight.mustReferenceOneOf), not archetype
      // shape — the Value Map score lands where rent's £950 sends it.
      expectedQuadrant: 'foundation',
      personalityId: 'fortress',
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
      transactions: { countBetween: [12, 18] },
    },
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      bannedPatterns: [
        // Confident pattern claims are the failure mode for sparse data.
        'every\\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)',
        'climb(ing|ed)',
        'trend(ing)?',
        '(rising|falling|growing|shrinking)\\s+(steadily|consistently)',
      ],
      insight: {
        // Should ground in what's actually visible: top merchants from the
        // 21-day window.
        // Must acknowledge thinness OR ask a question rather than asserting.
        mustReferenceOneOf: [
          'first',
          'housing',
          'free cash flow',
          'shopping',
          'groceries',
        ],
      },
    },
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
