/**
 * Seed script for end-to-end testing.
 * Run with: npx tsx scripts/seed-test-user.ts
 *
 * Prerequisites:
 * - Staging Supabase database
 * - A test user account already created via the auth flow
 * - .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *
 * Set TEST_USER_ID env var to the auth user's UUID, or pass as first CLI arg:
 *   TEST_USER_ID=abc-123 npx tsx scripts/seed-test-user.ts
 *   npx tsx scripts/seed-test-user.ts abc-123
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local manually (avoids dotenv dependency)
try {
  const envFile = readFileSync(resolve(__dirname, '../.env.local'), 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // .env.local not found — rely on environment variables
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_USER_ID = process.argv[2] || process.env.TEST_USER_ID;

if (!TEST_USER_ID) {
  console.error('Usage: npx tsx scripts/seed-test-user.ts <USER_UUID>');
  console.error('Or set TEST_USER_ID environment variable');
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────

function randomAmount(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function randomDate(year: number, month: number): string {
  const day = Math.floor(Math.random() * 28) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Transaction Templates ───────────────────────────────────────

const transactionTemplates = [
  // Housing (monthly, always on 1st)
  { description: 'Rent Transfer - Barcelona Flat', category_id: 'housing', value_category: 'foundation', amount: -950, recurring: true },
  // Utilities
  { description: 'Naturgy - Gas', category_id: 'utilities_bills', value_category: 'foundation', amount: -45, recurring: true },
  { description: 'Endesa - Electricity', category_id: 'utilities_bills', value_category: 'foundation', amount: -65, recurring: true },
  { description: 'Movistar Fibra + Mobile', category_id: 'utilities_bills', value_category: 'burden', amount: -55, recurring: true },
  { description: 'Aigues de Barcelona', category_id: 'utilities_bills', value_category: 'burden', amount: -30, recurring: true },
  // Subscriptions
  { description: 'Netflix', category_id: 'subscriptions', value_category: 'leak', amount: -17.99, recurring: true },
  { description: 'Spotify Premium', category_id: 'subscriptions', value_category: 'investment', amount: -10.99, recurring: true },
  { description: 'iCloud Storage', category_id: 'subscriptions', value_category: 'foundation', amount: -2.99, recurring: true },
  // Health
  { description: 'DIR Gym Membership', category_id: 'health', value_category: 'investment', amount: -49, recurring: true },
  // Groceries (variable)
  ...['Mercadona', 'Lidl', 'Bon Preu', 'Carrefour Express'].map(store => ({
    description: store, category_id: 'groceries', value_category: 'foundation', amount: 0, recurring: false,
  })),
  // Eating/Drinking Out
  ...['La Pepita Burger', 'Cafe del Mar', 'Bar Mut', 'Flax & Kale', 'Cerveceria Catalana', 'Can Paixano', 'Federal Cafe'].map(place => ({
    description: place, category_id: 'eat_drinking_out', value_category: 'leak', amount: 0, recurring: false,
  })),
  // Transport
  ...['TMB Metro', 'Uber Barcelona', 'Cabify', 'Bicing Annual'].map(t => ({
    description: t, category_id: 'transport', value_category: 'foundation', amount: 0, recurring: false,
  })),
  // Shopping
  ...['Amazon.es', 'Zara', 'El Corte Ingles', 'FNAC'].map(s => ({
    description: s, category_id: 'shopping', value_category: 'leak', amount: 0, recurring: false,
  })),
  // Entertainment
  ...['Cinemax Diagonal', 'Padel Court Booking', 'Steam Games'].map(e => ({
    description: e, category_id: 'entertainment', value_category: 'investment', amount: 0, recurring: false,
  })),
  // Personal care
  { description: 'Barber Shop Gracia', category_id: 'personal_care', value_category: 'foundation', amount: -18, recurring: false },
];

const amountRanges: Record<string, [number, number]> = {
  groceries: [15, 85],
  eat_drinking_out: [8, 55],
  transport: [1.5, 25],
  shopping: [15, 120],
  entertainment: [5, 40],
  personal_care: [10, 30],
};

function generateMonthTransactions(year: number, month: number, batchId: string) {
  const transactions: Array<{
    id: string;
    user_id: string;
    date: string;
    description: string;
    amount: number;
    currency: string;
    category_id: string;
    value_category: string;
    is_recurring: boolean;
    import_batch_id: string;
    source: string;
  }> = [];

  // Income (salary on 28th)
  transactions.push({
    id: randomUUID(),
    user_id: TEST_USER_ID!,
    date: `${year}-${String(month).padStart(2, '0')}-28`,
    description: 'Salary - Company SL',
    amount: 2700,
    currency: 'EUR',
    category_id: 'income',
    value_category: 'foundation',
    is_recurring: true,
    import_batch_id: batchId,
    source: 'seed_script',
  });

  // Recurring expenses (fixed day each month)
  const recurring = transactionTemplates.filter(t => t.recurring);
  for (const tmpl of recurring) {
    const day = tmpl.description.includes('Rent') ? 1 : Math.floor(Math.random() * 10) + 1;
    transactions.push({
      id: randomUUID(),
      user_id: TEST_USER_ID!,
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      description: tmpl.description,
      amount: tmpl.amount + (tmpl.amount !== 0 ? randomAmount(-5, 5) : 0),
      currency: 'EUR',
      category_id: tmpl.category_id,
      value_category: tmpl.value_category,
      is_recurring: true,
      import_batch_id: batchId,
      source: 'seed_script',
    });
  }

  // Variable expenses (random throughout month)
  const variable = transactionTemplates.filter(t => !t.recurring);
  const numVariable = 60 + Math.floor(Math.random() * 30); // 60-90 variable transactions
  for (let i = 0; i < numVariable; i++) {
    const tmpl = pickRandom(variable);
    const range = amountRanges[tmpl.category_id] || [5, 30];
    transactions.push({
      id: randomUUID(),
      user_id: TEST_USER_ID!,
      date: randomDate(year, month),
      description: tmpl.description,
      amount: -randomAmount(range[0], range[1]),
      currency: 'EUR',
      category_id: tmpl.category_id,
      value_category: tmpl.value_category,
      is_recurring: false,
      import_batch_id: batchId,
      source: 'seed_script',
    });
  }

  return transactions;
}

// ── Main Seed Function ──────────────────────────────────────────

async function seed() {
  console.log(`Seeding test user: ${TEST_USER_ID}`);

  // 1. Profile
  const { error: profileError } = await supabase.from('user_profiles').upsert({
    id: TEST_USER_ID,
    display_name: 'Lewis',
    country: 'Spain',
    city: 'Barcelona',
    primary_currency: 'EUR',
    net_monthly_income: 2700,
    pay_frequency: 'monthly',
    has_bonus_months: true,
    bonus_month_details: { months: [6, 12], multiplier: 2 },
    housing_type: 'Renting',
    monthly_rent: 950,
    employment_status: 'Employed',
    age_range: '31-35',
    advice_style: 'direct',
    profile_completeness: 45,
  });
  if (profileError) throw profileError;
  console.log('  Profile seeded');

  // 2. Transactions — 3 months (Jan, Feb, Mar 2026)
  const months = [
    { year: 2026, month: 1 },
    { year: 2026, month: 2 },
    { year: 2026, month: 3 },
  ];

  for (const { year, month } of months) {
    const batchId = randomUUID();
    const transactions = generateMonthTransactions(year, month, batchId);

    // Insert in chunks of 50
    for (let i = 0; i < transactions.length; i += 50) {
      const chunk = transactions.slice(i, i + 50);
      const { error } = await supabase.from('transactions').insert(chunk);
      if (error) throw error;
    }

    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    console.log(`  ${monthStr}: ${transactions.length} transactions`);

    // 3. Monthly snapshot
    const spending = transactions.filter(t => t.amount < 0);
    const income = transactions.filter(t => t.amount > 0);
    const totalSpending = spending.reduce((s, t) => s + Math.abs(t.amount), 0);
    const totalIncome = income.reduce((s, t) => s + t.amount, 0);

    // Category breakdown
    const byCat: Record<string, { amount: number; count: number }> = {};
    for (const t of spending) {
      if (!byCat[t.category_id]) byCat[t.category_id] = { amount: 0, count: 0 };
      byCat[t.category_id].amount += Math.abs(t.amount);
      byCat[t.category_id].count++;
    }

    // Value breakdown
    const byVal: Record<string, { amount: number; count: number }> = {};
    for (const t of spending) {
      const vc = t.value_category || 'no_idea';
      if (!byVal[vc]) byVal[vc] = { amount: 0, count: 0 };
      byVal[vc].amount += Math.abs(t.amount);
      byVal[vc].count++;
    }

    const { error: snapError } = await supabase.from('monthly_snapshots').upsert({
      user_id: TEST_USER_ID,
      month: `${monthStr}-01`,
      total_income: Math.round(totalIncome * 100) / 100,
      total_spending: Math.round(totalSpending * 100) / 100,
      surplus_deficit: Math.round((totalIncome - totalSpending) * 100) / 100,
      transaction_count: transactions.length,
      spending_by_category: byCat,
      top_merchants: Object.entries(byCat)
        .sort((a, b) => b[1].amount - a[1].amount)
        .slice(0, 5)
        .map(([cat, data]) => ({ category: cat, ...data })),
      value_breakdown: byVal,
    }, { onConflict: 'user_id,month' });
    if (snapError) throw snapError;
    console.log(`  ${monthStr}: snapshot computed`);
  }

  // 4. Recurring expenses
  const recurringItems = [
    { name: 'Rent', provider: 'Landlord', amount: 950, frequency: 'monthly', category_id: 'housing' },
    { name: 'Electricity', provider: 'Endesa', amount: 65, frequency: 'monthly', category_id: 'utilities_bills' },
    { name: 'Gas', provider: 'Naturgy', amount: 45, frequency: 'bimonthly', category_id: 'utilities_bills' },
    { name: 'Internet + Mobile', provider: 'Movistar', amount: 55, frequency: 'monthly', category_id: 'utilities_bills' },
    { name: 'Netflix', provider: 'Netflix', amount: 17.99, frequency: 'monthly', category_id: 'subscriptions' },
    { name: 'Spotify', provider: 'Spotify', amount: 10.99, frequency: 'monthly', category_id: 'subscriptions' },
    { name: 'Gym', provider: 'DIR', amount: 49, frequency: 'monthly', category_id: 'health' },
  ];

  for (const item of recurringItems) {
    const { error } = await supabase.from('recurring_expenses').upsert(
      { user_id: TEST_USER_ID, is_active: true, currency: 'EUR', ...item },
      { onConflict: 'user_id,name' }
    );
    if (error) console.warn(`  recurring_expenses upsert warning (${item.name}):`, error.message);
  }
  console.log('  Recurring expenses seeded');

  // 5. Financial portrait traits
  const traits = [
    { trait_type: 'spending_pattern', trait_key: 'dining_frequency', trait_value: 'Eats out 3-4 times per week, averaging €25-35 per meal', confidence: 0.85, source: 'system_analysis' },
    { trait_type: 'value_preference', trait_key: 'value_pref_health', trait_value: 'Sees health spending as investment — gym and wellness are priorities', confidence: 1.0, source: 'user_correction_chat' },
    { trait_type: 'behavioral', trait_key: 'subscription_awareness', trait_value: 'Low awareness of subscription costs — rarely reviews recurring charges', confidence: 0.7, source: 'system_analysis' },
  ];

  for (const trait of traits) {
    const { error } = await supabase.from('financial_portrait').upsert(
      { user_id: TEST_USER_ID, ...trait },
      { onConflict: 'user_id,trait_key' }
    );
    if (error) console.warn(`  portrait trait warning (${trait.trait_key}):`, error.message);
  }
  console.log('  Financial portrait seeded');

  // 6. Goal
  const { error: goalError } = await supabase.from('goals').upsert({
    user_id: TEST_USER_ID,
    name: 'Emergency Fund',
    description: '3 months of expenses (~€6,000) in a separate savings account',
    target_amount: 6000,
    current_amount: 1200,
    target_date: '2026-12-31',
    priority: 'high',
    status: 'active',
  }, { onConflict: 'user_id,name' });
  if (goalError) console.warn('  goal warning:', goalError.message);
  console.log('  Goal seeded');

  // 7. A nudge
  const { error: nudgeError } = await supabase.from('nudges').insert({
    user_id: TEST_USER_ID,
    type: 'spending_spike',
    title: 'Dining spending is up 23% this month',
    body: 'Your eating out spending reached €340 in March — that\'s 23% higher than your 3-month average of €276.',
    priority: 'medium',
    status: 'pending',
    scheduled_for: new Date().toISOString(),
    metadata: { category: 'eat_drinking_out', spike_pct: 23 },
  });
  if (nudgeError) console.warn('  nudge warning:', nudgeError.message);
  console.log('  Nudge seeded');

  // 8. Value Map result
  const { error: vmError } = await supabase.from('value_map_results').upsert({
    user_id: TEST_USER_ID,
    session_id: randomUUID(),
    responses: [
      { transaction: 'Monthly rent payment', choice: 'foundation', confidence: 5, time_ms: 1200 },
      { transaction: 'Gym membership', choice: 'investment', confidence: 4, time_ms: 2100 },
      { transaction: 'Netflix subscription', choice: 'leak', confidence: 3, time_ms: 3400 },
      { transaction: 'Weekly groceries at Mercadona', choice: 'foundation', confidence: 5, time_ms: 900 },
      { transaction: 'Friday night dinner at a nice restaurant', choice: 'investment', confidence: 2, time_ms: 4500 },
      { transaction: 'Uber ride when metro is running', choice: 'leak', confidence: 4, time_ms: 1800 },
      { transaction: 'New running shoes', choice: 'investment', confidence: 3, time_ms: 2800 },
      { transaction: 'Coffee from cafe every morning', choice: 'leak', confidence: 2, time_ms: 3200 },
      { transaction: 'Annual travel insurance', choice: 'foundation', confidence: 4, time_ms: 1500 },
      { transaction: 'Birthday present for a friend', choice: 'investment', confidence: 4, time_ms: 2000 },
    ],
    archetype: 'The Intentional Spender',
    archetype_description: 'You know what matters to you — health, relationships, experiences — but you struggle with the small daily leaks that add up. Your foundation is solid and your investments are genuine, but your leak spending reveals a gap between intention and habit.',
    country: 'ES',
  });
  if (vmError) console.warn('  value_map warning:', vmError.message);
  console.log('  Value Map result seeded');

  console.log('\nSeed complete! Log in as the test user to verify.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
