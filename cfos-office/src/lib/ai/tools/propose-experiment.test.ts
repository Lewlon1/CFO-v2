import { describe, expect, it, vi } from 'vitest';
import { createProposeExperimentTool } from './propose-experiment';
import type { ToolContext } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';

interface StubRow {
  id: string;
  date: string;
  description: string | null;
  amount: number;
  category_id: string | null;
}

interface InsertPayload {
  user_id: string;
  conversation_id: string;
  experiment_type: string;
  parameters: Record<string, unknown>;
  rationale: string;
  computed_impact: Record<string, unknown>;
  affected_transaction_ids: string[];
  feasibility_note: string;
  status: string;
}

interface StubOptions {
  // Rows returned for transactions reads.
  rows?: StubRow[] | null;
  // Error for the transactions read.
  txnError?: { message: string } | null;
  // ID returned by the proposed_experiments insert.
  insertedId?: string;
  // Error for the proposed_experiments insert.
  insertError?: { message: string } | null;
}

interface CallTrace {
  method: string;
  args: unknown[];
}

interface Stub {
  supabase: SupabaseClient;
  // All chain calls across all tables.
  calls: CallTrace[];
  // Captured insert payloads (one per insert call).
  insertedPayloads: InsertPayload[];
  // The table the most recent insert targeted.
  lastInsertTable: string | null;
}

// Chainable supabase stub. Tracks every call so RLS / filter assertions are
// easy. Branches on table name in `.from()` so transactions reads and
// proposed_experiments writes behave correctly from a single stub.
function makeSupabaseStub(opts: StubOptions = {}): Stub {
  const calls: CallTrace[] = [];
  const insertedPayloads: InsertPayload[] = [];
  let lastInsertTable: string | null = null;

  // Read-chain builder for the transactions table. Resolves to {data, error}.
  const makeReadBuilder = () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> & {
      then?: (onFulfilled: (v: unknown) => unknown) => Promise<unknown>;
    } = {} as never;

    const finalise = () =>
      Promise.resolve({
        data: opts.rows ?? [],
        error: opts.txnError ?? null,
      });

    for (const method of ['select', 'eq', 'gte', 'lte', 'is', 'not'] as const) {
      builder[method] = vi.fn((...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      });
    }
    builder.then = (onFulfilled: (v: unknown) => unknown) =>
      finalise().then(onFulfilled);

    return builder;
  };

  // Insert-chain builder for the proposed_experiments table. Supports
  // .insert(...).select(...).single() and resolves to {data, error}.
  const makeInsertBuilder = (table: string) => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {} as never;

    builder.insert = vi.fn((payload: InsertPayload) => {
      calls.push({ method: 'insert', args: [payload] });
      insertedPayloads.push(payload);
      lastInsertTable = table;
      return builder;
    });
    builder.select = vi.fn((...args: unknown[]) => {
      calls.push({ method: 'select', args });
      return builder;
    });
    builder.single = vi.fn(() => {
      calls.push({ method: 'single', args: [] });
      return Promise.resolve({
        data: opts.insertError
          ? null
          : { id: opts.insertedId ?? 'exp-generated-id' },
        error: opts.insertError ?? null,
      });
    });

    return builder;
  };

  const supabase = {
    from: vi.fn((table: string) => {
      calls.push({ method: 'from', args: [table] });
      // proposed_experiments only ever does insert flows in this tool;
      // transactions only ever does read flows. Branch on the table.
      if (table === 'proposed_experiments') return makeInsertBuilder(table);
      return makeReadBuilder();
    }),
  } as unknown as SupabaseClient;

  return {
    supabase,
    calls,
    insertedPayloads,
    get lastInsertTable() {
      return lastInsertTable;
    },
  } as Stub;
}

function makeCtx(supabase: SupabaseClient): ToolContext {
  return {
    supabase,
    userId: 'user-123',
    conversationId: 'conv-1',
    currency: 'EUR',
  };
}

