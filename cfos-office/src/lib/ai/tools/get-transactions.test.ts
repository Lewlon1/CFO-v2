import { describe, expect, it, vi } from 'vitest';
import { createGetTransactionsTool } from './get-transactions';
import type { ToolContext } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EXCLUDED_FROM_PL_PG_LIST } from '@/lib/analytics/categories';

interface StubRow {
  id: string;
  date: string;
  description: string | null;
  amount: number;
  category_id: string | null;
  value_category: string | null;
}

interface StubOptions {
  countRows?: number | null;
  rows?: StubRow[] | null;
  countError?: { message: string } | null;
  rowError?: { message: string } | null;
}

// Builds a chainable supabase stub that records every call to its
// query-builder methods. The same builder is returned for both the
// count query (head: true, returns { count }) and the row query
// (returns { data }) — we differentiate by inspecting the select call.
function makeSupabaseStub(opts: StubOptions = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  let isHeadQuery = false;

  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (onFulfilled: (v: unknown) => unknown) => Promise<unknown>;
  } = {} as never;

  // The terminal `then` is what makes the builder thenable so callers can
  // `await` it directly. PostgREST builders are PromiseLike.
  const finalise = () => {
    if (isHeadQuery) {
      return Promise.resolve({
        count: opts.countRows ?? 0,
        error: opts.countError ?? null,
      });
    }
    return Promise.resolve({
      data: opts.rows ?? [],
      error: opts.rowError ?? null,
    });
  };

  for (const method of [
    'eq',
    'gte',
    'lte',
    'lt',
    'gt',
    'is',
    'not',
    'or',
    'ilike',
    'order',
    'limit',
  ] as const) {
    builder[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    });
  }
  builder.select = vi.fn((...args: unknown[]) => {
    calls.push({ method: 'select', args });
    // count-head signature: select('id', { count: 'exact', head: true })
    const second = args[1] as { head?: boolean } | undefined;
    isHeadQuery = !!second?.head;
    return builder;
  });

  // Make builder awaitable.
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

describe('createGetTransactionsTool — input schema', () => {
  it('accepts the minimal required input', () => {
    const tool = createGetTransactionsTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.direction).toBe('spend');
      expect(result.data.sort).toBe('date_desc');
      expect(result.data.limit).toBe(20);
    }
  });

  it('accepts every documented input combination', () => {
    const tool = createGetTransactionsTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      merchant_pattern: 'tesco',
      category: 'groceries',
      value_category: 'foundation',
      min_amount: 5,
      max_amount: 100,
      direction: 'all',
      sort: 'amount_desc',
      limit: 50,
    });
    expect(result.success).toBe(true);
  });

  it('rejects limit above 50', () => {
    const tool = createGetTransactionsTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      limit: 51,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown value_category', () => {
    const tool = createGetTransactionsTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      value_category: 'no_idea',
    });
    expect(result.success).toBe(false);
  });
});

