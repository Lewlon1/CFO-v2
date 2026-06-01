// Tool-level tests for the experiment lifecycle (accept / decline / outcome /
// list). Capacity / novelty math is covered exhaustively in
// src/lib/experiments/__tests__/limit.test.ts and scoring.test.ts. Here we
// assert the tools' status-transition guards, ownership checks, and outcome
// → status mapping using a minimal in-memory Supabase stub.

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createAcceptExperimentTool } from './accept-experiment';
import { createDeclineExperimentTool } from './decline-experiment';
import { createRecordExperimentOutcomeTool } from './record-experiment-outcome';
import { createListActiveExperimentsTool } from './list-active-experiments';
import type { ToolContext } from './types';

interface Row {
  id: string;
  user_id: string;
  status: string;
  duration_days: number | null;
  title: string | null;
  success_criterion?: string | null;
  template_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  outcome_reported_at?: string | null;
  proposed_at?: string;
  outcome_self_report?: string | null;
}

interface StubOptions {
  // Map of experiment_id → row used as the source of truth.
  rows: Row[];
  // For isCapacityAvailable: rows used to compute completion stats + active count.
  // If omitted, capacity is treated as always allowed with limit=3, active=0.
  capacityAllowed?: boolean;
}

// Minimal stub: each `.from(table)` returns a builder whose terminal call
// (single/maybeSingle) resolves to a row from the in-memory rows list. The
// stub mutates the rows list on `update()` so the lifecycle reads correctly
// from chained tool calls.
function makeStub(opts: StubOptions): SupabaseClient {
  const rows = [...opts.rows];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function build(table: string): any {
    let mode: 'select' | 'update' | 'insert' = 'select';
    const filters: Array<{ col: string; val: unknown; op: 'eq' | 'in' | 'is' | 'not' }> = [];
    let updatePayload: Partial<Row> = {};
    let limitN: number | null = null;
    let orderBy: { col: string; ascending: boolean } | null = null;

    function applyFilters(set: Row[]): Row[] {
      return set.filter((r) => {
        for (const f of filters) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const v = (r as any)[f.col];
          if (f.op === 'eq' && v !== f.val) return false;
          // `is null`: undefined and null both pass (matches Postgres "IS NULL").
          if (f.op === 'is' && f.val === null && v !== null && v !== undefined) return false;
          if (f.op === 'in' && Array.isArray(f.val) && !(f.val as unknown[]).includes(v))
            return false;
          if (f.op === 'not' && f.val === null && (v === null || v === undefined)) return false;
        }
        return true;
      });
    }

    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push({ col, val, op: 'eq' });
        return builder;
      },
      in: (col: string, val: unknown[]) => {
        filters.push({ col, val, op: 'in' });
        return builder;
      },
      is: (col: string, val: unknown) => {
        filters.push({ col, val, op: 'is' });
        return builder;
      },
      not: (col: string, _op: string, val: unknown) => {
        filters.push({ col, val, op: 'not' });
        return builder;
      },
      gte: () => builder,
      lt: () => builder,
      lte: () => builder,
      order: (col: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => {
        orderBy = { col, ascending: options?.ascending ?? true };
        return builder;
      },
      limit: (n: number) => {
        limitN = n;
        return builder;
      },
      update: (payload: Partial<Row>) => {
        mode = 'update';
        updatePayload = payload;
        return builder;
      },
      insert: () => {
        mode = 'insert';
        return builder;
      },
      maybeSingle: async () => {
        if (table !== 'proposed_experiments') return { data: null, error: null };
        const matches = applyFilters(rows);
        return { data: matches[0] ?? null, error: null };
      },
      single: async () => {
        if (table !== 'proposed_experiments') return { data: null, error: null };
        if (mode === 'update') {
          const target = applyFilters(rows)[0];
          if (!target) return { data: null, error: { message: 'no row' } };
          Object.assign(target, updatePayload);
          return { data: { ...target }, error: null };
        }
        const matches = applyFilters(rows);
        return { data: matches[0] ?? null, error: null };
      },
      then: (resolve: (v: { data: Row[] | null; error: null }) => void) => {
        let matches = applyFilters(rows);
        if (orderBy) {
          matches = [...matches].sort((a, b) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const av = (a as any)[orderBy!.col] ?? '';
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const bv = (b as any)[orderBy!.col] ?? '';
            if (av === bv) return 0;
            const cmp = av < bv ? -1 : 1;
            return orderBy!.ascending ? cmp : -cmp;
          });
        }
        if (limitN !== null) matches = matches.slice(0, limitN);
        resolve({ data: matches, error: null });
        return Promise.resolve({ data: matches, error: null });
      },
    };

    // Make `await builder` work — vitest passes through builders that resolve.
    return builder;
  }

  // For countActiveExperiments — count: 'exact', head: true.
  function buildCount(table: string) {
    const filters: Array<{ col: string; val: unknown; op: 'eq' | 'in' | 'is' }> = [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push({ col, val, op: 'eq' });
        return builder;
      },
      in: (col: string, val: unknown[]) => {
        filters.push({ col, val, op: 'in' });
        return builder;
      },
      is: (col: string, val: unknown) => {
        filters.push({ col, val, op: 'is' });
        return builder;
      },
      then: (resolve: (v: { count: number; error: null }) => void) => {
        if (table !== 'proposed_experiments') {
          resolve({ count: 0, error: null });
          return Promise.resolve({ count: 0, error: null });
        }
        if (opts.capacityAllowed === false) {
          resolve({ count: 3, error: null });
          return Promise.resolve({ count: 3, error: null });
        }
        resolve({ count: 0, error: null });
        return Promise.resolve({ count: 0, error: null });
      },
    };
    return builder;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stub: any = {
    from: (table: string) => {
      // For the count head:true case the real client returns the count via
      // a select chain ending in a count query — our minimal stub uses a
      // separate codepath when select() is called with options.
      return new Proxy(build(table), {
        get(target, prop, receiver) {
          if (prop === 'select') {
            return (
              _cols?: string,
              options?: { count?: string; head?: boolean },
            ) => {
              if (options?.count === 'exact' && options.head) {
                return buildCount(table);
              }
              return target.select();
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
    },
  };

  return stub as SupabaseClient;
}

function makeCtx(supabase: SupabaseClient): ToolContext {
  return {
    supabase,
    userId: 'user-1',
    conversationId: 'conv-1',
    currency: 'GBP',
  };
}

describe('accept_experiment', () => {
  it('transitions proposed → active and stamps starts_at/ends_at', async () => {
    const stub = makeStub({
      rows: [
        {
          id: 'exp-1',
          user_id: 'user-1',
          status: 'proposed',
          duration_days: 7,
          title: 'Cancel one subscription this week',
        },
      ],
    });
    const tool = createAcceptExperimentTool(makeCtx(stub));
    const result = await tool.execute({ experiment_id: 'exp-1' });
    expect('error' in result ? result.error : null).toBeNull();
    expect((result as { status?: string }).status).toBe('active');
    expect((result as { ends_at?: string }).ends_at).toBeTruthy();
  });

  it('rejects when ownership mismatches', async () => {
    const stub = makeStub({
      rows: [
        {
          id: 'exp-1',
          user_id: 'someone-else',
          status: 'proposed',
          duration_days: 7,
          title: 'x',
        },
      ],
    });
    const tool = createAcceptExperimentTool(makeCtx(stub));
    const result = await tool.execute({ experiment_id: 'exp-1' });
    expect((result as { error?: string }).error).toMatch(/does not belong/);
  });

  it('rejects when status is not "proposed"', async () => {
    const stub = makeStub({
      rows: [
        {
          id: 'exp-1',
          user_id: 'user-1',
          status: 'active',
          duration_days: 7,
          title: 'x',
        },
      ],
    });
    const tool = createAcceptExperimentTool(makeCtx(stub));
    const result = await tool.execute({ experiment_id: 'exp-1' });
    expect((result as { error?: string }).error).toMatch(/cannot accept/);
  });

  it('rejects when at capacity', async () => {
    const stub = makeStub({
      rows: [
        {
          id: 'exp-1',
          user_id: 'user-1',
          status: 'proposed',
          duration_days: 7,
          title: 'x',
        },
      ],
      capacityAllowed: false,
    });
    const tool = createAcceptExperimentTool(makeCtx(stub));
    const result = await tool.execute({ experiment_id: 'exp-1' });
    expect((result as { error?: string }).error).toMatch(/limit/);
  });
});

describe('decline_experiment', () => {
  it('sets status=declined and stores the reason in user_note', async () => {
    const rows: Row[] = [
      {
        id: 'exp-1',
        user_id: 'user-1',
        status: 'proposed',
        duration_days: 7,
        title: 'x',
      },
    ];
    const stub = makeStub({ rows });
    const tool = createDeclineExperimentTool(makeCtx(stub));
    const result = await tool.execute({ experiment_id: 'exp-1', reason: 'too soon' });
    expect((result as { status?: string }).status).toBe('declined');
  });

  it('rejects when status is not "proposed"', async () => {
    const stub = makeStub({
      rows: [
        {
          id: 'exp-1',
          user_id: 'user-1',
          status: 'active',
          duration_days: 7,
          title: 'x',
        },
      ],
    });
    const tool = createDeclineExperimentTool(makeCtx(stub));
    const result = await tool.execute({ experiment_id: 'exp-1' });
    expect((result as { error?: string }).error).toMatch(/cannot decline/);
  });
});

describe('record_experiment_outcome', () => {
  it('maps yes → succeeded', async () => {
    const stub = makeStub({
      rows: [
        {
          id: 'exp-1',
          user_id: 'user-1',
          status: 'active',
          duration_days: 7,
          title: 'x',
        },
      ],
    });
    const tool = createRecordExperimentOutcomeTool(makeCtx(stub));
    const result = await tool.execute({ experiment_id: 'exp-1', outcome: 'yes' });
    expect((result as { status?: string }).status).toBe('succeeded');
  });

  it('maps partial → partial', async () => {
    const stub = makeStub({
      rows: [
        {
          id: 'exp-1',
          user_id: 'user-1',
          status: 'active',
          duration_days: 7,
          title: 'x',
        },
      ],
    });
    const tool = createRecordExperimentOutcomeTool(makeCtx(stub));
    const result = await tool.execute({ experiment_id: 'exp-1', outcome: 'partial' });
    expect((result as { status?: string }).status).toBe('partial');
  });

  it('maps no → failed', async () => {
    const stub = makeStub({
      rows: [
        {
          id: 'exp-1',
          user_id: 'user-1',
          status: 'active',
          duration_days: 7,
          title: 'x',
        },
      ],
    });
    const tool = createRecordExperimentOutcomeTool(makeCtx(stub));
    const result = await tool.execute({ experiment_id: 'exp-1', outcome: 'no' });
    expect((result as { status?: string }).status).toBe('failed');
  });

  it('rejects when the experiment is not active', async () => {
    const stub = makeStub({
      rows: [
        {
          id: 'exp-1',
          user_id: 'user-1',
          status: 'declined',
          duration_days: 7,
          title: 'x',
        },
      ],
    });
    const tool = createRecordExperimentOutcomeTool(makeCtx(stub));
    const result = await tool.execute({ experiment_id: 'exp-1', outcome: 'yes' });
    expect((result as { error?: string }).error).toMatch(/only active/);
  });
});

describe('list_active_experiments', () => {
  it('partitions rows into active / awaiting_outcome / open_proposals', async () => {
    const now = Date.now();
    const past = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5d ago
    const future = new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString(); // 5d ahead

    const stub = makeStub({
      rows: [
        {
          id: 'active-1',
          user_id: 'user-1',
          status: 'active',
          duration_days: 7,
          title: 'Active one',
          starts_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
          ends_at: future,
          outcome_reported_at: null,
          template_id: 'velocity_brake',
          proposed_at: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'ended-1',
          user_id: 'user-1',
          status: 'active',
          duration_days: 7,
          title: 'Ended one',
          starts_at: new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString(),
          ends_at: past,
          outcome_reported_at: null,
          template_id: 'cap_top_category',
          proposed_at: new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 'open-prop-1',
          user_id: 'user-1',
          status: 'proposed',
          duration_days: 7,
          title: 'Open proposal',
          template_id: 'subscription_audit',
          proposed_at: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });

    const tool = createListActiveExperimentsTool(makeCtx(stub));
    const result = (await tool.execute({})) as {
      success?: boolean;
      counts?: { active: number; awaiting_outcome: number; open_proposals: number };
    };

    expect(result.success).toBe(true);
    expect(result.counts).toEqual({ active: 1, awaiting_outcome: 1, open_proposals: 1 });
  });
});
