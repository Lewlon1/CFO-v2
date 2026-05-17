import { describe, expect, it, vi } from 'vitest';
import { createFindOutliersTool } from './find-outliers';
import type { ToolContext } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EXCLUDED_FROM_PL_PG_LIST } from '@/lib/analytics/categories';

interface StubRow {
  id: string;
  date: string;
  description: string | null;
  amount: number;
  category_id: string | null;
}

interface StubOptions {
  rows?: StubRow[] | null;
  error?: { message: string } | null;
}

// Chainable supabase stub. Tracks every call so RLS / filter assertions are easy.
function makeSupabaseStub(opts: StubOptions = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (onFulfilled: (v: unknown) => unknown) => Promise<unknown>;
  } = {} as never;

  const finalise = () =>
    Promise.resolve({
      data: opts.rows ?? [],
      error: opts.error ?? null,
    });

  for (const method of ['select', 'eq', 'gte', 'lte', 'is', 'not'] as const) {
    builder[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    });
  }
  builder.then = (onFulfilled: (v: unknown) => unknown) =>
    finalise().then(onFulfilled);

  const supabase = {
    from: vi.fn((table: string) => {
      calls.push({ method: 'from', args: [table] });
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { supabase, calls };
}

function makeCtx(supabase: SupabaseClient): ToolContext {
  return {
    supabase,
    userId: 'user-123',
    conversationId: 'conv-1',
    currency: 'GBP',
  };
}

interface OutlierResult {
  type: 'large_one_off' | 'first_time_merchant' | 'category_swing';
  transaction?: {
    id: string;
    date: string;
    merchant: string;
    amount: number;
    category: string | null;
  };
  merchant?: string;
  category?: string;
  context: {
    median_amount?: number;
    multiplier?: number;
    window_spend?: number;
    window_transaction_count?: number;
    share_of_window_pct?: number;
    sample_transactions?: Array<{ id: string; date: string; amount: number }>;
    window_per_day?: number;
    baseline_per_day?: number;
    driving_merchants?: Array<{ merchant: string; amount: number }>;
  };
  why_unusual: string;
}

interface ToolResult {
  filter?: {
    date_from: string;
    date_to: string;
    baseline_lookback_days: number;
  };
  currency?: string;
  window?: { n_transactions: number; n_days: number; total_spend: number };
  baseline?: { n_transactions: number; n_days: number };
  outliers?: OutlierResult[];
  data_confidence?: { level: 'high' | 'medium' | 'low'; reason: string };
  error?: string;
}

// Helper to generate dense baseline rows so the type-A/B/C guards don't
// skip everything. ~30 days of small transactions, no merchant repeats so
// they look "noise-like" relative to the test's outlier inputs.
function buildThickBaseline(): StubRow[] {
  const rows: StubRow[] = [];
  // 30 daily small transactions across baseline window (2026-01-01 → 2026-03-31).
  // Use distinct merchant strings so they don't accidentally match the window
  // merchants in any test.
  const startDates = [
    '2026-01-05', '2026-01-08', '2026-01-12', '2026-01-15', '2026-01-19',
    '2026-01-22', '2026-01-26', '2026-01-29',
    '2026-02-02', '2026-02-05', '2026-02-09', '2026-02-12', '2026-02-16',
    '2026-02-19', '2026-02-23', '2026-02-26',
    '2026-03-02', '2026-03-05', '2026-03-09', '2026-03-12', '2026-03-16',
    '2026-03-19', '2026-03-23', '2026-03-26',
  ];
  startDates.forEach((d, i) => {
    rows.push({
      id: `bg${i}`,
      date: d,
      // unique-ish merchant so it doesn't conflict with window merchants.
      description: `BASELINE_MERCHANT_${i}`,
      // Median around £30 — alternate 25/30/35 so the median is stable.
      amount: i % 3 === 0 ? -25 : i % 3 === 1 ? -30 : -35,
      category_id: 'eat_drinking_out',
    });
  });
  return rows;
}

describe('createFindOutliersTool — input schema', () => {
  it('accepts minimal input with sensible defaults', () => {
    const tool = createFindOutliersTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseline_lookback_days).toBe(90);
    }
  });

  it('accepts a custom baseline_lookback_days', () => {
    const tool = createFindOutliersTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      baseline_lookback_days: 180,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseline_lookback_days).toBe(180);
    }
  });

  it('rejects baseline_lookback_days outside the 30–365 range', () => {
    const tool = createFindOutliersTool(makeCtx(makeSupabaseStub().supabase));
    expect(
      tool.inputSchema.safeParse({
        date_from: '2026-04-01',
        date_to: '2026-04-30',
        baseline_lookback_days: 29,
      }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({
        date_from: '2026-04-01',
        date_to: '2026-04-30',
        baseline_lookback_days: 366,
      }).success,
    ).toBe(false);
  });
});

