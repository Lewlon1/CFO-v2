import { describe, expect, it, vi } from 'vitest';
import { analyseGapV2 } from './gap-analyser';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Test fixtures ────────────────────────────────────────────────────────────
//
// Card ids referenced (must match SAMPLE_TRANSACTIONS in lib/value-map/constants.ts):
//
//   vm-rent          → housing            (granularity: category)
//   vm-groceries     → groceries          (granularity: category)
//   vm-gym           → health             (granularity: intent)
//   vm-takeaway      → eat_drinking_out   (granularity: intent)
//   vm-dinner-friends→ eat_drinking_out   (granularity: intent)
//   vm-streaming     → subscriptions      (granularity: intent)
//   vm-learning      → entertainment      (granularity: intent)
//   vm-electricity   → utilities_bills    (granularity: intent)
//   vm-clothes       → shopping           (granularity: intent)
//   vm-gift          → shopping           (granularity: intent)

interface VmRow {
  transaction_id: string;
  quadrant: string | null;
  confidence: number;
  created_at: string;
}

interface TxRow {
  id: string;
  amount: number;
  description: string | null;
  date: string;
  category_id: string | null;
  value_category: string | null;
}

interface PortraitUpsert {
  user_id: string;
  trait_type: string;
  trait_key: string;
  trait_value: string;
  confidence: number;
  evidence: string;
  source: string;
}

interface StubOpts {
  vmRows?: VmRow[];
  txRows?: TxRow[];
}

// Multi-table chainable stub. Dispatches by table name in .from().
//   - value_map_results: read-chain (select/eq/is/then)
//   - transactions:      read-chain (select/eq/lt/gte/is/then)
//   - financial_portrait: upsert sink (captures payloads)
function makeSupabaseStub(opts: StubOpts = {}) {
  const portraitUpserts: PortraitUpsert[] = [];

  const makeReadBuilder = <T>(rows: T[]) => {
    const builder: Record<string, ReturnType<typeof vi.fn>> & {
      then?: (onFulfilled: (v: unknown) => unknown) => Promise<unknown>;
    } = {} as never;
    const finalise = () => Promise.resolve({ data: rows, error: null });
    for (const method of ['select', 'eq', 'is', 'lt', 'gte', 'lte', 'in', 'not'] as const) {
      builder[method] = vi.fn(() => builder);
    }
    builder.then = (onFulfilled) => finalise().then(onFulfilled);
    return builder;
  };

  const makeUpsertBuilder = () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> & {
      then?: (onFulfilled: (v: unknown) => unknown) => Promise<unknown>;
    } = {} as never;
    builder.upsert = vi.fn((payload: PortraitUpsert) => {
      portraitUpserts.push(payload);
      return builder;
    });
    builder.then = (onFulfilled) =>
      Promise.resolve({ data: null, error: null }).then(onFulfilled);
    return builder;
  };

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'value_map_results') return makeReadBuilder(opts.vmRows ?? []);
      if (table === 'transactions') return makeReadBuilder(opts.txRows ?? []);
      if (table === 'financial_portrait') return makeUpsertBuilder();
      return makeReadBuilder([]);
    }),
  } as unknown as SupabaseClient;

  return { supabase, portraitUpserts };
}

const USER_ID = 'user-123';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('analyseGapV2 — no Value Map', () => {
  it('returns has_value_map=false with zeroed metadata when no VM rows exist', async () => {
    const { supabase } = makeSupabaseStub({ vmRows: [], txRows: [] });
    const result = await analyseGapV2(supabase, USER_ID, 3);

    expect(result.has_value_map).toBe(false);
    expect(result.gaps).toEqual([]);
    expect(result.value_map_metadata.baseline_taken_at).toBeNull();
    expect(result.value_map_metadata.classifications_count).toBe(0);
    expect(result.value_map_metadata.decided_count).toBe(0);
    expect(result.value_map_metadata.unsure_count).toBe(0);
    expect(result.value_map_metadata.staleness_days).toBe(0);
    expect(result.value_map_metadata.coverage_pct).toBe(0);
    expect(result.value_map_metadata.unclassified_categories).toEqual([]);
  });
});

