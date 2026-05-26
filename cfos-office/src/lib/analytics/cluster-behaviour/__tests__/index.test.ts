import { describe, it, expect, vi } from 'vitest';
import { getClusterBehaviour } from '../index';
import type { SupabaseClient } from '@supabase/supabase-js';

// Mock Supabase client builder. The Supabase query builder is thenable, with
// methods like .select(), .eq(), .gte(), .order(), .limit(), .is(). We resolve
// the chain when awaited, returning hard-coded data.
//
// Distinguishes the two transactions queries by detecting `.limit(1)`:
//   - getFirstSeenForCluster calls .limit(1)
//   - getTransactionDatesForCluster does not
function makeMockClient(handlers: {
  merchantAggregates?: () => Promise<{ data: unknown[]; error: null }>;
  categoryAggregates?: () => Promise<{ data: unknown[]; error: null }>;
  transactions?: (filters: { description?: string; category_id?: string }) => Promise<{ data: unknown[]; error: null }>;
  firstSeenTransaction?: (filters: { description?: string; category_id?: string }) => Promise<{ data: unknown[]; error: null }>;
}): SupabaseClient {
  function chainable(resolveFn: () => Promise<{ data: unknown[]; error: null }>, state: Record<string, unknown>) {
    const obj: Record<string, unknown> = {};
    const passthroughs = ['select', 'gte', 'order', 'is'] as const;
    for (const m of passthroughs) {
      obj[m] = () => obj;
    }
    obj.eq = (col: string, val: unknown) => {
      state[col] = val;
      return obj;
    };
    obj.limit = (n: number) => {
      state.__limit = n;
      return obj;
    };
    obj.then = (cb: (r: unknown) => unknown) => resolveFn().then(cb);
    obj.catch = (cb: (r: unknown) => unknown) => resolveFn().catch(cb);
    return obj;
  }

  return {
    from: (table: string) => {
      const state: Record<string, unknown> = {};
      if (table === 'merchant_aggregates') {
        return chainable(() => {
          if (state.dominant_category_id) {
            return handlers.categoryAggregates?.() ?? Promise.resolve({ data: [], error: null });
          }
          return handlers.merchantAggregates?.() ?? Promise.resolve({ data: [], error: null });
        }, state);
      }
      if (table === 'transactions') {
        return chainable(() => {
          const isFirstSeen = state.__limit === 1;
          if (isFirstSeen) {
            return handlers.firstSeenTransaction?.({ description: state.description as string, category_id: state.category_id as string }) ?? Promise.resolve({ data: [], error: null });
          }
          return handlers.transactions?.({ description: state.description as string, category_id: state.category_id as string }) ?? Promise.resolve({ data: [], error: null });
        }, state);
      }
      throw new Error(`Unexpected table ${table}`);
    },
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
      merchantAggregates: () => Promise.resolve({ data: aggregates, error: null }),
      transactions: () => Promise.resolve({
        data: txDates.map((dt, i) => ({ date: dt, amount: txAmounts[i] })),
        error: null,
      }),
      firstSeenTransaction: () => Promise.resolve({
        data: [{ date: '2026-02-02' }],
        error: null,
      }),
    });

    const result = await getClusterBehaviour({
      userId: 'u1',
      clusterType: 'merchant',
      clusterId: 'POS PURCHASE PRET A MANGER',
      supabase,
    });

    expect(result.cluster_id).toBe('POS PURCHASE PRET A MANGER');
    expect(result.cluster_type).toBe('merchant');
    expect(result.recurrence.pattern_label).toBe('daily');
    expect(result.time_pattern.has_weekday_skew).toBe(true);
    expect(result.time_pattern.weekday_share).toBe(1);
    expect(result.amount_profile.consistency_label).toBe('fixed');
    expect(result.lifecycle.status).toBe('active');
    expect(result.summary).toContain('POS PURCHASE PRET A MANGER');
  });

  it('handles a merchant with no data gracefully (sparse pattern, zero confidence)', async () => {
    const supabase = makeMockClient({
      merchantAggregates: () => Promise.resolve({ data: [], error: null }),
      transactions: () => Promise.resolve({ data: [], error: null }),
      firstSeenTransaction: () => Promise.resolve({ data: [], error: null }),
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

  it('summary is a non-empty string', async () => {
    const supabase = makeMockClient({
      merchantAggregates: () => Promise.resolve({ data: [], error: null }),
      transactions: () => Promise.resolve({ data: [{ date: '2026-04-15', amount: -10 }], error: null }),
      firstSeenTransaction: () => Promise.resolve({ data: [{ date: '2026-04-15' }], error: null }),
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
});

// Suppress unused warnings on vi in the harness setup; vi could be removed if not needed
void vi;
