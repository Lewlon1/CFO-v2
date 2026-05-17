import { describe, expect, it, vi } from 'vitest';
import { createGetTopMerchantsTool } from './get-top-merchants';
import type { ToolContext } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EXCLUDED_FROM_PL_PG_LIST } from '@/lib/analytics/categories';

interface StubRow {
  amount: number;
  description: string | null;
  date: string;
  category_id: string | null;
  value_category: string | null;
}

interface StubOptions {
  rows?: StubRow[] | null;
  error?: { message: string } | null;
}

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

  for (const method of [
    'select',
    'eq',
    'gte',
    'lte',
    'is',
    'not',
  ] as const) {
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

describe('createGetTopMerchantsTool — input schema', () => {
  it('accepts minimal input with sensible default for limit', () => {
    const tool = createGetTopMerchantsTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(5);
    }
  });

  it('rejects limit above 20', () => {
    const tool = createGetTopMerchantsTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      limit: 21,
    });
    expect(result.success).toBe(false);
  });

  it('accepts every value_category enum option', () => {
    const tool = createGetTopMerchantsTool(makeCtx(makeSupabaseStub().supabase));
    for (const vc of ['foundation', 'investment', 'burden', 'leak', 'unsure'] as const) {
      const result = tool.inputSchema.safeParse({
        date_from: '2026-04-01',
        date_to: '2026-04-30',
        value_category: vc,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe('createGetTopMerchantsTool — execute', () => {
  it('pins by user_id (RLS)', async () => {
    const { supabase, calls } = makeSupabaseStub({
      rows: [
        {
          amount: -10,
          description: 'TESCO',
          date: '2026-04-15',
          category_id: 'groceries',
          value_category: 'foundation',
        },
      ],
    });
    const tool = createGetTopMerchantsTool(makeCtx(supabase));

    await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      limit: 5,
    });

    const userPins = calls.filter(
      (c) => c.method === 'eq' && c.args[0] === 'user_id' && c.args[1] === 'user-123',
    );
    expect(userPins.length).toBe(1);
  });

  it('applies the EXCLUDED_FROM_PL_PG_LIST not-in filter', async () => {
    const { supabase, calls } = makeSupabaseStub({ rows: [] });
    const tool = createGetTopMerchantsTool(makeCtx(supabase));

    await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      limit: 5,
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

  it('returns top N merchants and an aggregated others bucket', async () => {
    const rows: StubRow[] = [
      // AMAZON: 100
      { amount: -100, description: 'AMAZON', date: '2026-04-01', category_id: 'shopping', value_category: 'leak' },
      // TESCO: 80 (40 + 40)
      { amount: -40, description: 'TESCO', date: '2026-04-02', category_id: 'groceries', value_category: 'foundation' },
      { amount: -40, description: 'TESCO', date: '2026-04-03', category_id: 'groceries', value_category: 'foundation' },
      // NETFLIX: 15
      { amount: -15, description: 'NETFLIX', date: '2026-04-04', category_id: 'subscriptions', value_category: 'investment' },
      // SPOTIFY: 10
      { amount: -10, description: 'SPOTIFY', date: '2026-04-05', category_id: 'subscriptions', value_category: 'investment' },
      // STARBUCKS: 5
      { amount: -5, description: 'STARBUCKS', date: '2026-04-06', category_id: 'eat_drinking_out', value_category: 'leak' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createGetTopMerchantsTool(makeCtx(supabase));

    const result = await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      limit: 3,
    });

    expect(result).toMatchObject({
      currency: 'GBP',
      merchants: [
        { merchant: 'amazon', total_spend: 100, transaction_count: 1 },
        { merchant: 'tesco', total_spend: 80, transaction_count: 2 },
        { merchant: 'netflix', total_spend: 15, transaction_count: 1 },
      ],
      others: {
        total_spend: 15, // SPOTIFY 10 + STARBUCKS 5
        transaction_count: 2,
      },
    });
  });

  it('reports zero in the others bucket when all merchants fit under the limit', async () => {
    const rows: StubRow[] = [
      { amount: -50, description: 'AMAZON', date: '2026-04-01', category_id: 'shopping', value_category: null },
      { amount: -30, description: 'TESCO', date: '2026-04-02', category_id: 'groceries', value_category: 'foundation' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createGetTopMerchantsTool(makeCtx(supabase));

    const result = await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      limit: 5,
    });

    expect((result as { merchants: unknown[] }).merchants).toHaveLength(2);
    expect(result).toMatchObject({
      others: { total_spend: 0, transaction_count: 0 },
    });
  });

  it('returns a friendly error rather than crashing on empty results', async () => {
    const { supabase } = makeSupabaseStub({ rows: [] });
    const tool = createGetTopMerchantsTool(makeCtx(supabase));

    const result = await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      limit: 5,
    });

    expect(result).toMatchObject({
      error: expect.stringContaining('No transactions'),
      merchants: [],
      others: { total_spend: 0, transaction_count: 0 },
    });
  });

  it('returns a friendly error when the DB query fails', async () => {
    const { supabase } = makeSupabaseStub({ error: { message: 'boom' } });
    const tool = createGetTopMerchantsTool(makeCtx(supabase));

    const result = await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      limit: 5,
    });

    expect(result).toEqual({
      error: 'Could not fetch merchant data. Please try again.',
    });
  });
});