describe('analyseGapV2 — single_intent shape', () => {
  it('emits one single_intent gap when category-precise cards share a quadrant', async () => {
    // vm-rent → housing (category granularity), foundation.
    // vm-groceries → groceries (category granularity), foundation.
    // Both housing-only paths should each emit a single_intent gap if there's
    // matching spend. Restrict to housing for clarity.
    const vmRows: VmRow[] = [
      {
        transaction_id: 'vm-rent',
        quadrant: 'foundation',
        confidence: 5,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];
    const txRows: TxRow[] = [
      // 3 months of housing rent.
      {
        id: 'tx-rent-1',
        amount: -1000,
        description: 'Monthly rent',
        date: '2026-03-01',
        category_id: 'housing',
        value_category: 'foundation',
      },
      {
        id: 'tx-rent-2',
        amount: -1000,
        description: 'Monthly rent',
        date: '2026-04-01',
        category_id: 'housing',
        value_category: 'foundation',
      },
      {
        id: 'tx-rent-3',
        amount: -1000,
        description: 'Monthly rent',
        date: '2026-05-01',
        category_id: 'housing',
        value_category: 'foundation',
      },
    ];
    const { supabase } = makeSupabaseStub({ vmRows, txRows });
    const result = await analyseGapV2(supabase, USER_ID, 3);

    expect(result.has_value_map).toBe(true);
    const housingGap = result.gaps.find(
      (g) => g.shape === 'single_intent' && g.category_id === 'housing',
    );
    expect(housingGap).toBeDefined();
    if (housingGap && housingGap.shape === 'single_intent') {
      expect(housingGap.stated_quadrant).toBe('foundation');
      expect(housingGap.stated_confidence).toBe(5);
      expect(housingGap.actual_monthly_spend).toBe(1000);
      // pct = 100% of total spend (only category present).
      expect(housingGap.pct_of_total_spending).toBe(100);
      expect(housingGap.actual_breakdown.foundation_pct).toBe(100);
      // top_merchants populated.
      expect(housingGap.top_merchants.length).toBeGreaterThan(0);
      // narrative_hint trimmed to a single sentence.
      expect(housingGap.narrative_hint.match(/[.!?]/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });
});

describe('analyseGapV2 — multi_intent shape', () => {
  it('emits multi_intent when two intent cards in the same category disagree', async () => {
    // vm-takeaway → eat_drinking_out, burden.
    // vm-dinner-friends → eat_drinking_out, investment.
    // Both intent-granularity within the same category → multi_intent.
    const vmRows: VmRow[] = [
      {
        transaction_id: 'vm-takeaway',
        quadrant: 'burden',
        confidence: 3,
        created_at: '2026-04-01T00:00:00Z',
      },
      {
        transaction_id: 'vm-dinner-friends',
        quadrant: 'investment',
        confidence: 4,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];
    // Transactions with real time-of-day so time_slices populate.
    const txRows: TxRow[] = [
      {
        id: 'tx-eat-1',
        amount: -25,
        description: 'GLOVO',
        date: '2026-04-08T22:30:00Z', // Wednesday late
        category_id: 'eat_drinking_out',
        value_category: null,
      },
      {
        id: 'tx-eat-2',
        amount: -45,
        description: 'RESTAURANT',
        date: '2026-04-12T20:30:00Z', // Sunday evening
        category_id: 'eat_drinking_out',
        value_category: null,
      },
    ];
    const { supabase } = makeSupabaseStub({ vmRows, txRows });
    const result = await analyseGapV2(supabase, USER_ID, 3);

    expect(result.has_value_map).toBe(true);
    const eatGap = result.gaps.find(
      (g) => g.shape === 'multi_intent' && g.category_id === 'eat_drinking_out',
    );
    expect(eatGap).toBeDefined();
    if (eatGap && eatGap.shape === 'multi_intent') {
      expect(eatGap.stated_intents.length).toBe(2);
      const quadrants = new Set(eatGap.stated_intents.map((i) => i.quadrant));
      expect(quadrants.has('burden')).toBe(true);
      expect(quadrants.has('investment')).toBe(true);
      // Both transactions had time-of-day → no skipped rows.
      expect(eatGap.skipped_undated_count).toBe(0);
      // time_slices populated.
      expect(Object.keys(eatGap.time_slices).length).toBeGreaterThan(0);
      // Total spend captured.
      expect(eatGap.category_monthly_total).toBeGreaterThan(0);
    }
  });
});

describe('analyseGapV2 — all-unsure paths', () => {
  it('emits no gap and adds to unclassified_categories when quadrant is null', async () => {
    const vmRows: VmRow[] = [
      {
        transaction_id: 'vm-streaming',
        quadrant: null,
        confidence: 0,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];
    // Add some subscription spend so the test isn't trivially empty.
    const txRows: TxRow[] = [
      {
        id: 'tx-sub-1',
        amount: -11,
        description: 'NETFLIX',
        date: '2026-04-01T12:00:00Z',
        category_id: 'subscriptions',
        value_category: null,
      },
    ];
    const { supabase } = makeSupabaseStub({ vmRows, txRows });
    const result = await analyseGapV2(supabase, USER_ID, 3);

    expect(result.has_value_map).toBe(true);
    // No gap entry for this category.
    expect(
      result.gaps.find((g) => g.category_id === 'subscriptions' && g.shape !== 'coverage_gap'),
    ).toBeUndefined();
    expect(result.value_map_metadata.unclassified_categories).toContain('subscriptions');
    expect(result.value_map_metadata.unsure_count).toBe(1);
    expect(result.value_map_metadata.decided_count).toBe(0);
  });

  it("treats 'unsure' (string) the same as null", async () => {
    const vmRows: VmRow[] = [
      {
        transaction_id: 'vm-clothes',
        quadrant: 'unsure',
        confidence: 0,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];
    const txRows: TxRow[] = [];
    const { supabase } = makeSupabaseStub({ vmRows, txRows });
    const result = await analyseGapV2(supabase, USER_ID, 3);

    expect(result.has_value_map).toBe(true);
    expect(result.value_map_metadata.unclassified_categories).toContain('shopping');
    expect(result.value_map_metadata.unsure_count).toBe(1);
    expect(result.value_map_metadata.decided_count).toBe(0);
    // No gap entry for shopping.
    expect(
      result.gaps.find((g) => g.category_id === 'shopping' && g.shape !== 'coverage_gap'),
    ).toBeUndefined();
  });
});

describe('analyseGapV2 — coverage_gap shape', () => {
  it('emits a coverage_gap for a category with actual spend but no VM card', async () => {
    // VM has only rent (housing). Transport spend has no VM card → coverage_gap.
    const vmRows: VmRow[] = [
      {
        transaction_id: 'vm-rent',
        quadrant: 'foundation',
        confidence: 5,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];
    const txRows: TxRow[] = [
      // 600 over 3 months = 200/mo, well above 30/mo threshold.
      {
        id: 'tx-tr-1',
        amount: -200,
        description: 'UBER',
        date: '2026-03-05T10:00:00Z',
        category_id: 'transport',
        value_category: null,
      },
      {
        id: 'tx-tr-2',
        amount: -200,
        description: 'METRO',
        date: '2026-04-05T10:00:00Z',
        category_id: 'transport',
        value_category: null,
      },
      {
        id: 'tx-tr-3',
        amount: -200,
        description: 'UBER',
        date: '2026-05-05T10:00:00Z',
        category_id: 'transport',
        value_category: null,
      },
    ];
    const { supabase } = makeSupabaseStub({ vmRows, txRows });
    const result = await analyseGapV2(supabase, USER_ID, 3);

    const transportCov = result.gaps.find(
      (g) => g.shape === 'coverage_gap' && g.category_id === 'transport',
    );
    expect(transportCov).toBeDefined();
    if (transportCov && transportCov.shape === 'coverage_gap') {
      expect(transportCov.monthly_total).toBe(200);
      expect(transportCov.share_of_spend_pct).toBeGreaterThan(0);
    }
  });

  it('does NOT emit a coverage_gap when monthly spend is below the noise threshold', async () => {
    const vmRows: VmRow[] = [
      {
        transaction_id: 'vm-rent',
        quadrant: 'foundation',
        confidence: 5,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];
    // €15 over 3 months = €5/mo — well below €30/mo threshold.
    const txRows: TxRow[] = [
      {
        id: 'tx-micro-1',
        amount: -5,
        description: 'TIP',
        date: '2026-03-05T10:00:00Z',
        category_id: 'eat_drinking_out',
        value_category: null,
      },
      {
        id: 'tx-micro-2',
        amount: -5,
        description: 'TIP',
        date: '2026-04-05T10:00:00Z',
        category_id: 'eat_drinking_out',
        value_category: null,
      },
      {
        id: 'tx-micro-3',
        amount: -5,
        description: 'TIP',
        date: '2026-05-05T10:00:00Z',
        category_id: 'eat_drinking_out',
        value_category: null,
      },
    ];
    const { supabase } = makeSupabaseStub({ vmRows, txRows });
    const result = await analyseGapV2(supabase, USER_ID, 3);

    const microCov = result.gaps.find(
      (g) => g.shape === 'coverage_gap' && g.category_id === 'eat_drinking_out',
    );
    expect(microCov).toBeUndefined();
  });
});

describe('analyseGapV2 — value_map_metadata', () => {
  it('computes staleness_days from the earliest VM row', async () => {
    // Use a 90-day-old baseline so staleness is a sane positive number.
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const vmRows: VmRow[] = [
      {
        transaction_id: 'vm-rent',
        quadrant: 'foundation',
        confidence: 5,
        created_at: ninetyDaysAgo,
      },
    ];
    const { supabase } = makeSupabaseStub({ vmRows, txRows: [] });
    const result = await analyseGapV2(supabase, USER_ID, 3);

    expect(result.value_map_metadata.baseline_taken_at).toBe(ninetyDaysAgo);
    // Within 1 day of 90 to allow for timing skew during the test run.
    expect(result.value_map_metadata.staleness_days).toBeGreaterThanOrEqual(89);
    expect(result.value_map_metadata.staleness_days).toBeLessThanOrEqual(91);
  });

  it('computes coverage_pct as stated/actual categories intersect', async () => {
    // Stated: housing (vm-rent). Actual: housing + transport.
    // Intersect: 1 (housing). actual_categories: 2 (housing, transport).
    // coverage_pct = 1/2 = 50%.
    const vmRows: VmRow[] = [
      {
        transaction_id: 'vm-rent',
        quadrant: 'foundation',
        confidence: 5,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];
    const txRows: TxRow[] = [
      {
        id: 'tx-h1',
        amount: -1000,
        description: 'Rent',
        date: '2026-03-01T10:00:00Z',
        category_id: 'housing',
        value_category: 'foundation',
      },
      {
        id: 'tx-t1',
        amount: -100,
        description: 'UBER',
        date: '2026-03-05T10:00:00Z',
        category_id: 'transport',
        value_category: null,
      },
      // Bring transport above the coverage-gap threshold so it shows up as a
      // coverage_gap (and contributes to the actual_categories set).
      {
        id: 'tx-t2',
        amount: -100,
        description: 'METRO',
        date: '2026-04-05T10:00:00Z',
        category_id: 'transport',
        value_category: null,
      },
      {
        id: 'tx-t3',
        amount: -100,
        description: 'UBER',
        date: '2026-05-05T10:00:00Z',
        category_id: 'transport',
        value_category: null,
      },
    ];
    const { supabase } = makeSupabaseStub({ vmRows, txRows });
    const result = await analyseGapV2(supabase, USER_ID, 3);

    expect(result.value_map_metadata.coverage_pct).toBe(50);
  });
});