interface ToolResult {
  experiment_id?: string;
  description?: string;
  monthly_impact?: {
    amount: number;
    currency: string;
    confidence: 'high' | 'med' | 'low';
  };
  annualised_impact?: { amount: number; currency: string };
  affected_transactions?: Array<{
    id: string;
    date: string;
    merchant: string;
    amount: number;
  }>;
  baseline_pattern?: {
    count_per_month: number;
    avg_amount: number;
    consistency_score: number;
  };
  feasibility_note?: string;
  next_check_in?: string;
  error?: string;
}

// Build 12 Glovo transactions over the last 90 days at ~€18 each.
function buildGlovoBaseline(): StubRow[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const rows: StubRow[] = [];
  // Spread 12 occurrences evenly through the last 84 days (every 7 days).
  for (let i = 0; i < 12; i++) {
    const d = new Date(today.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
    rows.push({
      id: `g${i + 1}`,
      date: d.toISOString().slice(0, 10),
      description: 'GLOVO',
      amount: -18,
      category_id: 'eat_drinking_out',
    });
  }
  return rows;
}

// ---- Validation ----

describe('createProposeExperimentTool — validation', () => {
  it('rejects reduce_merchant without merchant and does not insert', async () => {
    const stub = makeSupabaseStub({ rows: [] });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));

    const result = (await tool.execute({
      type: 'reduce_merchant',
      parameters: { reduction_pct: 100 },
      rationale: 'because reasons',
    })) as ToolResult;

    expect(result.error).toBe(
      'reduce_merchant requires both merchant and reduction_pct in parameters',
    );
    // No insert should have been attempted.
    expect(stub.insertedPayloads.length).toBe(0);
    // And no transactions read either — fail fast.
    expect(stub.calls.some((c) => c.method === 'from')).toBe(false);
  });

  it('rejects reduce_merchant without reduction_pct', async () => {
    const stub = makeSupabaseStub({ rows: [] });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));

    const result = (await tool.execute({
      type: 'reduce_merchant',
      parameters: { merchant: 'glovo' },
      rationale: 'r',
    })) as ToolResult;

    expect(result.error).toContain('reduce_merchant requires both');
    expect(stub.insertedPayloads.length).toBe(0);
  });

  it('rejects pause_recurring without merchant', async () => {
    const stub = makeSupabaseStub({ rows: [] });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));
    const result = (await tool.execute({
      type: 'pause_recurring',
      parameters: {},
      rationale: 'r',
    })) as ToolResult;
    expect(result.error).toContain('pause_recurring requires');
    expect(stub.insertedPayloads.length).toBe(0);
  });

  it('rejects cap_category without monthly_cap', async () => {
    const stub = makeSupabaseStub({ rows: [] });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));
    const result = (await tool.execute({
      type: 'cap_category',
      parameters: { category: 'eat_drinking_out' },
      rationale: 'r',
    })) as ToolResult;
    expect(result.error).toContain('cap_category requires');
    expect(stub.insertedPayloads.length).toBe(0);
  });
});

// ---- reduce_merchant ----

