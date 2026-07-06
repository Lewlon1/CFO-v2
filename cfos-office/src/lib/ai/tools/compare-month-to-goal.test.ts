import { describe, it, expect } from 'vitest';
import { createCompareMonthToGoalTool } from './compare-month-to-goal';

// Stub covering the two tables the tool touches:
//   goals:             getPrimaryGoal awaits the chain directly (array);
//                      an explicit goal_id path uses .eq('id', X).maybeSingle().
//   monthly_snapshots: awaited directly (array) after .eq()/.order()/.limit() —
//                      the stub ignores filter arguments and returns the
//                      pre-shaped rows verbatim (same convention as
//                      reconcile-fixed-costs.test.ts / levers.test.ts).
function makeStub({
  primaryGoalRows = [],
  goalsById = {},
  snapshotRows = [],
}: {
  primaryGoalRows?: unknown[];
  goalsById?: Record<string, unknown>;
  snapshotRows?: unknown[];
}) {
  let requestedGoalId: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const goalsChain: any = {
    select: () => goalsChain,
    eq: (col: string, val: unknown) => {
      if (col === 'id') requestedGoalId = val as string;
      return goalsChain;
    },
    is: () => goalsChain,
    maybeSingle: () =>
      Promise.resolve({
        data: requestedGoalId && goalsById[requestedGoalId] ? goalsById[requestedGoalId] : null,
        error: null,
      }),
    then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
      resolve({ data: primaryGoalRows, error: null });
      return Promise.resolve();
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshotsChain: any = {
    select: () => snapshotsChain,
    eq: () => snapshotsChain,
    order: () => snapshotsChain,
    limit: () => snapshotsChain,
    then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
      resolve({ data: snapshotRows, error: null });
      return Promise.resolve();
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    from: (table: string) => (table === 'goals' ? goalsChain : snapshotsChain),
  } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctxWith = (supabase: any) =>
  ({ supabase, userId: 'u1', conversationId: 'c1', currency: 'USD' }) as never;

const debtGoal = {
  id: 'g1',
  name: 'Pay off debt',
  target_amount: 18000,
  current_amount: 0,
  target_date: '2028-05-27',
  monthly_required_saving: 500,
  on_track: null,
  priority: 'high',
  created_at: '2026-01-01T00:00:00Z',
};

describe('compare_month_to_goal — Issue 7.1 (no more mixed-frame arithmetic)', () => {
  it('reads the snapshot\'s own surplus_deficit — not a recomputed budget-minus-spend figure — and verdicts covered', async () => {
    // Regression shape: February's snapshot says $967.50 surplus; the goal
    // needs $500/mo. The bug this replaces mixed frames (post-fixed-costs
    // budget minus all-inclusive spend) and got "$833 short" instead.
    const tool = createCompareMonthToGoalTool(
      ctxWith(
        makeStub({
          primaryGoalRows: [debtGoal],
          goalsById: { g1: debtGoal },
          snapshotRows: [
            {
              month: '2026-02-01',
              total_income: 4000,
              total_spending: 3032.5,
              surplus_deficit: 967.5,
              total_fixed_costs: 1800,
              total_discretionary: 1232.5,
            },
          ],
        }),
      ),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await tool.execute({ month: '2026-02' });
    expect(res.success).toBe(true);
    expect(res.month).toBe('2026-02');
    expect(res.surplus).toBe(967.5);
    expect(res.monthly_required_saving).toBe(500);
    expect(res.verdict).toBe('covered');
    expect(res.gap_amount).toBeNull();
  });

  it('verdicts short and sizes the gap when surplus is below the requirement', async () => {
    const tool = createCompareMonthToGoalTool(
      ctxWith(
        makeStub({
          primaryGoalRows: [debtGoal],
          goalsById: { g1: debtGoal },
          snapshotRows: [
            {
              month: '2026-03-01',
              total_income: 4000,
              total_spending: 3700,
              surplus_deficit: 300,
              total_fixed_costs: 1800,
              total_discretionary: 1900,
            },
          ],
        }),
      ),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await tool.execute({ month: '2026-03' });
    expect(res.verdict).toBe('short');
    expect(res.gap_amount).toBe(200); // 500 required − 300 surplus
  });

  it('resolves the primary goal when no goal_id is given', async () => {
    const tool = createCompareMonthToGoalTool(
      ctxWith(
        makeStub({
          primaryGoalRows: [debtGoal],
          snapshotRows: [
            { month: '2026-02-01', total_income: 4000, total_spending: 3032.5, surplus_deficit: 967.5 },
          ],
        }),
      ),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await tool.execute({});
    expect(res.goal_id).toBe('g1');
    expect(res.goal_name).toBe('Pay off debt');
  });

  it('returns a clear error when no snapshot exists for the requested month', async () => {
    const tool = createCompareMonthToGoalTool(
      ctxWith(makeStub({ primaryGoalRows: [debtGoal], snapshotRows: [] })),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await tool.execute({ month: '2025-01' });
    expect(res.error).toBe('no_snapshot');
  });

  it('returns no_goal_pace when the goal has no monthly_required_saving', async () => {
    const goalWithoutPace = { ...debtGoal, monthly_required_saving: null };
    const tool = createCompareMonthToGoalTool(
      ctxWith(
        makeStub({
          primaryGoalRows: [goalWithoutPace],
          snapshotRows: [
            { month: '2026-02-01', total_income: 4000, total_spending: 3032.5, surplus_deficit: 967.5 },
          ],
        }),
      ),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await tool.execute({});
    expect(res.verdict).toBe('no_goal_pace');
    expect(res.gap_amount).toBeNull();
  });
});
