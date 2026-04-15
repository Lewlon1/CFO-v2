import type { QuadrantDef, PersonalityDef, ValueMapTransaction } from './types'

// ── Quadrant definitions ─────────────────────────────────────────────────────

export const QUADRANTS: Record<string, QuadrantDef> = {
  foundation: {
    id: 'foundation',
    name: 'Foundation',
    colour: '#4A90D9',
    emoji: '\u{1F3D7}\uFE0F', // 🏗️
    tagline: 'I needed this',
    description:
      'Bills, groceries, insurance — things you need that serve you well.',
  },
  investment: {
    id: 'investment',
    name: 'Investment',
    colour: '#48BB78',
    emoji: '\u{1F4C8}', // 📈
    tagline: 'This grew my life',
    description:
      'Gym, courses, dinners with friends — things you chose that grow your life.',
  },
  burden: {
    id: 'burden',
    name: 'Burden',
    colour: '#E8A84C',
    emoji: '\u2693', // ⚓
    tagline: 'Had to, but it hurts',
    description:
      'Debt repayments, fines, unavoidable costs that feel heavy.',
  },
  leak: {
    id: 'leak',
    name: 'Leak',
    colour: '#E53E3E',
    emoji: '\u{1F573}\uFE0F', // 🕳️
    tagline: "Didn't need it, didn't help",
    description:
      'Impulse buys, unused subscriptions, regretted spending.',
  },
} as const

export const QUADRANT_ORDER: readonly string[] = [
  'foundation',
  'investment',
  'burden',
  'leak',
] as const

// ── Personality definitions ──────────────────────────────────────────────────

export const PERSONALITIES: Record<string, PersonalityDef> = {
  builder: {
    id: 'builder',
    name: 'The Builder',
    emoji: '\u{1F3D7}\uFE0F',
    headline: 'You spend with purpose.',
    description:
      'Most of your money goes toward things that grow your life. You invest in yourself — now the question is whether you can optimise the rest.',
  },
  fortress: {
    id: 'fortress',
    name: 'The Fortress',
    emoji: '\u{1F3F0}',
    headline: 'You keep the walls strong.',
    description:
      'Your spending is practical and protective. The foundations are solid — the opportunity is finding where that discipline can free up room to invest in growth.',
  },
  truth_teller: {
    id: 'truth_teller',
    name: 'The Truth Teller',
    emoji: '\u{1F50D}',
    headline: 'You see your spending clearly.',
    description:
      'A healthy mix across all four zones. You balance needs with wants, but balance can also mean nothing gets prioritised. Your CFO will help you sharpen the edges.',
  },
  drifter: {
    id: 'drifter',
    name: 'The Drifter',
    emoji: '\u{1F32C}\uFE0F',
    headline: 'Your money moves without a plan.',
    description:
      "The good news? Now you can see where it's going. Small changes to your Leak spending could unlock serious progress on your goals.",
  },
  anchor: {
    id: 'anchor',
    name: 'The Anchor',
    emoji: '\u2693',
    headline: "You're carrying weight.",
    description:
      "Some burdens are unavoidable — but others can be reduced, refinanced, or eliminated. Let's find what you can lighten.",
  },
} as const

// ── Sample transactions (for "Try with example data") ────────────────────────
//
// Ten scenario-based transactions, engineered to probe six personality
// dimensions: necessity boundary, future orientation, guilt pattern, social
// spending identity, control vs chaos, and self-worth. Order matters — the
// set escalates from easy calibration (rent, groceries) through
// high-tension cards (takeaway alone on a Tuesday) to a warm close (gift).
// Selection is bypassed for sample mode in value-map-flow.tsx so this
// order is preserved at the card.

export const SAMPLE_TRANSACTIONS: ValueMapTransaction[] = [
  // 1 — Necessity boundary, control vs chaos. Burden-heavy = resents fixed costs.
  {
    id: 'vm-rent',
    merchant: null,
    amount: 950,
    currency: 'GBP',
    transaction_date: '2026-04-01',
    is_recurring: true,
    description: 'Monthly rent / mortgage payment',
    context: 'Your biggest monthly outgoing, paid by standing order on the 1st',
  },
  // 2 — Calibration baseline. Signal is decision SPEED, not category.
  {
    id: 'vm-groceries',
    merchant: null,
    amount: 62,
    currency: 'GBP',
    transaction_date: '2026-04-11',
    is_recurring: false,
    description: 'Weekly supermarket shop',
    context: 'Your regular weekly grocery run — nothing special, just restocking the basics',
  },
  // 3 — Future orientation, guilt. Classic splitter.
  {
    id: 'vm-gym',
    merchant: null,
    amount: 45,
    currency: 'GBP',
    transaction_date: '2026-04-01',
    is_recurring: true,
    description: 'Gym membership',
    context: 'You go about twice a week — sometimes three, sometimes you skip a week',
  },
  // 4 — High-signal guilt card. "Alone, Tuesday" removes the social excuse.
  {
    id: 'vm-takeaway',
    merchant: null,
    amount: 18.50,
    currency: 'GBP',
    transaction_date: '2026-04-07',
    is_recurring: false,
    description: 'Takeaway delivery on a quiet evening',
    context: "Tuesday night, home alone, didn't feel like cooking",
  },
  // 5 — Social spending identity.
  {
    id: 'vm-dinner-friends',
    merchant: null,
    amount: 42,
    currency: 'GBP',
    transaction_date: '2026-04-04',
    is_recurring: false,
    description: 'Dinner out with friends',
    context: 'A weekend catch-up at a restaurant — you split the bill equally',
  },
  // 6 — Subscription inertia, guilt awareness.
  {
    id: 'vm-streaming',
    merchant: null,
    amount: 11,
    currency: 'GBP',
    transaction_date: '2026-04-01',
    is_recurring: true,
    description: 'Streaming service subscription',
    context: "You use it a few times a week — it's been running for over a year",
  },
  // 7 — Future orientation, follow-through.
  {
    id: 'vm-learning',
    merchant: null,
    amount: 29,
    currency: 'GBP',
    transaction_date: '2026-03-20',
    is_recurring: false,
    description: 'Online course or book',
    context: "Something you bought to learn a new skill — you've done about half of it",
  },
  // 8 — Purest control signal. Bills are unavoidable.
  {
    id: 'vm-electricity',
    merchant: null,
    amount: 67,
    currency: 'GBP',
    transaction_date: '2026-04-03',
    is_recurring: true,
    description: 'Electricity bill',
    context: 'Direct debit, same rough amount each month',
  },
  // 9 — Self-worth, impulse vs deliberate.
  {
    id: 'vm-clothes',
    merchant: null,
    amount: 85,
    currency: 'GBP',
    transaction_date: '2026-04-05',
    is_recurring: false,
    description: 'New clothes or shoes',
    context: "Something you wanted but didn't strictly need — you'd been eyeing it for a while",
  },
  // 10 — Generosity as identity. Warm close.
  {
    id: 'vm-gift',
    merchant: null,
    amount: 35,
    currency: 'GBP',
    transaction_date: '2026-04-10',
    is_recurring: false,
    description: 'Birthday gift for someone close',
    context: 'For a good friend or family member — you chose it yourself',
  },
]