describe('createProposeExperimentTool — reduce_merchant', () => {
  it('computes ~€72/month impact for 12×€18 Glovo over 90 days at 100% cut', async () => {
    const stub = makeSupabaseStub({
      rows: buildGlovoBaseline(),
      insertedId: 'exp-1',
    });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));

    const result = (await tool.execute({
      type: 'reduce_merchant',
      parameters: { merchant: 'glovo', reduction_pct: 100 },
      rationale: 'It is a leak the user named.',
    })) as ToolResult;

    expect(result.error).toBeUndefined();
    // Baseline = 12 * €18 = €216 over 90 days. Monthly = 216/90*30 = €72.
    expect(result.monthly_impact?.amount).toBe(72);
    expect(result.monthly_impact?.currency).toBe('EUR');
    expect(result.monthly_impact?.confidence).toBe('high');
    // Annualised = monthly * 12 = €864.
    expect(result.annualised_impact?.amount).toBe(864);
    expect(result.annualised_impact?.currency).toBe('EUR');

    // experiment_id mirrors the inserted row's id.
    expect(result.experiment_id).toBe('exp-1');

    // Up to 5 affected transactions.
    expect(result.affected_transactions?.length).toBeGreaterThan(0);
    expect(result.affected_transactions?.length).toBeLessThanOrEqual(5);

    // baseline_pattern fields populated and plausible.
    expect(result.baseline_pattern?.avg_amount).toBe(18);
    // 12 occurrences over 90 days = 4 per month.
    expect(result.baseline_pattern?.count_per_month).toBe(4);
    // All amounts equal → CV ≈ 0 → consistency ≈ 1.
    expect(result.baseline_pattern?.consistency_score).toBeGreaterThan(0.95);

    // Telemetry row written with correct shape.
    expect(stub.insertedPayloads.length).toBe(1);
    const payload = stub.insertedPayloads[0];
    expect(payload.user_id).toBe('user-123');
    expect(payload.conversation_id).toBe('conv-1');
    expect(payload.experiment_type).toBe('reduce_merchant');
    expect(payload.status).toBe('proposed');
    expect(payload.parameters).toEqual({ merchant: 'glovo', reduction_pct: 100 });
    expect(payload.computed_impact).toEqual({
      monthly_impact: { amount: 72, currency: 'EUR', confidence: 'high' },
      annualised_impact: { amount: 864, currency: 'EUR' },
    });
    expect(payload.affected_transaction_ids.length).toBeGreaterThan(0);
    expect(payload.affected_transaction_ids.length).toBeLessThanOrEqual(5);
    // The insert hit the right table.
    expect(stub.lastInsertTable).toBe('proposed_experiments');

    // Description is human-readable.
    expect(result.description?.toLowerCase()).toContain('cut');
    expect(result.description?.toLowerCase()).toContain('glovo');

    // next_check_in is ISO ~30 days in the future.
    const checkIn = new Date(result.next_check_in as string).getTime();
    const expected = Date.now() + 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(checkIn - expected)).toBeLessThan(60 * 60 * 1000); // within 1 hour
  });

  it('halves the impact when reduction_pct=50', async () => {
    const stub = makeSupabaseStub({
      rows: buildGlovoBaseline(),
      insertedId: 'exp-2',
    });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));

    const result = (await tool.execute({
      type: 'reduce_merchant',
      parameters: { merchant: 'glovo', reduction_pct: 50 },
      rationale: 'A softer cut as a starter experiment.',
    })) as ToolResult;

    expect(result.monthly_impact?.amount).toBe(36);
    expect(result.annualised_impact?.amount).toBe(432);
  });

  it('downgrades confidence to "med" with 4-9 occurrences', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const rows: StubRow[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(today.getTime() - (i + 1) * 10 * 24 * 60 * 60 * 1000);
      rows.push({
        id: `m${i}`,
        date: d.toISOString().slice(0, 10),
        description: 'GLOVO',
        amount: -18,
        category_id: 'eat_drinking_out',
      });
    }
    const stub = makeSupabaseStub({ rows, insertedId: 'exp-med' });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));

    const result = (await tool.execute({
      type: 'reduce_merchant',
      parameters: { merchant: 'glovo', reduction_pct: 100 },
      rationale: 'r',
    })) as ToolResult;

    expect(result.monthly_impact?.confidence).toBe('med');
  });
});

// ---- pause_recurring ----

describe('createProposeExperimentTool — pause_recurring', () => {
  it('returns high confidence for consistent €45/month gym (CV ≈ 0)', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    // 3 occurrences, monthly, identical amount.
    const rows: StubRow[] = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(today.getTime() - (i + 1) * 30 * 24 * 60 * 60 * 1000);
      rows.push({
        id: `gym${i}`,
        date: d.toISOString().slice(0, 10),
        description: 'PURE GYM',
        amount: -45,
        category_id: 'health_fitness',
      });
    }
    const stub = makeSupabaseStub({ rows, insertedId: 'exp-gym' });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));

    const result = (await tool.execute({
      type: 'pause_recurring',
      parameters: { merchant: 'pure gym' },
      rationale: 'Looks like a recurring gym charge the user hasn\'t used.',
    })) as ToolResult;

    expect(result.error).toBeUndefined();
    // ~ €45/month run-rate. baseline=€135 over 90 days → 135/90*30 = €45.
    expect(result.monthly_impact?.amount).toBe(45);
    // 3 occurrences = at low end of 'med' but matches the recurring rule.
    expect(['high', 'med']).toContain(result.monthly_impact?.confidence);
    expect(result.feasibility_note?.toLowerCase()).not.toContain("doesn't look");
    expect(result.baseline_pattern?.consistency_score).toBeGreaterThan(0.95);
  });

  it('returns low confidence + warning note for non-recurring pattern (high CV)', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    // 4 transactions at the same merchant but wildly varying amounts.
    const amounts = [-10, -25, -50, -90];
    const rows: StubRow[] = amounts.map((amt, i) => ({
      id: `c${i}`,
      date: new Date(today.getTime() - (i + 1) * 14 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      description: 'COFFEE SHOP',
      amount: amt,
      category_id: 'eat_drinking_out',
    }));
    const stub = makeSupabaseStub({ rows, insertedId: 'exp-coffee' });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));

    const result = (await tool.execute({
      type: 'pause_recurring',
      parameters: { merchant: 'coffee shop' },
      rationale: 'r',
    })) as ToolResult;

    expect(result.monthly_impact?.confidence).toBe('low');
    expect(result.feasibility_note?.toLowerCase()).toContain(
      "doesn't look recurring",
    );
    // Row still written — telemetry-first.
    expect(stub.insertedPayloads.length).toBe(1);
  });
});