describe('createGetTransactionsTool — execute', () => {
  it('pins by user_id on every query (RLS)', async () => {
    const { supabase, calls } = makeSupabaseStub({
      countRows: 1,
      rows: [
        {
          id: 't1',
          date: '2026-04-15',
          description: 'TESCO',
          amount: -12.5,
          category_id: 'groceries',
          value_category: 'foundation',
        },
      ],
    });
    const tool = createGetTransactionsTool(makeCtx(supabase));

    await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      direction: 'spend',
      sort: 'date_desc',
      limit: 20,
    });

    const userPins = calls.filter(
      (c) => c.method === 'eq' && c.args[0] === 'user_id' && c.args[1] === 'user-123',
    );
    // Once for the count query, once for the row query.
    expect(userPins.length).toBe(2);
  });

  it("applies the EXCLUDED_FROM_PL_PG_LIST not-in filter when direction='spend'", async () => {
    const { supabase, calls } = makeSupabaseStub({ countRows: 0, rows: [] });
    const tool = createGetTransactionsTool(makeCtx(supabase));

    await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      direction: 'spend',
      sort: 'date_desc',
      limit: 20,
    });

    const notCalls = calls.filter((c) => c.method === 'not');
    expect(notCalls.length).toBeGreaterThan(0);
    expect(
      notCalls.some(
        (c) => c.args[0] === 'category_id' && c.args[1] === 'in' && c.args[2] === EXCLUDED_FROM_PL_PG_LIST,
      ),
    ).toBe(true);

    // Spend also restricts to negative amounts.
    const ltCalls = calls.filter((c) => c.method === 'lt');
    expect(ltCalls.some((c) => c.args[0] === 'amount' && c.args[1] === 0)).toBe(true);
  });

  it("filters to positive amounts when direction='income'", async () => {
    const { supabase, calls } = makeSupabaseStub({ countRows: 0, rows: [] });
    const tool = createGetTransactionsTool(makeCtx(supabase));

    await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      direction: 'income',
      sort: 'date_desc',
      limit: 20,
    });

    const gtCalls = calls.filter((c) => c.method === 'gt');
    expect(gtCalls.some((c) => c.args[0] === 'amount' && c.args[1] === 0)).toBe(true);

    // Income mode does NOT apply the spend exclusion list.
    const notCalls = calls.filter(
      (c) => c.method === 'not' && c.args[0] === 'category_id',
    );
    expect(notCalls.length).toBe(0);
  });

  it("applies no sign filter when direction='all'", async () => {
    const { supabase, calls } = makeSupabaseStub({ countRows: 0, rows: [] });
    const tool = createGetTransactionsTool(makeCtx(supabase));

    await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      direction: 'all',
      sort: 'date_desc',
      limit: 20,
    });

    expect(calls.some((c) => c.method === 'gt' && c.args[0] === 'amount')).toBe(false);
    expect(calls.some((c) => c.method === 'lt' && c.args[0] === 'amount')).toBe(false);
  });

  it('reports truncated:true when total matches exceed the limit', async () => {
    const rows: StubRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      date: '2026-04-15',
      description: `M${i}`,
      amount: -10,
      category_id: 'groceries',
      value_category: 'foundation',
    }));
    const { supabase } = makeSupabaseStub({ countRows: 47, rows });
    const tool = createGetTransactionsTool(makeCtx(supabase));

    const result = await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      direction: 'spend',
      sort: 'date_desc',
      limit: 5,
    });

    expect(result).toMatchObject({
      summary: {
        row_count: 5,
        truncated: true,
        total_matching_rows: 47,
        currency: 'GBP',
      },
    });
    expect((result as { transactions: unknown[] }).transactions).toHaveLength(5);
  });

  it('returns a friendly error on empty results rather than throwing', async () => {
    const { supabase } = makeSupabaseStub({ countRows: 0, rows: [] });
    const tool = createGetTransactionsTool(makeCtx(supabase));

    const result = await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      direction: 'spend',
      sort: 'date_desc',
      limit: 20,
    });

    expect(result).toMatchObject({
      error: expect.stringContaining('No transactions'),
      summary: { row_count: 0, truncated: false, total_matching_rows: 0 },
      transactions: [],
    });
  });

  it('maps row.description to merchant in the output', async () => {
    const { supabase } = makeSupabaseStub({
      countRows: 1,
      rows: [
        {
          id: 't1',
          date: '2026-04-15',
          description: 'TESCO 1234',
          amount: -12.5,
          category_id: 'groceries',
          value_category: 'foundation',
        },
      ],
    });
    const tool = createGetTransactionsTool(makeCtx(supabase));

    const result = await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      direction: 'spend',
      sort: 'date_desc',
      limit: 20,
    });

    expect((result as { transactions: unknown[] }).transactions[0]).toEqual({
      id: 't1',
      date: '2026-04-15',
      merchant: 'TESCO 1234',
      amount: -12.5,
      category: 'groceries',
      value_category: 'foundation',
    });
  });

  it('returns a friendly error when the row query fails', async () => {
    const { supabase } = makeSupabaseStub({
      countRows: 5,
      rowError: { message: 'connection lost' },
    });
    const tool = createGetTransactionsTool(makeCtx(supabase));

    const result = await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      direction: 'spend',
      sort: 'date_desc',
      limit: 20,
    });

    expect(result).toEqual({
      error: 'Could not fetch transactions. Please try again.',
    });
  });
});
