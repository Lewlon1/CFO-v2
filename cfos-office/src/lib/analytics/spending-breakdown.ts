/**
 * Deterministic, server-computed spending breakdown for the first Read.
 *
 * Sourced from `transactions` directly (no snapshot dependency → no migration
 * risk). The window is relative to `dataWindowEnd` (the latest transaction
 * date), NOT `Date.now()` — a user whose CSV ended 65 days ago would otherwise
 * window into an empty range and the breakdown would come back null. This is
 * the same dormancy-vs-today lesson already documented in compose-first-read.ts.
 *
 * The LLM never recomputes any of these numbers; it cites them verbatim. Every
 * total, percentage, and count here is final.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normaliseMerchantDescription } from '@/lib/analytics/merchant-normalise';
import { isPlSpend, absExpense } from '@/lib/analytics/pattern-detectors';

export type CategorySlice = { category: string; total: number; pct: number };

export type SpendingBreakdown = {
  total_spend: number;
  window_days: number;
  /** Sorted desc by total. Top 5. 'Uncategorised' folds null/empty/Unknown. */
  top_categories: CategorySlice[];
  /** Single biggest merchant by summed spend, normalised. Null if no spend. */
  biggest_merchant: { name: string; total: number; txn_count: number } | null;
  /** Largest single outflow in the window. Null if no spend. */
  largest_transaction: { merchant: string; amount: number; date: string } | null;
  /** Share of total_spend with no usable category. 0–100. */
  uncategorised_pct: number;
};

const UNCATEGORISED_LABEL = 'Uncategorised';

export async function getSpendingBreakdown(
  supabase: SupabaseClient,
  userId: string,
  windowDays: number,
  dataWindowEnd: string | null, // ISO YYYY-MM-DD, latest txn date
): Promise<SpendingBreakdown | null> {
  const endStr = dataWindowEnd ?? new Date().toISOString().slice(0, 10);
  const since = new Date(new Date(endStr).getTime() - windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from('transactions')
    .select('amount, date, description, category_id')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('date', since)
    .lte('date', endStr);
  if (error) {
    console.error('[spending-breakdown] query failed:', error);
    return null;
  }

  // Outflow spend only — isPlSpend excludes transfers, debt repayments,
  // savings/investments, and income, so they don't contaminate the breakdown.
  const rows = (data ?? []).filter((t) =>
    isPlSpend({ amount: t.amount as number, category_id: t.category_id as string | null }),
  );
  if (rows.length === 0) return null;

  let total = 0;
  const byCat = new Map<string, number>();
  const byMerchant = new Map<string, { total: number; count: number }>();
  let largest: SpendingBreakdown['largest_transaction'] = null;

  for (const t of rows) {
    const amt = absExpense(Number(t.amount));
    if (amt === 0) continue;
    total += amt;

    const rawCat = String((t.category_id as string | null) ?? '').trim();
    const cat = !rawCat || rawCat.toLowerCase() === 'unknown' ? UNCATEGORISED_LABEL : rawCat;
    byCat.set(cat, (byCat.get(cat) ?? 0) + amt);

    const m = normaliseMerchantDescription(String((t.description as string | null) ?? ''));
    const prev = byMerchant.get(m) ?? { total: 0, count: 0 };
    byMerchant.set(m, { total: prev.total + amt, count: prev.count + 1 });

    if (!largest || amt > largest.amount) {
      largest = { merchant: m, amount: amt, date: String(t.date) };
    }
  }

  if (total === 0) return null;

  const top_categories = [...byCat.entries()]
    .map(([category, t]) => ({ category, total: round2(t), pct: round1((t / total) * 100) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const biggest = [...byMerchant.entries()].sort((a, b) => b[1].total - a[1].total)[0];
  const biggest_merchant = biggest
    ? { name: biggest[0], total: round2(biggest[1].total), txn_count: biggest[1].count }
    : null;

  const uncategorised = byCat.get(UNCATEGORISED_LABEL) ?? 0;

  return {
    total_spend: round2(total),
    window_days: windowDays,
    top_categories,
    biggest_merchant,
    largest_transaction: largest ? { ...largest, amount: round2(largest.amount) } : null,
    uncategorised_pct: round1((uncategorised / total) * 100),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
