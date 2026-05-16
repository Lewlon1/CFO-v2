import { describe, expect, it, vi } from 'vitest';
import { createFindTrendChangesTool } from './find-trend-changes';
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

interface TrendChangeResult {
  category: string;
  current_amount: number;
  baseline_amount: number;
  mom_delta_pct: number;
  mom_delta_amount: number;
  driving_merchants: Array<{ merchant: string; delta_amount: number }>;
  narrative_hint: string;
  data_confidence: 'high' | 'medium' | 'low';
}

interface ToolResult {
  filter?: { date_to: string; min_delta_pct: number; min_amount: number };
  currency?: string;
  windows?: {
    current: { month: string; total_spend: number; n_transactions: number };
    baseline: { month: string; total_spend: number; n_transactions: number };
  };
  accelerating?: TrendChangeResult[];
  decelerating?: TrendChangeResult[];
  result?: null;
  reason?: string;
  data_confidence?: { level: 'high' | 'medium' | 'low'; reason: string };
  error?: string;
}

describe('createFindTrendChangesTool — input schema', () => {
  it('accepts minimal input with sensible defaults', () => {
    const tool = createFindTrendChangesTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      date_to: '2026-04-30',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.min_delta_pct).toBe(20);
      expect(result.data.min_amount).toBe(20);
    }
  });

  it('accepts a custom min_delta_pct and min_amount', () => {
    const tool = createFindTrendChangesTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      date_to: '2026-04-30',
      min_delta_pct: 35,
      min_amount: 50,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.min_delta_pct).toBe(35);
      expect(result.data.min_amount).toBe(50);
    }
  });
});

