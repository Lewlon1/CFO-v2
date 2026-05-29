import { describe, it, expect, vi } from 'vitest';
import { getClusterBehaviour } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mock Supabase client builder. The Supabase query builder is thenable; we
// resolve when awaited. The handler resolves based on which builder methods
// were called — this lets the same `.from('merchant_aggregates')` call route
// to either resolveMerchantKeys (uses .ilike) or getMerchantAggregates
// (uses .in), and the same `.from('transactions')` route to either
// getTransactionDatesForCluster or getFirstSeenForCluster (uses .limit(1)).
function makeMockClient(handlers: {
  resolveMerchantKeys?: () => Array<{ merchant_key: string; transaction_count: number }>;
  merchantAggregates?: () => Array<Record<string, unknown>>;
  categoryAggregates?: () => Array<Record<string, unknown>>;
  transactions?: () => Array<{ date: string; amount: number }>;
  firstSeenTransaction?: () => Array<{ date: string }>;
}): SupabaseClient {
  function chainable(table: string, state: Record<string, unknown>) {
    const obj: Record<string, unknown> = {};
    const passthroughs = ['select', 'gte', 'order', 'is'] as const;
    for (const m of passthroughs) {
      obj[m] = () => obj;
    }
    obj.eq = (col: string, val: unknown) => {
      state[col] = val;
      return obj;
    };
    obj.ilike = () => {
      state.__ilike = true;
      return obj;
    };
    obj.in = (col: string, vals: unknown[]) => {
      state.__in_col = col;
      state.__in_vals = vals;
      return obj;
    };
    obj.limit = (n: number) => {
      state.__limit = n;
      return obj;
    };
    const resolveFn = () => {
      if (table === 'merchant_aggregates') {
        if (state.__ilike) {
          // resolveMerchantKeys
          return Promise.resolve({ data: handlers.resolveMerchantKeys?.() ?? [], error: null });
        }
        if (state.dominant_category_id) {
          return Promise.resolve({ data: handlers.categoryAggregates?.() ?? [], error: null });
        }
        return Promise.resolve({ data: handlers.merchantAggregates?.() ?? [], error: null });
      }
      if (table === 'transactions') {
        if (state.__limit === 1) {
          return Promise.resolve({ data: handlers.firstSeenTransaction?.() ?? [], error: null });
        }
        return Promise.resolve({ data: handlers.transactions?.() ?? [], error: null });
      }
      throw new Error(`Unexpected table ${table}`);
    };
    obj.then = (cb: (r: unknown) => unknown) => resolveFn().then(cb);
    obj.catch = (cb: (r: unknown) => unknown) => resolveFn().catch(cb);
    return obj;
  }

  return {
    from: (table: string) => chainable(table, {}),
  } as unknown as SupabaseClient;
}

