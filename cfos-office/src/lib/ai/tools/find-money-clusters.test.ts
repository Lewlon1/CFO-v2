import { describe, expect, it, vi } from 'vitest';
import { createFindMoneyClustersTool } from './find-money-clusters';
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

interface ToolResult {
  filter?: { date_from: string; date_to: string; min_share_pct: number };
  currency?: string;
  window?: { n_transactions: number; n_days: number };
  stories?: Array<{
    type: 'merchant_in_category' | 'dominant_category' | 'recurring_merchant';
    headline: string;
    magnitude: { amount: number; currency: string; share_pct: number };
    merchants: string[];
    comparison: string;
    sample_transactions: Array<{
      id: string;
      date: string;
      merchant: string;
      amount: number;
    }>;
    narrative_hint: string;
    data_confidence: 'high' | 'medium' | 'low' | null;
  }>;
  data_confidence?: 'high' | 'medium' | 'low';
  error?: string;
}

describe('createFindMoneyClustersTool — input schema', () => {
  it('accepts minimal input with sensible defaults', () => {
    const tool = createFindMoneyClustersTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.min_share_pct).toBe(25);
    }
  });

  it('rejects min_share_pct outside 0–100', () => {
    const tool = createFindMoneyClustersTool(makeCtx(makeSupabaseStub().supabase));
    expect(
      tool.inputSchema.safeParse({
        date_from: '2026-04-01',
        date_to: '2026-04-30',
        min_share_pct: 101,
      }).success,
    ).toBe(false);
    expect(
      tool.inputSchema.safeParse({
        date_from: '2026-04-01',
        date_to: '2026-04-30',
        min_share_pct: -1,
      }).success,
    ).toBe(false);
  });
});

