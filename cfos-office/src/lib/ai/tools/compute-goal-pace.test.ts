import { describe, it, expect } from 'vitest';
import { createComputeGoalPaceTool } from './compute-goal-pace';

// Minimal Supabase stub covering the two chains compute_goal_pace touches:
//   getPrimaryGoal: .from('goals').select().eq().eq().is()  → awaited (thenable)
//   pace lookup:    .from('goals').select().eq('id',X).eq().is().maybeSingle()
// The stub is id-aware: maybeSingle() only returns a goal when .eq('id', …) was
// called with an id present in `goalsById`. That makes "resolve the primary goal
// when no goal_id is given" a meaningful assertion — the pre-fix code passed
// goal_id=undefined straight through and would resolve nothing.
function makeStub({
  primaryRows,
  goalsById,
}: {
  primaryRows: unknown[];
  goalsById: Record<string, unknown>;
}) {
  let requestedId: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      if (col === 'id') requestedId = val as string;
      return chain;
    },
    is: () => chain,
    maybeSingle: () =>
      Promise.resolve({
        data: requestedId && goalsById[requestedId] ? goalsById[requestedId] : null,
        error: null,
      }),
    // getPrimaryGoal awaits the chain after .is(); resolve to its row set.
    then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
      resolve({ data: primaryRows, error: null });
      return Promise.resolve();
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => chain } as any;
}

const weddingGoal = {
  id: 'g1',
  name: 'Wedding',
  type: 'savings',
  target_amount: 15000,
  current_amount: 5000,
  target_date: '2027-12-06',
  monthly_required_saving: 556,
  on_track: false,
  currency: 'EUR',
  status: 'active',
};

const weddingPrimaryRow = {
  id: 'g1',
  name: 'Wedding',
  target_amount: 15000,
  current_amount: 5000,
  target_date: '2027-12-06',
  monthly_required_saving: 556,
  on_track: false,
  priority: 'high',
  created_at: '2026-06-06T11:08:00Z',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctxWith = (supabase: any) =>
  ({ supabase, userId: 'u1', conversationId: 'c1', currency: 'EUR' }) as never;

describe('compute_goal_pace — primary-goal resolution', () => {
  it('accepts empty input (goal_id is optional)', () => {
    const tool = createComputeGoalPaceTool(ctxWith(makeStub({ primaryRows: [], goalsById: {} })));
    expect(tool.inputSchema.safeParse({}).success).toBe(true);
  });

  it('resolves the user\'s primary active goal when no goal_id is given', async () => {
    const tool = createComputeGoalPaceTool(
      ctxWith(makeStub({ primaryRows: [weddingPrimaryRow], goalsById: { g1: weddingGoal } })),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await tool.execute({});
    expect(res.success).toBe(true);
    expect(res.goal_id).toBe('g1');
    expect(res.monthly_required_saving).toBe(556);
  });

  it('returns a clear "no active goal" error when none exists and no id is given', async () => {
    const tool = createComputeGoalPaceTool(
      ctxWith(makeStub({ primaryRows: [], goalsById: {} })),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await tool.execute({});
    expect(res.success).toBeUndefined();
    expect(String(res.error)).toMatch(/no active goal/i);
  });

  it('still uses an explicitly provided goal_id', async () => {
    const tool = createComputeGoalPaceTool(
      ctxWith(makeStub({ primaryRows: [], goalsById: { g1: weddingGoal } })),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await tool.execute({ goal_id: 'g1' });
    expect(res.success).toBe(true);
    expect(res.goal_id).toBe('g1');
  });
});