describe('createFindTrendChangesTool — execute', () => {
  it('pins by user_id on the transactions query (RLS)', async () => {
    const { supabase, calls } = makeSupabaseStub({ rows: [] });
    const tool = createFindTrendChangesTool(makeCtx(supabase));

    await tool.execute({
      date_to: '2026-04-30',
      min_delta_pct: 20,
      min_amount: 20,
    });

    const userPins = calls.filter(
      (c) => c.method === 'eq' && c.args[0] === 'user_id' && c.args[1] === 'user-123',
    );
    expect(userPins.length).toBe(1);
  });

  it('applies the EXCLUDED_FROM_PL_PG_LIST not-in filter and pins soft-delete', async () => {
    const { supabase, calls } = makeSupabaseStub({ rows: [] });
    const tool = createFindTrendChangesTool(makeCtx(supabase));

    await tool.execute({
      date_to: '2026-04-30',
      min_delta_pct: 20,
      min_amount: 20,
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

  it('returns null with insufficient_history when only one month of data exists', async () => {
    // Only April rows; nothing in March → baseline is empty.
    const rows: StubRow[] = [
      { id: 't1', date: '2026-04-01', description: 'TESCO', amount: -40, category_id: 'groceries' },
      { id: 't2', date: '2026-04-10', description: 'WAITROSE', amount: -30, category_id: 'groceries' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindTrendChangesTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_to: '2026-04-30',
      min_delta_pct: 20,
      min_amount: 20,
    })) as ToolResult;

    expect(result.result).toBeNull();
    expect(result.reason).toBe('insufficient_history');
    expect(result.data_confidence?.level).toBe('low');
    expect(result.accelerating).toBeUndefined();
    expect(result.decelerating).toBeUndefined();
  });

  it('returns null with insufficient_history on completely empty data', async () => {
    const { supabase } = makeSupabaseStub({ rows: [] });
    const tool = createFindTrendChangesTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_to: '2026-04-30',
      min_delta_pct: 20,
      min_amount: 20,
    })) as ToolResult;

    expect(result.result).toBeNull();
    expect(result.reason).toBe('insufficient_history');
  });

  it('surfaces a category that grew 50% MoM as accelerating', async () => {
    // groceries: March 100, April 150 (+50%). 50/max(100,150)=33.3% delta.
    // eat_drinking_out: March 80, April 100 (+25%). 20/max(80,100)=20% delta.
    // Both clear min_delta_pct 20. Both have ≥20 current spend.
    // Pad each month with extra transactions so it isn't 'thin'.
    const rows: StubRow[] = [
      // --- March (baseline) ---
      { id: 'b1', date: '2026-03-05', description: 'TESCO', amount: -50, category_id: 'groceries' },
      { id: 'b2', date: '2026-03-10', description: 'TESCO', amount: -50, category_id: 'groceries' },
      { id: 'b3', date: '2026-03-12', description: 'STARBUCKS', amount: -40, category_id: 'eat_drinking_out' },
      { id: 'b4', date: '2026-03-18', description: 'COSTA', amount: -40, category_id: 'eat_drinking_out' },
      { id: 'b5', date: '2026-03-02', description: 'BOOTS', amount: -15, category_id: 'health_pharmacy' },
      { id: 'b6', date: '2026-03-06', description: 'AMAZON', amount: -22, category_id: 'shopping' },
      { id: 'b7', date: '2026-03-09', description: 'UBER', amount: -12, category_id: 'transport' },
      { id: 'b8', date: '2026-03-14', description: 'LIDL', amount: -8, category_id: 'groceries' },
      { id: 'b9', date: '2026-03-17', description: 'PRET', amount: -7, category_id: 'eat_drinking_out' },
      { id: 'b10', date: '2026-03-22', description: 'TFL', amount: -5, category_id: 'transport' },
      { id: 'b11', date: '2026-03-25', description: 'AMAZON', amount: -10, category_id: 'shopping' },
      // --- April (current) ---
      { id: 'c1', date: '2026-04-05', description: 'TESCO', amount: -75, category_id: 'groceries' },
      { id: 'c2', date: '2026-04-10', description: 'TESCO', amount: -75, category_id: 'groceries' },
      { id: 'c3', date: '2026-04-12', description: 'STARBUCKS', amount: -50, category_id: 'eat_drinking_out' },
      { id: 'c4', date: '2026-04-18', description: 'COSTA', amount: -50, category_id: 'eat_drinking_out' },
      { id: 'c5', date: '2026-04-03', description: 'BOOTS', amount: -14, category_id: 'health_pharmacy' },
      { id: 'c6', date: '2026-04-07', description: 'AMAZON', amount: -20, category_id: 'shopping' },
      { id: 'c7', date: '2026-04-09', description: 'UBER', amount: -11, category_id: 'transport' },
      { id: 'c8', date: '2026-04-14', description: 'LIDL', amount: -8, category_id: 'groceries' },
      { id: 'c9', date: '2026-04-17', description: 'PRET', amount: -7, category_id: 'eat_drinking_out' },
      { id: 'c10', date: '2026-04-22', description: 'TFL', amount: -6, category_id: 'transport' },
      { id: 'c11', date: '2026-04-25', description: 'AMAZON', amount: -10, category_id: 'shopping' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindTrendChangesTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_to: '2026-04-30',
      min_delta_pct: 20,
      min_amount: 20,
    })) as ToolResult;

    expect(result.result).toBeUndefined();
    expect(result.windows?.current.month).toBe('2026-04');
    expect(result.windows?.baseline.month).toBe('2026-03');

    const groceries = result.accelerating?.find((c) => c.category === 'groceries');
    expect(groceries).toBeDefined();
    expect(groceries?.current_amount).toBe(158);
    expect(groceries?.baseline_amount).toBe(108);
    expect(groceries?.mom_delta_amount).toBe(50);
    // 50 / 158 ≈ 31.6%
    expect(groceries?.mom_delta_pct).toBeGreaterThanOrEqual(30);
    expect(groceries?.mom_delta_pct).toBeLessThanOrEqual(32);
    expect(groceries?.narrative_hint).toBeTruthy();
    // No value-vocab.
    expect(groceries?.narrative_hint.toLowerCase()).not.toContain('leak');
    expect(groceries?.narrative_hint.toLowerCase()).not.toContain('burden');
    expect(groceries?.narrative_hint.toLowerCase()).not.toContain('foundation');
    expect(groceries?.narrative_hint.toLowerCase()).not.toContain('investment');
  });

  it('surfaces a category that fell 30% MoM as decelerating', async () => {
    // eat_drinking_out: March 200, April 140 → delta -60 / max(200,140)=200 → -30%.
    // Other categories stay flat so they don't get surfaced.
    const rows: StubRow[] = [
      // --- March baseline (thick) ---
      { id: 'b1', date: '2026-03-05', description: 'STARBUCKS', amount: -100, category_id: 'eat_drinking_out' },
      { id: 'b2', date: '2026-03-10', description: 'COSTA', amount: -100, category_id: 'eat_drinking_out' },
      { id: 'b3', date: '2026-03-02', description: 'TESCO', amount: -50, category_id: 'groceries' },
      { id: 'b4', date: '2026-03-15', description: 'TESCO', amount: -50, category_id: 'groceries' },
      { id: 'b5', date: '2026-03-20', description: 'UBER', amount: -15, category_id: 'transport' },
      { id: 'b6', date: '2026-03-22', description: 'TFL', amount: -10, category_id: 'transport' },
      { id: 'b7', date: '2026-03-25', description: 'BOOTS', amount: -10, category_id: 'health_pharmacy' },
      { id: 'b8', date: '2026-03-27', description: 'AMAZON', amount: -10, category_id: 'shopping' },
      { id: 'b9', date: '2026-03-28', description: 'AMAZON', amount: -15, category_id: 'shopping' },
      { id: 'b10', date: '2026-03-29', description: 'LIDL', amount: -10, category_id: 'groceries' },
      // --- April current ---
      { id: 'c1', date: '2026-04-08', description: 'STARBUCKS', amount: -70, category_id: 'eat_drinking_out' },
      { id: 'c2', date: '2026-04-12', description: 'COSTA', amount: -70, category_id: 'eat_drinking_out' },
      { id: 'c3', date: '2026-04-03', description: 'TESCO', amount: -50, category_id: 'groceries' },
      { id: 'c4', date: '2026-04-18', description: 'TESCO', amount: -50, category_id: 'groceries' },
      { id: 'c5', date: '2026-04-20', description: 'UBER', amount: -15, category_id: 'transport' },
      { id: 'c6', date: '2026-04-22', description: 'TFL', amount: -10, category_id: 'transport' },
      { id: 'c7', date: '2026-04-25', description: 'BOOTS', amount: -10, category_id: 'health_pharmacy' },
      { id: 'c8', date: '2026-04-27', description: 'AMAZON', amount: -10, category_id: 'shopping' },
      { id: 'c9', date: '2026-04-28', description: 'AMAZON', amount: -15, category_id: 'shopping' },
      { id: 'c10', date: '2026-04-29', description: 'LIDL', amount: -10, category_id: 'groceries' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindTrendChangesTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_to: '2026-04-30',
      min_delta_pct: 20,
      min_amount: 20,
    })) as ToolResult;

    const eatingOut = result.decelerating?.find(
      (c) => c.category === 'eat_drinking_out',
    );
    expect(eatingOut).toBeDefined();
    expect(eatingOut?.baseline_amount).toBe(200);
    expect(eatingOut?.current_amount).toBe(140);
    expect(eatingOut?.mom_delta_amount).toBe(-60);
    expect(eatingOut?.mom_delta_pct).toBe(-30);
    expect(eatingOut?.narrative_hint).toBeTruthy();
  });

  it('does not surface a category whose delta_pct sits below min_delta_pct', async () => {
    // groceries: 100 → 115 → +15% on max(100,115)=115 → 13.04%. Below default 20%.
    const rows: StubRow[] = [
      // March baseline
      { id: 'b1', date: '2026-03-05', description: 'TESCO', amount: -50, category_id: 'groceries' },
      { id: 'b2', date: '2026-03-15', description: 'TESCO', amount: -50, category_id: 'groceries' },
      { id: 'b3', date: '2026-03-10', description: 'UBER', amount: -20, category_id: 'transport' },
      { id: 'b4', date: '2026-03-20', description: 'TFL', amount: -20, category_id: 'transport' },
      { id: 'b5', date: '2026-03-22', description: 'BOOTS', amount: -10, category_id: 'health_pharmacy' },
      { id: 'b6', date: '2026-03-23', description: 'AMAZON', amount: -10, category_id: 'shopping' },
      { id: 'b7', date: '2026-03-25', description: 'STARBUCKS', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'b8', date: '2026-03-26', description: 'COSTA', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'b9', date: '2026-03-27', description: 'PRET', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'b10', date: '2026-03-28', description: 'LIDL', amount: -5, category_id: 'groceries' },
      // April current
      { id: 'c1', date: '2026-04-05', description: 'TESCO', amount: -58, category_id: 'groceries' },
      { id: 'c2', date: '2026-04-15', description: 'TESCO', amount: -57, category_id: 'groceries' },
      { id: 'c3', date: '2026-04-10', description: 'UBER', amount: -20, category_id: 'transport' },
      { id: 'c4', date: '2026-04-20', description: 'TFL', amount: -20, category_id: 'transport' },
      { id: 'c5', date: '2026-04-22', description: 'BOOTS', amount: -10, category_id: 'health_pharmacy' },
      { id: 'c6', date: '2026-04-23', description: 'AMAZON', amount: -10, category_id: 'shopping' },
      { id: 'c7', date: '2026-04-25', description: 'STARBUCKS', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'c8', date: '2026-04-26', description: 'COSTA', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'c9', date: '2026-04-27', description: 'PRET', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'c10', date: '2026-04-28', description: 'LIDL', amount: -5, category_id: 'groceries' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindTrendChangesTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_to: '2026-04-30',
      min_delta_pct: 20,
      min_amount: 20,
    })) as ToolResult;

    const groceries = result.accelerating?.find((c) => c.category === 'groceries');
    expect(groceries).toBeUndefined();
  });

  it('shows a brand-new category (no baseline spend) as +100% accelerating', async () => {
    // April has 'subscriptions' but March doesn't. delta = curr / max(0, curr) * 100 = 100%.
    const rows: StubRow[] = [
      // March baseline
      { id: 'b1', date: '2026-03-05', description: 'TESCO', amount: -50, category_id: 'groceries' },
      { id: 'b2', date: '2026-03-15', description: 'TESCO', amount: -50, category_id: 'groceries' },
      { id: 'b3', date: '2026-03-10', description: 'UBER', amount: -20, category_id: 'transport' },
      { id: 'b4', date: '2026-03-20', description: 'TFL', amount: -20, category_id: 'transport' },
      { id: 'b5', date: '2026-03-22', description: 'BOOTS', amount: -10, category_id: 'health_pharmacy' },
      { id: 'b6', date: '2026-03-23', description: 'AMAZON', amount: -10, category_id: 'shopping' },
      { id: 'b7', date: '2026-03-25', description: 'STARBUCKS', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'b8', date: '2026-03-26', description: 'COSTA', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'b9', date: '2026-03-27', description: 'PRET', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'b10', date: '2026-03-28', description: 'LIDL', amount: -5, category_id: 'groceries' },
      // April current — incl. NEW subscriptions category
      { id: 'c1', date: '2026-04-05', description: 'TESCO', amount: -50, category_id: 'groceries' },
      { id: 'c2', date: '2026-04-15', description: 'TESCO', amount: -50, category_id: 'groceries' },
      { id: 'c3', date: '2026-04-10', description: 'UBER', amount: -20, category_id: 'transport' },
      { id: 'c4', date: '2026-04-20', description: 'TFL', amount: -20, category_id: 'transport' },
      { id: 'c5', date: '2026-04-22', description: 'BOOTS', amount: -10, category_id: 'health_pharmacy' },
      { id: 'c6', date: '2026-04-23', description: 'AMAZON', amount: -10, category_id: 'shopping' },
      { id: 'c7', date: '2026-04-25', description: 'STARBUCKS', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'c8', date: '2026-04-26', description: 'COSTA', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'c9', date: '2026-04-27', description: 'PRET', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'c10', date: '2026-04-28', description: 'LIDL', amount: -5, category_id: 'groceries' },
      { id: 'c11', date: '2026-04-12', description: 'NETFLIX', amount: -15, category_id: 'subscriptions' },
      { id: 'c12', date: '2026-04-13', description: 'SPOTIFY', amount: -10, category_id: 'subscriptions' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindTrendChangesTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_to: '2026-04-30',
      min_delta_pct: 20,
      min_amount: 20,
    })) as ToolResult;

    const subs = result.accelerating?.find((c) => c.category === 'subscriptions');
    expect(subs).toBeDefined();
    expect(subs?.baseline_amount).toBe(0);
    expect(subs?.current_amount).toBe(25);
    expect(subs?.mom_delta_amount).toBe(25);
    expect(subs?.mom_delta_pct).toBe(100);
    // Brand-new + driving merchant → hint flags 'new merchant'.
    expect(subs?.narrative_hint.toLowerCase()).toContain('new merchant');
    expect(subs?.driving_merchants.length).toBeGreaterThan(0);
  });

  it('orders driving_merchants by signed delta magnitude per direction', async () => {
    // Accelerating category: 3 merchants, one big riser, one small riser, one faller.
    // Faller must NOT appear in driving_merchants. Big riser first.
    //
    // groceries:
    //   TESCO   march 20 → april 80  (+60)
    //   LIDL    march 10 → april 25  (+15)
    //   ALDI    march 50 → april 30  (-20)  ← should be filtered out for accelerating
    //
    // Total: march 80 → april 135 → +55 / 135 = 40.7% → accelerating, ≥20%.
    const rows: StubRow[] = [
      // March baseline — also pad to clear thin threshold
      { id: 'b1', date: '2026-03-05', description: 'TESCO', amount: -20, category_id: 'groceries' },
      { id: 'b2', date: '2026-03-15', description: 'LIDL', amount: -10, category_id: 'groceries' },
      { id: 'b3', date: '2026-03-20', description: 'ALDI', amount: -50, category_id: 'groceries' },
      { id: 'b4', date: '2026-03-08', description: 'UBER', amount: -20, category_id: 'transport' },
      { id: 'b5', date: '2026-03-12', description: 'TFL', amount: -20, category_id: 'transport' },
      { id: 'b6', date: '2026-03-22', description: 'BOOTS', amount: -10, category_id: 'health_pharmacy' },
      { id: 'b7', date: '2026-03-23', description: 'AMAZON', amount: -10, category_id: 'shopping' },
      { id: 'b8', date: '2026-03-25', description: 'STARBUCKS', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'b9', date: '2026-03-26', description: 'COSTA', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'b10', date: '2026-03-27', description: 'PRET', amount: -10, category_id: 'eat_drinking_out' },
      // April current
      { id: 'c1', date: '2026-04-05', description: 'TESCO', amount: -80, category_id: 'groceries' },
      { id: 'c2', date: '2026-04-15', description: 'LIDL', amount: -25, category_id: 'groceries' },
      { id: 'c3', date: '2026-04-20', description: 'ALDI', amount: -30, category_id: 'groceries' },
      { id: 'c4', date: '2026-04-08', description: 'UBER', amount: -20, category_id: 'transport' },
      { id: 'c5', date: '2026-04-12', description: 'TFL', amount: -20, category_id: 'transport' },
      { id: 'c6', date: '2026-04-22', description: 'BOOTS', amount: -10, category_id: 'health_pharmacy' },
      { id: 'c7', date: '2026-04-23', description: 'AMAZON', amount: -10, category_id: 'shopping' },
      { id: 'c8', date: '2026-04-25', description: 'STARBUCKS', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'c9', date: '2026-04-26', description: 'COSTA', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'c10', date: '2026-04-27', description: 'PRET', amount: -10, category_id: 'eat_drinking_out' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindTrendChangesTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_to: '2026-04-30',
      min_delta_pct: 20,
      min_amount: 20,
    })) as ToolResult;

    const groceries = result.accelerating?.find((c) => c.category === 'groceries');
    expect(groceries).toBeDefined();
    const drivers = groceries?.driving_merchants ?? [];
    // Only positive-delta merchants in driving list for an accelerating category.
    expect(drivers.every((d) => d.delta_amount > 0)).toBe(true);
    // Largest positive delta first.
    expect(drivers[0]?.merchant).toBe('tesco');
    expect(drivers[0]?.delta_amount).toBe(60);
    expect(drivers[1]?.merchant).toBe('lidl');
    expect(drivers[1]?.delta_amount).toBe(15);
    // ALDI (-20) is excluded for accelerating direction.
    expect(drivers.find((d) => d.merchant === 'aldi')).toBeUndefined();
  });

  it('returns a friendly error when the DB query fails', async () => {
    const { supabase } = makeSupabaseStub({ error: { message: 'boom' } });
    const tool = createFindTrendChangesTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_to: '2026-04-30',
      min_delta_pct: 20,
      min_amount: 20,
    })) as ToolResult;

    expect(result.error).toBe('Could not fetch transactions. Please try again.');
  });
});
