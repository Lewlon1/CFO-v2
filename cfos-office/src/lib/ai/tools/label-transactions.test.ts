import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createLabelTransactionsTool } from './label-transactions';
import type { ToolContext } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';

interface StubRow {
  id: string;
  date: string | null;
  description: string | null;
  amount: number;
  category_id: string | null;
}

interface StubOptions {
  rows?: StubRow[] | null;
  error?: { message: string } | null;
}

interface CallTrace {
  method: string;
  args: unknown[];
}

// Chainable supabase stub. Tracks every call so RLS / filter assertions are
// easy. Matches the convention used by sibling tool tests.
function makeSupabaseStub(opts: StubOptions = {}) {
  const calls: CallTrace[] = [];

  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (onFulfilled: (v: unknown) => unknown) => Promise<unknown>;
  } = {} as never;

  const finalise = () =>
    Promise.resolve({
      data: opts.rows ?? [],
      error: opts.error ?? null,
    });

  for (const method of ['select', 'eq', 'is', 'in'] as const) {
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

interface DirectiveTransaction {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string | null;
  time?: string;
}

interface DirectiveOption {
  id: 'foundation' | 'investment' | 'leak' | 'burden' | 'unsure';
  label: string;
  color: string;
  desc: string;
}

interface ToolResult {
  render_directive?: 'label_transactions';
  directive_id?: string;
  question?: string;
  context_hint?: string;
  transactions?: DirectiveTransaction[];
  options?: DirectiveOption[];
  error?: string;
}

// Stable UUIDs used in tests so set ordering is deterministic. Must satisfy
// zod's strict UUID format (version 1-8 nibble + RFC variant nibble).
const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';

const ALL_FIVE: Array<
  'foundation' | 'investment' | 'leak' | 'burden' | 'unsure'
> = ['foundation', 'investment', 'leak', 'burden', 'unsure'];

describe('createLabelTransactionsTool — input schema', () => {
  it('accepts a minimal valid input', () => {
    const tool = createLabelTransactionsTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      question: 'Walk me through these — what was each one?',
      transactions: [ID_1, ID_2, ID_3],
      options: ALL_FIVE,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.label_type).toBe('value_category');
    }
  });

  it('rejects an empty transactions array', () => {
    const tool = createLabelTransactionsTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      question: 'Walk me through these',
      transactions: [],
      options: ALL_FIVE,
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 10 transactions', () => {
    const tool = createLabelTransactionsTool(makeCtx(makeSupabaseStub().supabase));
    // Generate 11 valid v4 UUIDs (deterministic — same shape as ID_*).
    const elevenIds = Array.from(
      { length: 11 },
      (_, i) =>
        `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
    );
    const result = tool.inputSchema.safeParse({
      question: 'q',
      transactions: elevenIds,
      options: ALL_FIVE,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID transaction IDs', () => {
    const tool = createLabelTransactionsTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      question: 'q',
      transactions: ['not-a-uuid'],
      options: ALL_FIVE,
    });
    expect(result.success).toBe(false);
  });

  it('rejects options array with wrong length at the schema level', () => {
    const tool = createLabelTransactionsTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      question: 'q',
      transactions: [ID_1],
      options: ['foundation', 'investment', 'leak', 'burden'],
    });
    expect(result.success).toBe(false);
  });
});

describe('createLabelTransactionsTool — execute validation', () => {
  it('returns error when one quadrant is missing (duplicate fills the slot)', async () => {
    const { supabase } = makeSupabaseStub({ rows: [] });
    const tool = createLabelTransactionsTool(makeCtx(supabase));

    // 5 entries, but only 4 unique — `unsure` is missing, `leak` duplicated.
    const result = (await tool.execute({
      question: 'q',
      transactions: [ID_1],
      label_type: 'value_category',
      options: ['foundation', 'investment', 'leak', 'leak', 'burden'],
    })) as ToolResult;

    expect(result.error).toBe(
      'options must be exactly the 5 quadrants: foundation, investment, leak, burden, unsure',
    );
  });

  it('returns error when the duplicate is of a different quadrant', async () => {
    const { supabase } = makeSupabaseStub({ rows: [] });
    const tool = createLabelTransactionsTool(makeCtx(supabase));

    // `burden` duplicated, `foundation` missing.
    const result = (await tool.execute({
      question: 'q',
      transactions: [ID_1],
      label_type: 'value_category',
      options: ['burden', 'investment', 'leak', 'burden', 'unsure'],
    })) as ToolResult;

    expect(result.error).toBe(
      'options must be exactly the 5 quadrants: foundation, investment, leak, burden, unsure',
    );
  });

  it('accepts the 5 quadrants in any order', async () => {
    const rows: StubRow[] = [
      {
        id: ID_1,
        date: '2026-03-08T23:14:00Z',
        description: 'Glovo',
        amount: -18.5,
        category_id: 'eat_drinking_out',
      },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createLabelTransactionsTool(makeCtx(supabase));

    const result = (await tool.execute({
      question: 'q',
      transactions: [ID_1],
      label_type: 'value_category',
      options: ['unsure', 'burden', 'leak', 'investment', 'foundation'],
    })) as ToolResult;

    expect(result.error).toBeUndefined();
    expect(result.render_directive).toBe('label_transactions');
  });
});

describe('createLabelTransactionsTool — execute happy path', () => {
  beforeEach(() => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' as ReturnType<
        typeof crypto.randomUUID
      >,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a render directive with hydrated transactions and the fixed options array', async () => {
    const rows: StubRow[] = [
      {
        id: ID_1,
        date: '2026-03-08T23:14:00Z',
        description: 'Glovo',
        amount: -18.5,
        category_id: 'eat_drinking_out',
      },
      {
        id: ID_2,
        date: '2026-03-08T21:32:00Z',
        description: 'The Sutton',
        amount: -34.0,
        category_id: 'eat_drinking_out',
      },
      {
        id: ID_3,
        date: '2026-03-01',
        description: 'La Tagliatella',
        amount: -52.0,
        category_id: 'eat_drinking_out',
      },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createLabelTransactionsTool(makeCtx(supabase));

    const result = (await tool.execute({
      question: 'Walk me through these — what was each one, in your read?',
      transactions: [ID_1, ID_2, ID_3],
      label_type: 'value_category',
      options: ALL_FIVE,
      context_hint: 'Friday eating-out · last 3 weeks',
    })) as ToolResult;

    expect(result.render_directive).toBe('label_transactions');
    expect(result.directive_id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(result.question).toBe(
      'Walk me through these — what was each one, in your read?',
    );
    expect(result.context_hint).toBe('Friday eating-out · last 3 weeks');
    expect(result.transactions).toHaveLength(3);

    // All 5 options in the canonical order with the canonical value-category
    // tokens (theme-reactive var() strings from @/lib/tokens).
    expect(result.options).toEqual([
      { id: 'foundation', label: 'Foundation', color: 'var(--value-foundation)', desc: 'Essential' },
      { id: 'investment', label: 'Investment', color: 'var(--value-investment)', desc: 'Worth it' },
      { id: 'leak', label: 'Leak', color: 'var(--value-leak)', desc: 'Drains me' },
      { id: 'burden', label: 'Burden', color: 'var(--value-burden)', desc: 'Heavy, stuck' },
      { id: 'unsure', label: 'Unsure', color: 'var(--value-unsure)', desc: 'On autopilot' },
    ]);

    // Shape of an individual hydrated transaction.
    const tx1 = result.transactions?.[0];
    expect(tx1?.id).toBe(ID_1);
    expect(tx1?.merchant).toBe('Glovo');
    expect(tx1?.amount).toBe(-18.5);
    expect(tx1?.category).toBe('eat_drinking_out');
    // timestamptz with non-zero time → time field present as HH:MM
    expect(tx1?.time).toBe('23:14');
    expect(tx1?.date).toBe('2026-03-08');

    // Pure date string (no time component) → no `time` field on output.
    const tx3 = result.transactions?.[2];
    expect(tx3?.date).toBe('2026-03-01');
    expect(tx3?.time).toBeUndefined();
  });

  it('omits context_hint from the output when not provided', async () => {
    const rows: StubRow[] = [
      {
        id: ID_1,
        date: '2026-03-08',
        description: 'Glovo',
        amount: -18.5,
        category_id: 'eat_drinking_out',
      },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createLabelTransactionsTool(makeCtx(supabase));

    const result = (await tool.execute({
      question: 'Walk me through this',
      transactions: [ID_1],
      label_type: 'value_category',
      options: ALL_FIVE,
    })) as ToolResult;

    expect(result.render_directive).toBe('label_transactions');
    expect('context_hint' in result).toBe(false);
  });

  it('preserves the LLM-requested transaction order', async () => {
    // DB returns rows out of order — the directive must honour the
    // requested order so the user reads them in the order the LLM
    // implied in its prose.
    const rows: StubRow[] = [
      {
        id: ID_3,
        date: '2026-03-01',
        description: 'La Tagliatella',
        amount: -52.0,
        category_id: 'eat_drinking_out',
      },
      {
        id: ID_1,
        date: '2026-03-08T23:14:00Z',
        description: 'Glovo',
        amount: -18.5,
        category_id: 'eat_drinking_out',
      },
      {
        id: ID_2,
        date: '2026-03-08T21:32:00Z',
        description: 'The Sutton',
        amount: -34.0,
        category_id: 'eat_drinking_out',
      },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createLabelTransactionsTool(makeCtx(supabase));

    const result = (await tool.execute({
      question: 'q',
      transactions: [ID_1, ID_2, ID_3],
      label_type: 'value_category',
      options: ALL_FIVE,
    })) as ToolResult;

    expect(result.transactions?.map((t) => t.id)).toEqual([ID_1, ID_2, ID_3]);
  });
});

describe('createLabelTransactionsTool — RLS + filters', () => {
  it('pins by user_id on the transactions query (RLS)', async () => {
    const { supabase, calls } = makeSupabaseStub({
      rows: [
        {
          id: ID_1,
          date: '2026-03-08',
          description: 'Glovo',
          amount: -18.5,
          category_id: 'eat_drinking_out',
        },
      ],
    });
    const tool = createLabelTransactionsTool(makeCtx(supabase));

    await tool.execute({
      question: 'q',
      transactions: [ID_1],
      label_type: 'value_category',
      options: ALL_FIVE,
    });

    const userPins = calls.filter(
      (c) =>
        c.method === 'eq' && c.args[0] === 'user_id' && c.args[1] === 'user-123',
    );
    expect(userPins.length).toBe(1);
  });

  it('pins soft-delete (deleted_at IS NULL)', async () => {
    const { supabase, calls } = makeSupabaseStub({
      rows: [
        {
          id: ID_1,
          date: '2026-03-08',
          description: 'Glovo',
          amount: -18.5,
          category_id: 'eat_drinking_out',
        },
      ],
    });
    const tool = createLabelTransactionsTool(makeCtx(supabase));

    await tool.execute({
      question: 'q',
      transactions: [ID_1],
      label_type: 'value_category',
      options: ALL_FIVE,
    });

    const isCalls = calls.filter((c) => c.method === 'is');
    expect(
      isCalls.some((c) => c.args[0] === 'deleted_at' && c.args[1] === null),
    ).toBe(true);
  });

  it('filters by the requested transaction IDs via .in()', async () => {
    const { supabase, calls } = makeSupabaseStub({
      rows: [
        {
          id: ID_1,
          date: '2026-03-08',
          description: 'Glovo',
          amount: -18.5,
          category_id: 'eat_drinking_out',
        },
      ],
    });
    const tool = createLabelTransactionsTool(makeCtx(supabase));

    await tool.execute({
      question: 'q',
      transactions: [ID_1, ID_2],
      label_type: 'value_category',
      options: ALL_FIVE,
    });

    const inCalls = calls.filter((c) => c.method === 'in');
    expect(inCalls.length).toBe(1);
    expect(inCalls[0].args[0]).toBe('id');
    expect(inCalls[0].args[1]).toEqual([ID_1, ID_2]);
  });
});

describe('createLabelTransactionsTool — hydration edge cases', () => {
  it('logs a warning and proceeds when some IDs are missing from the result', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Requested 3 IDs, DB returns only 2 (one was soft-deleted between the
    // LLM seeing it and the tool call, say).
    const rows: StubRow[] = [
      {
        id: ID_1,
        date: '2026-03-08',
        description: 'Glovo',
        amount: -18.5,
        category_id: 'eat_drinking_out',
      },
      {
        id: ID_2,
        date: '2026-03-01',
        description: 'The Sutton',
        amount: -34.0,
        category_id: 'eat_drinking_out',
      },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createLabelTransactionsTool(makeCtx(supabase));

    const result = (await tool.execute({
      question: 'q',
      transactions: [ID_1, ID_2, ID_3],
      label_type: 'value_category',
      options: ALL_FIVE,
    })) as ToolResult;

    expect(result.render_directive).toBe('label_transactions');
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions?.map((t) => t.id)).toEqual([ID_1, ID_2]);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('returns an error when ALL requested IDs are missing', async () => {
    const { supabase } = makeSupabaseStub({ rows: [] });
    const tool = createLabelTransactionsTool(makeCtx(supabase));

    const result = (await tool.execute({
      question: 'q',
      transactions: [ID_1, ID_2, ID_3],
      label_type: 'value_category',
      options: ALL_FIVE,
    })) as ToolResult;

    expect(result.error).toBe(
      'None of the requested transactions were found or accessible',
    );
    expect(result.render_directive).toBeUndefined();
  });

  it('returns a friendly error when the DB query fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = makeSupabaseStub({ error: { message: 'boom' } });
    const tool = createLabelTransactionsTool(makeCtx(supabase));

    const result = (await tool.execute({
      question: 'q',
      transactions: [ID_1],
      label_type: 'value_category',
      options: ALL_FIVE,
    })) as ToolResult;

    expect(result.error).toBe(
      'Could not fetch transactions for labelling. Please try again.',
    );
    errSpy.mockRestore();
  });

  it('handles missing description and null category gracefully', async () => {
    const rows: StubRow[] = [
      {
        id: ID_1,
        date: '2026-03-08',
        description: null,
        amount: -10,
        category_id: null,
      },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createLabelTransactionsTool(makeCtx(supabase));

    const result = (await tool.execute({
      question: 'q',
      transactions: [ID_1],
      label_type: 'value_category',
      options: ALL_FIVE,
    })) as ToolResult;

    const tx1 = result.transactions?.[0];
    expect(tx1?.merchant).toBe('');
    expect(tx1?.category).toBeNull();
  });
});
