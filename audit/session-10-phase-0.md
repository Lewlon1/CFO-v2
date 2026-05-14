# Session 10 — Phase 0 Ground Truth

**Investigation date:** 2026-05-14
**Branch:** `feature/goal-progress-engine`
**Source audit:** [audit/goal-engine-state.md](goal-engine-state.md) (May 2026 audit by previous investigation)

## Summary of what the engine needs to do

Goals have three computed columns (`current_amount`, `monthly_required_saving`, `on_track`) that are written once at creation and never updated. Session 10 makes them live by:
- Introducing a `goal_contributions` table — every contribution writes a row; `current_amount` becomes derived (`COALESCE(SUM(contributions), 0)`).
- Extracting the pace/on-track computation from `create_goal` into a shared function.
- Building a recompute engine that updates the three columns for a user's active goals.
- Wiring the recompute to run once per session on entry to the `(office)` route group, with a 30-minute TTL.
- Manual contributions only — transaction-to-goal matching is explicitly deferred.

## The pace formula (verbatim, to be extracted)

From [cfos-office/src/lib/ai/tools/create-goal.ts](../cfos-office/src/lib/ai/tools/create-goal.ts) lines 50–60:

```ts
let monthlySaving: number | null = null;
if (target_date) {
  const now = new Date();
  const target = new Date(target_date);
  const monthsLeft =
    (target.getFullYear() - now.getFullYear()) * 12 +
    (target.getMonth() - now.getMonth());
  if (monthsLeft > 0) {
    monthlySaving = Math.round(remaining / monthsLeft);
  }
}
```

- `remaining = target_amount - current_amount`
- `monthsLeft > 0` is the guard; otherwise `monthlySaving = null` (overdue goal — no rate is meaningful).
- Calendar-month delta, not day-precise — matches the existing UI display.

## The on-track formula (verbatim)

From `create-goal.ts` lines 63–77:

```ts
let onTrack: boolean | null = null;
if (monthlySaving != null) {
  const [budget, avgDiscretionary] = await Promise.all([
    loadCurrentBudget(ctx),
    loadAverageDiscretionary(ctx),
  ]);
  if (budget.netIncome != null) {
    const totalIncome = budget.netIncome + budget.partnerContribution;
    const discretionary = avgDiscretionary ?? 0;
    const surplus = totalIncome - budget.fixedCosts - discretionary;
    onTrack = surplus >= monthlySaving;
  }
}
```

Reads:
- `user_profiles.net_monthly_income`, `partner_monthly_contribution` (via `loadCurrentBudget`)
- `recurring_expenses.amount`, `frequency` summed via `toMonthlyEquivalent` (via `loadCurrentBudget`)
- Last 3 `monthly_snapshots.total_discretionary` averaged (via `loadAverageDiscretionary`)

Helpers live at [cfos-office/src/lib/ai/tools/helpers.ts](../cfos-office/src/lib/ai/tools/helpers.ts) and are reused by Session 10 — not modified.

Returns null when monthlySaving is null OR when netIncome is null (insufficient profile data).

## `current_amount` — read / write sites

**Writes** (only two creation paths, both inserts; no UPDATEs anywhere):
- [create-goal.ts:86](../cfos-office/src/lib/ai/tools/create-goal.ts) — `current_amount: Math.round(saved)` where `saved = current_amount ?? 0`
- [plan-trip.ts:267, 291](../cfos-office/src/lib/ai/tools/plan-trip.ts) — hard-coded `0` for trip-linked goals

**Reads** (display, AI context, nudges):
- [GoalCard.tsx:20](../cfos-office/src/app/(office)/office/scenarios/goals/GoalCard.tsx) — progress bar render
- [TripsClient.tsx:37, 149](../cfos-office/src/components/trips/TripsClient.tsx) — trip progress
- [scenarios/page.tsx:25](../cfos-office/src/app/(office)/office/scenarios/page.tsx), [scenarios/trips/page.tsx:19](../cfos-office/src/app/(office)/office/scenarios/trips/page.tsx) — list queries
- [context-builder.ts:506, 1191](../cfos-office/src/lib/ai/context-builder.ts) — system prompt assembly
- [review-context.ts:124–218](../cfos-office/src/lib/ai/review-context.ts) — monthly review context
- [goal-milestone.ts:27](../cfos-office/src/lib/nudges/evaluators/goal-milestone.ts) — milestone threshold check (25/50/75/100%)
- [model-scenario.ts:211, 291](../cfos-office/src/lib/ai/tools/model-scenario.ts) — months-to-save math

