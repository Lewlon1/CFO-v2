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

export const SAMPLE_TRANSACTIONS: ValueMapTransaction[] = [
  { id: 'sample-1', merchant: "Sainsbury's", amount: 62.30, currency: 'GBP', transaction_date: '2025-03-15', is_recurring: false, description: 'Weekly shop', category_name: 'Groceries' },
  { id: 'sample-2', merchant: 'Deliveroo', amount: 18.50, currency: 'GBP', transaction_date: '2025-03-14', is_recurring: false, description: 'Late night order', category_name: 'Dining' },
  { id: 'sample-3', merchant: 'PureGym', amount: 45.00, currency: 'GBP', transaction_date: '2025-03-01', is_recurring: true, description: 'Monthly membership', category_name: 'Health & Fitness' },
  { id: 'sample-4', merchant: 'The Ivy', amount: 65.00, currency: 'GBP', transaction_date: '2025-03-12', is_recurring: false, description: 'Birthday dinner', category_name: 'Dining' },
  { id: 'sample-5', merchant: 'Udemy', amount: 14.99, currency: 'GBP', transaction_date: '2025-03-10', is_recurring: false, description: 'Python course', category_name: 'Education' },
  { id: 'sample-6', merchant: 'HSBC', amount: 7.00, currency: 'GBP', transaction_date: '2025-03-08', is_recurring: false, description: 'Overdraft fee', category_name: 'Bank Fees' },
  { id: 'sample-7', merchant: 'Spotify', amount: 9.99, currency: 'GBP', transaction_date: '2025-03-01', is_recurring: true, description: 'Premium subscription', category_name: 'Subscriptions' },
  { id: 'sample-8', merchant: 'BetterHelp', amount: 55.00, currency: 'GBP', transaction_date: '2025-03-01', is_recurring: true, description: 'Therapy session', category_name: 'Health & Fitness' },
  { id: 'sample-9', merchant: 'Zara', amount: 42.00, currency: 'GBP', transaction_date: '2025-03-09', is_recurring: false, description: 'Impulse purchase', category_name: 'Shopping' },
  { id: 'sample-10', merchant: 'The Crown', amount: 38.00, currency: 'GBP', transaction_date: '2025-03-07', is_recurring: false, description: 'Pub - Friday night', category_name: 'Dining' },
  { id: 'sample-11', merchant: 'Ryanair', amount: 180.00, currency: 'GBP', transaction_date: '2025-03-05', is_recurring: false, description: 'Weekend trip to Lisbon', category_name: 'Travel' },
  { id: 'sample-12', merchant: 'Rent', amount: 1200.00, currency: 'GBP', transaction_date: '2025-03-01', is_recurring: true, description: 'Monthly rent', category_name: 'Housing' },
  { id: 'sample-13', merchant: 'Amazon', amount: 23.99, currency: 'GBP', transaction_date: '2025-03-11', is_recurring: false, description: 'Phone case + screen protector', category_name: 'Shopping' },
  { id: 'sample-14', merchant: 'Tesco', amount: 8.40, currency: 'GBP', transaction_date: '2025-03-13', is_recurring: false, description: 'Meal deal', category_name: 'Groceries' },
  { id: 'sample-15', merchant: 'Netflix', amount: 15.99, currency: 'GBP', transaction_date: '2025-03-01', is_recurring: true, description: 'Standard subscription', category_name: 'Subscriptions' },
  { id: 'sample-16', merchant: 'EE', amount: 35.00, currency: 'GBP', transaction_date: '2025-03-01', is_recurring: true, description: 'Phone contract', category_name: 'Bills' },
  { id: 'sample-17', merchant: 'Coursera', amount: 39.00, currency: 'GBP', transaction_date: '2025-03-06', is_recurring: false, description: 'Data science certificate', category_name: 'Education' },
  { id: 'sample-18', merchant: 'Costa', amount: 4.50, currency: 'GBP', transaction_date: '2025-03-14', is_recurring: false, description: 'Morning coffee', category_name: 'Dining' },
]