// ---- cap_category ----

describe('createProposeExperimentTool — cap_category', () => {
  it('computes monthly_impact of €100 when monthly rate is €300 and cap is €200', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    // €900 of eat_drinking_out spend over 90 days = €300/month rate.
    // 18 occurrences at €50 each.
    const rows: StubRow[] = [];
    for (let i = 0; i < 18; i++) {
      const d = new Date(today.getTime() - (i + 1) * 5 * 24 * 60 * 60 * 1000);
      rows.push({
        id: `cap${i}`,
        date: d.toISOString().slice(0, 10),
        description: `MERCHANT ${i % 6}`,
        amount: -50,
        category_id: 'eat_drinking_out',
      });
    }
    const stub = makeSupabaseStub({ rows, insertedId: 'exp-cap' });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));

    const result = (await tool.execute({
      type: 'cap_category',
      parameters: { category: 'eat_drinking_out', monthly_cap: 200 },
      rationale: 'Eating out has been climbing — a cap puts a ceiling on it.',
    })) as ToolResult;

    expect(result.error).toBeUndefined();
    // 18*50=900 over 90 days → €300/month. Cap=200 → impact 100.
    expect(result.monthly_impact?.amount).toBe(100);
    expect(result.annualised_impact?.amount).toBe(1200);
    expect(stub.insertedPayloads.length).toBe(1);
  });

  it('returns monthly_impact 0 when current spend is below the cap', async () => {
    // €120 over 90 days → €40/month. Cap=200 → impact 0.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const rows: StubRow[] = [];
    for (let i = 0; i < 4; i++) {
      const d = new Date(today.getTime() - (i + 1) * 20 * 24 * 60 * 60 * 1000);
      rows.push({
        id: `low${i}`,
        date: d.toISOString().slice(0, 10),
        description: `MERCHANT ${i}`,
        amount: -30,
        category_id: 'subscriptions',
      });
    }
    const stub = makeSupabaseStub({ rows, insertedId: 'exp-zero' });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));

    const result = (await tool.execute({
      type: 'cap_category',
      parameters: { category: 'subscriptions', monthly_cap: 200 },
      rationale: 'r',
    })) as ToolResult;

    expect(result.monthly_impact?.amount).toBe(0);
    expect(result.annualised_impact?.amount).toBe(0);
    // Telemetry row still written for the zero-impact case.
    expect(stub.insertedPayloads.length).toBe(1);
  });
});

// ---- consolidate_category ----