describe('createFindMoneyClustersTool — execute', () => {
  it('pins by user_id on the transactions query (RLS)', async () => {
    const { supabase, calls } = makeSupabaseStub({ rows: [] });
    const tool = createFindMoneyClustersTool(makeCtx(supabase));

    await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      min_share_pct: 25,
    });

    const userPins = calls.filter(
      (c) => c.method === 'eq' && c.args[0] === 'user_id' && c.args[1] === 'user-123',
    );
    expect(userPins.length).toBe(1);
  });

  it('applies the EXCLUDED_FROM_PL_PG_LIST not-in filter', async () => {
    const { supabase, calls } = makeSupabaseStub({ rows: [] });
    const tool = createFindMoneyClustersTool(makeCtx(supabase));

    await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      min_share_pct: 25,
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
  });

  it('pins soft-delete (deleted_at IS NULL)', async () => {
    const { supabase, calls } = makeSupabaseStub({ rows: [] });
    const tool = createFindMoneyClustersTool(makeCtx(supabase));

    await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      min_share_pct: 25,
    });

    const isCalls = calls.filter((c) => c.method === 'is');
    expect(
      isCalls.some((c) => c.args[0] === 'deleted_at' && c.args[1] === null),
    ).toBe(true);
  });

  it('returns empty stories and low confidence on empty data', async () => {
    const { supabase } = makeSupabaseStub({ rows: [] });
    const tool = createFindMoneyClustersTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-08', // 8 days → low confidence
      min_share_pct: 25,
    })) as ToolResult;

    expect(result.stories).toEqual([]);
    expect(result.data_confidence).toBe('low');
    expect(result.window?.n_transactions).toBe(0);
    expect(result.currency).toBe('GBP');
  });

  it('emits a merchant_in_category story when one merchant takes ≥40% of a category', async () => {
    // eat_drinking_out total = 100. Glovo = 50 (50%). Threshold is 40% → emit.
    // groceries total = 100. Tesco = 60 (60%). Also ≥40% → emit.
    // The recurring detector should NOT trigger because amounts vary too much.
    const rows: StubRow[] = [
      { id: 't1', date: '2026-04-01', description: 'GLOVO', amount: -25, category_id: 'eat_drinking_out' },
      { id: 't2', date: '2026-04-05', description: 'GLOVO', amount: -25, category_id: 'eat_drinking_out' },
      { id: 't3', date: '2026-04-10', description: 'STARBUCKS', amount: -15, category_id: 'eat_drinking_out' },
      { id: 't4', date: '2026-04-15', description: 'COSTA', amount: -20, category_id: 'eat_drinking_out' },
      { id: 't5', date: '2026-04-20', description: 'PRET', amount: -15, category_id: 'eat_drinking_out' },
      { id: 't6', date: '2026-04-02', description: 'TESCO', amount: -60, category_id: 'groceries' },
      { id: 't7', date: '2026-04-12', description: 'WAITROSE', amount: -25, category_id: 'groceries' },
      { id: 't8', date: '2026-04-22', description: 'M&S', amount: -15, category_id: 'groceries' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindMoneyClustersTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      // Set min_share_pct higher than either category's share so dominant_category
      // stays silent and we can isolate the merchant_in_category trigger.
      min_share_pct: 80,
    })) as ToolResult;

    const merchantStories = result.stories?.filter(
      (s) => s.type === 'merchant_in_category',
    );
    expect(merchantStories?.length).toBe(2);

    const glovoStory = merchantStories?.find((s) => s.merchants[0] === 'glovo');
    expect(glovoStory).toBeDefined();
    expect(glovoStory?.headline).toContain('eat_drinking_out');
    expect(glovoStory?.magnitude.share_pct).toBe(50);
    expect(glovoStory?.magnitude.amount).toBe(50);
    expect(glovoStory?.sample_transactions.length).toBeGreaterThan(0);
    // All sample transactions should be the top merchant's rows.
    expect(
      glovoStory?.sample_transactions.every((t) =>
        t.merchant.toLowerCase().includes('glovo'),
      ),
    ).toBe(true);
    expect(glovoStory?.narrative_hint).toBeTruthy();
    // Hint must not use value-judgment vocab.
    expect(glovoStory?.narrative_hint.toLowerCase()).not.toContain('leak');
    expect(glovoStory?.narrative_hint.toLowerCase()).not.toContain('burden');
  });

  it('does NOT emit a merchant_in_category story when share is just below 40%', async () => {
    // Glovo = 39 of 100 → 39%, just below threshold.
    const rows: StubRow[] = [
      { id: 't1', date: '2026-04-01', description: 'GLOVO', amount: -39, category_id: 'eat_drinking_out' },
      { id: 't2', date: '2026-04-05', description: 'STARBUCKS', amount: -20, category_id: 'eat_drinking_out' },
      { id: 't3', date: '2026-04-10', description: 'COSTA', amount: -21, category_id: 'eat_drinking_out' },
      { id: 't4', date: '2026-04-15', description: 'PRET', amount: -20, category_id: 'eat_drinking_out' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindMoneyClustersTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      // Set high to keep dominant_category silent for this scenario.
      min_share_pct: 95,
    })) as ToolResult;

    const merchantStories = result.stories?.filter(
      (s) => s.type === 'merchant_in_category',
    );
    expect(merchantStories?.length ?? 0).toBe(0);
  });

  it('emits a dominant_category story when a category meets min_share_pct of total spend', async () => {
    // groceries = 200, eat_drinking_out = 50 → groceries is 80% of total (250).
    // With min_share_pct = 30, groceries clears it; eat_drinking_out (20%) doesn't.
    const rows: StubRow[] = [
      { id: 't1', date: '2026-04-01', description: 'TESCO', amount: -80, category_id: 'groceries' },
      { id: 't2', date: '2026-04-05', description: 'WAITROSE', amount: -60, category_id: 'groceries' },
      { id: 't3', date: '2026-04-10', description: 'M&S', amount: -60, category_id: 'groceries' },
      { id: 't4', date: '2026-04-15', description: 'STARBUCKS', amount: -25, category_id: 'eat_drinking_out' },
      { id: 't5', date: '2026-04-20', description: 'COSTA', amount: -25, category_id: 'eat_drinking_out' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindMoneyClustersTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      min_share_pct: 30,
    })) as ToolResult;

    const dominantStories = result.stories?.filter(
      (s) => s.type === 'dominant_category',
    );
    // groceries 80% qualifies; eat_drinking_out 20% does not.
    expect(dominantStories?.length).toBe(1);
    expect(dominantStories?.[0].headline).toContain('groceries');
    expect(dominantStories?.[0].magnitude.share_pct).toBe(80);
    expect(dominantStories?.[0].magnitude.amount).toBe(200);
    // Top contributing merchants surfaced for the dominant category.
    expect(dominantStories?.[0].merchants.length).toBeGreaterThan(0);
    // Comparison string should embed the share figure.
    expect(dominantStories?.[0].comparison).toContain('80');
  });

  it('emits a recurring_merchant story when ≥3 same-amount transactions land', async () => {
    // Netflix: 4× £9.99 — std dev = 0, well under 10% CV.
    // Mix in a few one-offs so they don't dominate the dataset.
    const rows: StubRow[] = [
      { id: 'n1', date: '2026-01-15', description: 'NETFLIX', amount: -9.99, category_id: 'subscriptions' },
      { id: 'n2', date: '2026-02-15', description: 'NETFLIX', amount: -9.99, category_id: 'subscriptions' },
      { id: 'n3', date: '2026-03-15', description: 'NETFLIX', amount: -9.99, category_id: 'subscriptions' },
      { id: 'n4', date: '2026-04-15', description: 'NETFLIX', amount: -9.99, category_id: 'subscriptions' },
      { id: 'o1', date: '2026-04-02', description: 'AMAZON', amount: -45, category_id: 'shopping' },
      { id: 'o2', date: '2026-04-10', description: 'WAITROSE', amount: -32, category_id: 'groceries' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindMoneyClustersTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-01-01',
      date_to: '2026-04-30',
      // Set min_share_pct high so dominant_category stays out of the way.
      min_share_pct: 95,
    })) as ToolResult;

    const recurringStories = result.stories?.filter(
      (s) => s.type === 'recurring_merchant',
    );
    expect(recurringStories?.length).toBeGreaterThanOrEqual(1);
    const netflix = recurringStories?.find(
      (s) => s.merchants[0] === 'netflix',
    );
    expect(netflix).toBeDefined();
    expect(netflix?.headline).toContain('4');
    expect(netflix?.magnitude.amount).toBeCloseTo(39.96, 1);
    // Hint should not editorialise.
    expect(netflix?.narrative_hint.toLowerCase()).not.toContain('leak');
    expect(netflix?.narrative_hint.toLowerCase()).not.toContain('burden');
  });

  it('rejects a recurring_merchant when std dev exceeds 10% of the mean', async () => {
    // Wildly varying amounts at the same merchant: not "recurring-shaped".
    // 10, 20, 30, 40 → mean 25, std dev ≈ 11.18 → CV ≈ 0.45.
    const rows: StubRow[] = [
      { id: 'a1', date: '2026-04-01', description: 'COFFEE SHOP', amount: -10, category_id: 'eat_drinking_out' },
      { id: 'a2', date: '2026-04-05', description: 'COFFEE SHOP', amount: -20, category_id: 'eat_drinking_out' },
      { id: 'a3', date: '2026-04-10', description: 'COFFEE SHOP', amount: -30, category_id: 'eat_drinking_out' },
      { id: 'a4', date: '2026-04-15', description: 'COFFEE SHOP', amount: -40, category_id: 'eat_drinking_out' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindMoneyClustersTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      min_share_pct: 95,
    })) as ToolResult;

    const recurringStories = result.stories?.filter(
      (s) => s.type === 'recurring_merchant',
    );
    expect(recurringStories?.length ?? 0).toBe(0);
  });

  it('returns a friendly error when the DB query fails', async () => {
    const { supabase } = makeSupabaseStub({ error: { message: 'boom' } });
    const tool = createFindMoneyClustersTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      min_share_pct: 25,
    })) as ToolResult;

    expect(result.error).toBe('Could not fetch transactions. Please try again.');
  });
});