After Session 10, the only writers of `current_amount` are the recompute engine itself and the two existing insert paths (which now also write a `kind='seed'` contribution row in `create-goal.ts`, retaining the immediate-correctness fallback). The recompute is invoked from: `logContribution()` (per-goal), the login hook (per-user), and indirectly via the chat tool / UI affordance which both call `logContribution`.

## Decisions

### Seed representation — Option B (seed as first contribution row)

The seed (the user's "what have you put away so far?" answer) becomes the first row in `goal_contributions` with `kind='seed'`. `current_amount` is derived: `COALESCE(SUM(active contributions for goal), 0)`.

Why B over A (separate `initial_seed_amount` column):
- Single ledger; one source of truth.
- Auditable history: "the seed was €X on 2026-04-12" is visible alongside subsequent contributions.
- No two-column-disagreement risk (seed vs. running total).

How B works with Session 09's existing write to `current_amount`:
- `create-goal.ts` continues to write `goals.current_amount = seed` at creation (immediate correctness for callers who read the row before the next recompute).
- If `seed > 0`, `create-goal.ts` also inserts a `kind='seed'` row in `goal_contributions`.
- Backfill migration inserts seed rows for existing prod/staging goals with `current_amount > 0` (idempotent via `NOT EXISTS`).
- Subsequent recomputes maintain the invariant `current_amount = COALESCE(SUM(contributions), 0)`.

A **defensive guard** in the recompute protects against a failed seed insert: if a goal has zero contributions AND non-zero `current_amount`, the recompute leaves `current_amount` alone (never silently zeroes a stored value).

### Recompute placement — TypeScript server-side

The recompute calls existing TS helpers `loadCurrentBudget` / `loadAverageDiscretionary` from `helpers.ts`. Porting those to plpgsql would duplicate the budget logic in two languages — a maintenance trap. TS is acceptable per the spec's fallback option and per the "the system computes, Claude interprets" rule (server-side code, not a prompt).

The `current_amount` UPDATE itself happens via a small plpgsql function called from TS — that part is SQL so the SUM + defensive-guard predicate are atomic in a single statement, eliminating the read-then-write race between concurrent tabs.

### Login hook — `(office)/layout.tsx` + 30-min TTL

The `(office)` layout is a `force-dynamic` server component that already runs `getUser()` and SELECTs `user_profiles` on every request. We extend that SELECT with `goals_last_synced_at` (new column on `user_profiles`), and if it's null or > 30 min old, fire `recomputeUserGoals(...)` via Next.js `after()` (already used in 5 routes in this codebase — proven pattern). The recompute runs fire-and-forget after the response is sent; render is never blocked; any error is logged but invisible to the user (they see last-known numbers).

A 30-minute TTL is well within the "up to one session's staleness is acceptable" tolerance. Tab-level contribution writes trigger an immediate per-goal recompute on the chat / UI path, so the user never sees stale numbers for their own actions.

### plan-trip.ts is in scope

`plan-trip.ts` uses a different `on_track` formula (`feasibilityRating !== 'unrealistic'`, lines 240). After the recompute runs, trip-linked goals would silently shift to the surplus-vs-required formula. Session 10 aligns both creators on the same `computePaceAndOnTrack` helper.

### Other decisions

- **Negative contributions allowed** (CHECK `amount <> 0`). DB stores the true sum; UI/nudges clamp at zero. CFO copy can frame negatives as coaching moments.
- **`is_overdue`** is a derived flag returned by the recompute; not a stored column. `monthly_required_saving` stays null for overdue goals.
- **Atomic SUM-in-UPDATE** via a small plpgsql helper function eliminates read-then-write races.
- **Migration to staging only.** Production migrations are applied by Lewis manually.