describe('createFindOutliersTool — execute', () => {
  it('pins by user_id on the transactions query (RLS)', async () => {
    const { supabase, calls } = makeSupabaseStub({ rows: [] });
    const tool = createFindOutliersTool(makeCtx(supabase));

    await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      baseline_lookback_days: 90,
    });

    const userPins = calls.filter(
      (c) => c.method === 'eq' && c.args[0] === 'user_id' && c.args[1] === 'user-123',
    );
    expect(userPins.length).toBe(1);
  });

  it('applies the EXCLUDED_FROM_PL_PG_LIST not-in filter and pins soft-delete', async () => {
    const { supabase, calls } = makeSupabaseStub({ rows: [] });
    const tool = createFindOutliersTool(makeCtx(supabase));

    await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      baseline_lookback_days: 90,
    });

    const notCalls = calls.filter((c) => c.method === 'not');
    expect(
      notCalls.some(
        (c) =>
          c.args[0] === 'category_id' &&
          c.args[1] === 'in' &&
          c.args[2] === EXCLUDED_FROM_PL_PG_LIST,
      ),
    ).toBe(true);

    const isCalls = calls.filter((c) => c.method === 'is');
    expect(
      isCalls.some((c) => c.args[0] === 'deleted_at' && c.args[1] === null),
    ).toBe(true);
  });

  it('returns empty outliers with low/medium confidence on empty data', async () => {
    const { supabase } = makeSupabaseStub({ rows: [] });
    const tool = createFindOutliersTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      baseline_lookback_days: 90,
    })) as ToolResult;

    expect(result.outliers).toEqual([]);
    // With 0 transactions across 120 days, confidence is 'medium' per
    // assessDataConfidence (≥30 days, <20 txns) — the helper sees days first.
    // Either medium or low is acceptable as a 'thin data' qualifier.
    expect(['low', 'medium']).toContain(result.data_confidence?.level);
    expect(result.window?.n_transactions).toBe(0);
    expect(result.baseline?.n_transactions).toBe(0);
    expect(result.currency).toBe('GBP');
    // All three types skipped — reason should mention them.
    expect(result.data_confidence?.reason).toContain('large_one_off');
    expect(result.data_confidence?.reason).toContain('first_time_merchant');
    expect(result.data_confidence?.reason).toContain('category_swing');
  });

  it('detects a large one-off transaction (~13× baseline median)', async () => {
    // Baseline: ~24 txns at ~£30 → median £30. One £400 window txn at a
    // new merchant → 13.3× the median. Not recurring (baseline has no
    // similar £400 amounts).
    const rows: StubRow[] = [
      ...buildThickBaseline(),
      {
        id: 'w1',
        date: '2026-04-15',
        description: 'BIG ONE OFF',
        amount: -400,
        category_id: 'shopping',
      },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindOutliersTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      baseline_lookback_days: 90,
    })) as ToolResult;

    const largeOneOffs = result.outliers?.filter((o) => o.type === 'large_one_off');
    expect(largeOneOffs?.length).toBe(1);
    const outlier = largeOneOffs![0];
    expect(outlier.transaction?.id).toBe('w1');
    expect(outlier.transaction?.amount).toBe(-400);
    expect(outlier.context.median_amount).toBe(30);
    // 400 / 30 = 13.33 → roundMultiplier gives 13.33.
    expect(outlier.context.multiplier).toBeGreaterThanOrEqual(13);
    expect(outlier.context.multiplier).toBeLessThanOrEqual(14);
    expect(outlier.why_unusual).toBeTruthy();
    // No value vocab.
    expect(outlier.why_unusual.toLowerCase()).not.toContain('leak');
    expect(outlier.why_unusual.toLowerCase()).not.toContain('burden');
    expect(outlier.why_unusual.toLowerCase()).not.toContain('foundation');
    expect(outlier.why_unusual.toLowerCase()).not.toContain('investment');
  });

  it('suppresses a large one-off when it matches a recurring same-merchant-same-amount pattern', async () => {
    // Baseline rent: £1000 x 3 months (Jan/Feb/Mar). Window April: another £1000.
    // £1000 ≥ 3× median (small baseline noise puts the median around ~£30
    // because we add the thick baseline noise too), but it IS recurring
    // because the same merchant has 3 baseline txns at ~£1000.
    const rows: StubRow[] = [
      ...buildThickBaseline(),
      { id: 'r1', date: '2026-01-01', description: 'LANDLORD INC', amount: -1000, category_id: 'rent' },
      { id: 'r2', date: '2026-02-01', description: 'LANDLORD INC', amount: -1000, category_id: 'rent' },
      { id: 'r3', date: '2026-03-01', description: 'LANDLORD INC', amount: -1000, category_id: 'rent' },
      // Window: another rent payment.
      { id: 'w-rent', date: '2026-04-01', description: 'LANDLORD INC', amount: -1000, category_id: 'rent' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindOutliersTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      baseline_lookback_days: 90,
    })) as ToolResult;

    const largeOneOffs = result.outliers?.filter((o) => o.type === 'large_one_off');
    // The rent txn is large vs median, but the same merchant has ≥2 baseline
    // entries within ±20% — must be suppressed.
    expect(largeOneOffs?.some((o) => o.transaction?.id === 'w-rent')).toBeFalsy();
  });

  it('detects a first-time merchant when share ≥ 5% of window spend', async () => {
    // Thick baseline + a brand new merchant in the window with multiple visits.
    // Window spend: 30 (existing-style) + 87 (new merchant) ≈ 117. New merchant
    // share = 87 / 117 ≈ 74% → well above 5%.
    const rows: StubRow[] = [
      ...buildThickBaseline(),
      // Window: one small txn at a baseline-known merchant (to inflate window total)
      // plus three visits to a brand-new merchant 'NEW CAFE'.
      { id: 'w0', date: '2026-04-02', description: 'BASELINE_MERCHANT_0', amount: -30, category_id: 'eat_drinking_out' },
      { id: 'nc1', date: '2026-04-05', description: 'NEW CAFE', amount: -29, category_id: 'eat_drinking_out' },
      { id: 'nc2', date: '2026-04-12', description: 'NEW CAFE', amount: -29, category_id: 'eat_drinking_out' },
      { id: 'nc3', date: '2026-04-18', description: 'NEW CAFE', amount: -29, category_id: 'eat_drinking_out' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindOutliersTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      baseline_lookback_days: 90,
    })) as ToolResult;

    const firstTime = result.outliers?.filter(
      (o) => o.type === 'first_time_merchant',
    );
    expect(firstTime?.length).toBeGreaterThanOrEqual(1);
    const newCafe = firstTime?.find((o) => o.merchant === 'new cafe');
    expect(newCafe).toBeDefined();
    expect(newCafe?.context.window_transaction_count).toBe(3);
    expect(newCafe?.context.window_spend).toBe(87);
    // 87 / (30 + 87) = 74.4%.
    expect(newCafe?.context.share_of_window_pct).toBeGreaterThanOrEqual(70);
    expect(newCafe?.context.sample_transactions?.length).toBe(3);
    expect(newCafe?.why_unusual).toBeTruthy();
    expect(newCafe?.why_unusual.toLowerCase()).not.toContain('leak');
  });

  it('rejects a first-time merchant when share is below 5% of window spend', async () => {
    // New merchant £2 vs window total ~£300 → <1% share.
    const rows: StubRow[] = [
      ...buildThickBaseline(),
      // Window — bulk of spend at baseline-known merchants so window total is large.
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `wb${i}`,
        date: `2026-04-${String(i + 1).padStart(2, '0')}`,
        description: `BASELINE_MERCHANT_${i}`,
        amount: -30 as number,
        category_id: 'eat_drinking_out',
      })),
      // Tiny new merchant — only £2.
      { id: 'tiny', date: '2026-04-20', description: 'TINY NEW SHOP', amount: -2, category_id: 'shopping' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindOutliersTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      baseline_lookback_days: 90,
    })) as ToolResult;

    const firstTime = result.outliers?.filter(
      (o) => o.type === 'first_time_merchant',
    );
    expect(firstTime?.some((o) => o.merchant === 'tiny new shop')).toBeFalsy();
  });

  it('detects a category swing when window per-day rate ≥3× baseline per-day rate', async () => {
    // Thick baseline (~24 transactions across 90 days) — baseline transport
    // spend is small (none of the thick baseline is transport).
    // Add 5 baseline transport days at £20 each = £100 across 90 days
    // → baseline_per_day = 100/90 ≈ 1.11.
    // Window: 4 transport days at £60 each = £240 across 30 days
    // → window_per_day = 240/30 = 8.
    // Multiplier ≈ 7.2 → above 3× threshold. window spend £240 ≥ £50.
    const rows: StubRow[] = [
      ...buildThickBaseline(),
      // Baseline transport — small, infrequent.
      { id: 'bt1', date: '2026-01-10', description: 'UBER', amount: -20, category_id: 'transport' },
      { id: 'bt2', date: '2026-01-20', description: 'TFL', amount: -20, category_id: 'transport' },
      { id: 'bt3', date: '2026-02-10', description: 'UBER', amount: -20, category_id: 'transport' },
      { id: 'bt4', date: '2026-02-20', description: 'TFL', amount: -20, category_id: 'transport' },
      { id: 'bt5', date: '2026-03-10', description: 'UBER', amount: -20, category_id: 'transport' },
      // Window transport — heavy, frequent.
      { id: 'wt1', date: '2026-04-05', description: 'UBER', amount: -60, category_id: 'transport' },
      { id: 'wt2', date: '2026-04-12', description: 'UBER', amount: -60, category_id: 'transport' },
      { id: 'wt3', date: '2026-04-18', description: 'UBER', amount: -60, category_id: 'transport' },
      { id: 'wt4', date: '2026-04-25', description: 'BOLT', amount: -60, category_id: 'transport' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindOutliersTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      baseline_lookback_days: 90,
    })) as ToolResult;

    const swings = result.outliers?.filter((o) => o.type === 'category_swing');
    const transport = swings?.find((o) => o.category === 'transport');
    expect(transport).toBeDefined();
    expect(transport?.context.window_spend).toBe(240);
    // baseline_per_day = 100/90 ≈ 1.11, window_per_day = 240/30 = 8.
    expect(transport?.context.baseline_per_day).toBeCloseTo(1.11, 1);
    expect(transport?.context.window_per_day).toBe(8);
    expect(transport?.context.multiplier).toBeGreaterThanOrEqual(3);
    expect(transport?.context.driving_merchants?.length).toBeGreaterThan(0);
    // Top driving merchant should be UBER (£180 of £240).
    expect(transport?.context.driving_merchants?.[0].merchant).toBe('uber');
    expect(transport?.why_unusual).toBeTruthy();
    expect(transport?.why_unusual.toLowerCase()).not.toContain('leak');
  });

  it('skips large_one_off when baseline is too thin and notes it in data_confidence.reason', async () => {
    // Baseline only has 3 transactions (< 10) → type A skipped.
    // Window has a single very large transaction.
    const rows: StubRow[] = [
      // Sparse baseline — 3 txns total.
      { id: 'b1', date: '2026-02-01', description: 'COFFEE', amount: -5, category_id: 'eat_drinking_out' },
      { id: 'b2', date: '2026-02-15', description: 'COFFEE', amount: -5, category_id: 'eat_drinking_out' },
      { id: 'b3', date: '2026-03-01', description: 'COFFEE', amount: -5, category_id: 'eat_drinking_out' },
      // Window: a huge one-off.
      { id: 'w1', date: '2026-04-10', description: 'BIG BUY', amount: -500, category_id: 'shopping' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindOutliersTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      baseline_lookback_days: 90,
    })) as ToolResult;

    // Type A must not fire.
    const largeOneOffs = result.outliers?.filter((o) => o.type === 'large_one_off');
    expect(largeOneOffs?.length ?? 0).toBe(0);

    // Confidence reason should mention the skip.
    expect(result.data_confidence?.reason).toContain('large_one_off');
  });

  it('returns a friendly error when the DB query fails', async () => {
    const { supabase } = makeSupabaseStub({ error: { message: 'boom' } });
    const tool = createFindOutliersTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      baseline_lookback_days: 90,
    })) as ToolResult;

    expect(result.error).toBe('Could not fetch transactions. Please try again.');
  });
});
