// cfos-office/src/lib/ai/tools/helpers/group-by-merchant.ts
//
// Shared merchant-grouping helper used by tools and analytics.
// Groups a transaction list by normaliseMerchant(description), nets out
// refunds, and returns groups sorted by total_spend desc.

import { normaliseMerchant } from '@/lib/analytics/pattern-detectors';

export interface MerchantGroup {
  merchant: string;            // normaliseMerchant output (or 'unknown')
  total_spend: number;         // sum of absolute spend (positive); refunds reduce; floored at 0
  transaction_count: number;
  last_seen: string;           // ISO date string of latest transaction
  first_seen: string;          // ISO date string of earliest transaction
}

export interface TransactionForGrouping {
  amount: number | string;
  description: string | null;
  date: string;                // ISO date
  category_id?: string | null;
}

interface MerchantAccumulator {
  merchant: string;
  net: number;                 // signed net (outflow positive, refund negative); clamped to >=0 at the end
  transaction_count: number;
  last_seen: string;
  first_seen: string;
}

/**
 * Group a transaction list by normalised merchant key.
 *
 * - Grouping key: `normaliseMerchant(t.description ?? '')`; empty / null
 *   descriptions group together as the merchant `'unknown'`.
 * - `total_spend` is the net of outflows minus refunds, then clamped to >=0.
 *   These are spend totals, not balances — a merchant that net-refunds is
 *   reported as 0 spend rather than a negative number.
 * - Returned groups are sorted by `total_spend` descending.
 */
export function groupByMerchant(
  transactions: TransactionForGrouping[],
): MerchantGroup[] {
  const groups = new Map<string, MerchantAccumulator>();

  for (const t of transactions) {
    const normalised = normaliseMerchant(t.description ?? '');
    const merchant = normalised || 'unknown';
    const amount = Number(t.amount);
    // Outflow (negative amount) contributes positively to spend; refund
    // (positive amount on a spend row) reduces it.
    const contribution = -amount;

    const existing = groups.get(merchant);
    if (existing) {
      existing.net += contribution;
      existing.transaction_count += 1;
      if (t.date < existing.first_seen) existing.first_seen = t.date;
      if (t.date > existing.last_seen) existing.last_seen = t.date;
    } else {
      groups.set(merchant, {
        merchant,
        net: contribution,
        transaction_count: 1,
        first_seen: t.date,
        last_seen: t.date,
      });
    }
  }

  return Array.from(groups.values())
    .map((g) => ({
      merchant: g.merchant,
      total_spend: Math.max(0, Math.round(g.net * 100) / 100),
      transaction_count: g.transaction_count,
      last_seen: g.last_seen,
      first_seen: g.first_seen,
    }))
    .sort((a, b) => b.total_spend - a.total_spend);
}