describe('createProposeExperimentTool — consolidate_category', () => {
  it('returns 0 impact + threshold note when <5 distinct merchants', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    // 6 transactions across only 3 distinct merchants in groceries.
    const merchants = ['TESCO', 'WAITROSE', 'M&S'];
    const rows: StubRow[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(today.getTime() - (i + 1) * 10 * 24 * 60 * 60 * 1000);
      rows.push({
        id: `c${i}`,
        date: d.toISOString().slice(0, 10),
        description: merchants[i % 3],
        amount: -40,
        category_id: 'groceries',
      });
    }
    const stub = makeSupabaseStub({ rows, insertedId: 'exp-thin' });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));

    const result = (await tool.execute({
      type: 'consolidate_category',
      parameters: { category: 'groceries' },
      rationale: 'r',
    })) as ToolResult;

    expect(result.error).toBeUndefined();
    expect(result.monthly_impact?.amount).toBe(0);
    expect(result.monthly_impact?.confidence).toBe('low');
    expect(result.feasibility_note?.toLowerCase()).toContain('5+ merchants');
    // Telemetry row written even when threshold not met.
    expect(stub.insertedPayloads.length).toBe(1);
  });

  it('computes ~15% reduction when ≥5 distinct merchants', async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    // 12 transactions across 6 distinct merchants → fragmented.
    // Total = 12 * €30 = €360 over 90 days → €120/month → impact = 15% = €18.
    const rows: StubRow[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(today.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
      rows.push({
        id: `f${i}`,
        date: d.toISOString().slice(0, 10),
        description: `STORE_${i % 6}`,
        amount: -30,
        category_id: 'groceries',
      });
    }
    const stub = makeSupabaseStub({ rows, insertedId: 'exp-cons' });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));

    const result = (await tool.execute({
      type: 'consolidate_category',
      parameters: { category: 'groceries' },
      rationale: 'r',
    })) as ToolResult;

    expect(result.monthly_impact?.amount).toBe(18);
    expect(result.monthly_impact?.confidence).toBe('med');
  });
});

// ---- redirect_to_goal ----

describe('createProposeExperimentTool — redirect_to_goal', () => {
  it('returns 0 monthly_impact with a meta feasibility note', async () => {
    const stub = makeSupabaseStub({ rows: [], insertedId: 'exp-redir' });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));

    const result = (await tool.execute({
      type: 'redirect_to_goal',
      parameters: { goal_id: 'goal-uuid-1' },
      rationale: 'Pair the savings with the emergency fund goal.',
    })) as ToolResult;

    expect(result.error).toBeUndefined();
    expect(result.monthly_impact?.amount).toBe(0);
    expect(result.feasibility_note?.toLowerCase()).toContain(
      'pair this with',
    );
    expect(stub.insertedPayloads.length).toBe(1);
    expect(stub.insertedPayloads[0].experiment_type).toBe('redirect_to_goal');
  });
});

// ---- RLS / query hygiene ----

describe('createProposeExperimentTool — query hygiene', () => {
  it('pins transactions read by user_id (RLS)', async () => {
    const stub = makeSupabaseStub({
      rows: buildGlovoBaseline(),
      insertedId: 'exp-rls',
    });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));

    await tool.execute({
      type: 'reduce_merchant',
      parameters: { merchant: 'glovo', reduction_pct: 100 },
      rationale: 'r',
    });

    const userPins = stub.calls.filter(
      (c) => c.method === 'eq' && c.args[0] === 'user_id' && c.args[1] === 'user-123',
    );
    // Exactly one pin on the transactions read. The proposed_experiments
    // insert relies on RLS server-side via the row payload's user_id.
    expect(userPins.length).toBe(1);
  });

  it('pins soft-delete (deleted_at IS NULL) on transactions read', async () => {
    const stub = makeSupabaseStub({
      rows: buildGlovoBaseline(),
      insertedId: 'exp-soft',
    });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));

    await tool.execute({
      type: 'reduce_merchant',
      parameters: { merchant: 'glovo', reduction_pct: 100 },
      rationale: 'r',
    });

    const isCalls = stub.calls.filter((c) => c.method === 'is');
    expect(
      isCalls.some((c) => c.args[0] === 'deleted_at' && c.args[1] === null),
    ).toBe(true);
  });

  it('returns an error and does not insert when the transactions read fails', async () => {
    const stub = makeSupabaseStub({
      txnError: { message: 'boom' },
    });
    const tool = createProposeExperimentTool(makeCtx(stub.supabase));

    const result = (await tool.execute({
      type: 'reduce_merchant',
      parameters: { merchant: 'glovo', reduction_pct: 100 },
      rationale: 'r',
    })) as ToolResult;

    expect(result.error).toContain('Could not fetch transactions');
    expect(stub.insertedPayloads.length).toBe(0);
  });
});