describe('getClusterBehaviour', () => {
  it('returns a fully-populated shape for a clockwork weekday merchant', async () => {
    const monthStarts = ['2026-02-01', '2026-03-01', '2026-04-01'];
    const aggregates = monthStarts.map(ms => ({
      month_start: ms,
      transaction_count: 20,
      total_amount: -93,
      mean_amount: -4.65,
      stddev_amount: 0.2,
      first_seen: ms,
      last_seen: ms.replace(/-\d\d$/, '-28'),
      dow_array: [1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5],
    }));

    // Generate ~daily weekday transaction dates across 3 months
    const txDates: string[] = [];
    const txAmounts: number[] = [];
    let d = new Date('2026-02-02'); // Monday
    while (d <= new Date('2026-04-30')) {
      const dow = d.getUTCDay();
      if (dow >= 1 && dow <= 5) {
        txDates.push(d.toISOString().slice(0, 10));
        txAmounts.push(-4.65);
      }
      d = new Date(d.getTime() + 86_400_000);
    }

    const supabase = makeMockClient({
      resolveMerchantKeys: () => [{ merchant_key: 'POS PURCHASE PRET A MANGER', transaction_count: 60 }],
      merchantAggregates: () => aggregates,
      transactions: () => txDates.map((dt, i) => ({ date: dt, amount: txAmounts[i] })),
      firstSeenTransaction: () => [{ date: '2026-02-02' }],
    });

    const result = await getClusterBehaviour({
      userId: 'u1',
      clusterType: 'merchant',
      clusterId: 'Pret a Manger', // user-friendly name, not the full key
      supabase,
    });

    expect(result.cluster_id).toBe('Pret a Manger');
    expect(result.cluster_type).toBe('merchant');
    expect(result.recurrence.pattern_label).toBe('daily');
    expect(result.time_pattern.has_weekday_skew).toBe(true);
    expect(result.time_pattern.weekday_share).toBe(1);
    expect(result.amount_profile.consistency_label).toBe('fixed');
    expect(result.lifecycle.status).toBe('active');
    expect(result.summary).toContain('Pret a Manger');
  });

  it('returns sparse + zero-confidence shape when no merchant_keys resolve', async () => {
    const supabase = makeMockClient({
      resolveMerchantKeys: () => [], // no variants match the hint
    });

    const result = await getClusterBehaviour({
      userId: 'u1',
      clusterType: 'merchant',
      clusterId: 'DOES NOT EXIST',
      supabase,
    });

    expect(result.recurrence.pattern_label).toBe('sparse');
    expect(result.recurrence.confidence).toBeLessThan(0.5);
    expect(result.amount_profile.confidence).toBe(0);
    expect(result.lifecycle.status).toBe('new');
  });

  it('summary is a non-empty string for any resolved cluster', async () => {
    const supabase = makeMockClient({
      resolveMerchantKeys: () => [{ merchant_key: 'TEST', transaction_count: 1 }],
      merchantAggregates: () => [],
      transactions: () => [{ date: '2026-04-15', amount: -10 }],
      firstSeenTransaction: () => [{ date: '2026-04-15' }],
    });
    const result = await getClusterBehaviour({
      userId: 'u1',
      clusterType: 'merchant',
      clusterId: 'TEST',
      supabase,
    });
    expect(result.summary).toBeTypeOf('string');
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('rolls up multiple merchant_key variants under one hint (brand rollup)', async () => {
    // Simulate "Pollo Tropical" resolving to 2 variants (#142 + DRIVE THRU)
    // and both contributing to March aggregates.
    const supabase = makeMockClient({
      resolveMerchantKeys: () => [
        { merchant_key: 'POS PURCHASE POLLO TROPICAL #142', transaction_count: 13 },
        { merchant_key: 'POS PURCHASE POLLO TROPICAL DRIVE THRU', transaction_count: 9 },
      ],
      merchantAggregates: () => [
        // #142 in March
        { month_start: '2026-03-01', transaction_count: 8, total_amount: -73, mean_amount: -9.13, stddev_amount: 0.5, first_seen: '2026-03-02', last_seen: '2026-03-28', dow_array: [1, 2, 3, 4, 5, 1, 2, 3] },
        // DRIVE THRU in March
        { month_start: '2026-03-01', transaction_count: 5, total_amount: -47, mean_amount: -9.40, stddev_amount: 0.4, first_seen: '2026-03-04', last_seen: '2026-03-30', dow_array: [3, 4, 5, 1, 2] },
      ],
      transactions: () =>
        Array.from({ length: 13 }, (_, i) => ({
          date: `2026-03-${String(2 + i * 2).padStart(2, '0')}`,
          amount: -9.16,
        })),
      firstSeenTransaction: () => [{ date: '2026-02-02' }],
    });

    const result = await getClusterBehaviour({
      userId: 'u1',
      clusterType: 'merchant',
      clusterId: 'Pollo Tropical',
      supabase,
    });

    // The two variants should aggregate into a single March row inside the lib
    expect(result.amount_profile.mean_amount).toBeCloseTo(-9.16, 1);
    // lifecycle.first_seen comes from the global first-seen query, not aggregates
    expect(result.lifecycle.first_seen).toBe('2026-02-02');
  });
});

void vi;
