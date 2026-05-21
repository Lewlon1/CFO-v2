# Archetype-Aware Experiment Scoring — Implementation Audit

**Date:** 2026-05-21
**Session:** v2.3.1
**Branch:** `claude/jolly-easley-0d9577`
**Scope:** add `values_alignment` as the fifth dimension on the experiment-scoring engine; enhance `merchant_fragmentation` detector to surface its dominant merchant

---

## What landed

Five commits, ~700-line diff, no schema migration:

| Commit | Phase | Files |
|---|---|---|
| `feat(scoring): add values_alignment dimension and rebalance weights` | 1 | templates.ts, scoring.ts, scoring.test.ts, insight-types.ts, insight-engine.ts, propose-catalog-experiment.ts |
| `feat(value-map): UserValueProfile builder + resolveValuesAlignment` | 2+3 | value-profile.ts, value-profile.test.ts |
| `feat(scoring): plumb UserValueProfile and DYNAMIC category resolution` | 4 | scoring.ts, scoring.test.ts |
| `feat(detectors): surface topMerchant + topMerchantCategory in merchant_fragmentation` | 5 | pattern-detectors.ts, pattern-detectors.test.ts |
| `feat(insight-engine): build UserValueProfile and resolve DYNAMIC categories` | 6 | insight-engine.ts |

`SCORING_WEIGHTS` rebalanced from `0.40 / 0.25 / 0.20 / 0.15` to `0.35 / 0.20 / 0.15 / 0.15 / 0.15`. Boot-time assertion guards the sum.

Template tags applied:

| Template | `affects_categories` | `quadrant_intent` |
|---|---|---|
| `subscription_audit` | `['subscriptions']` | — |
| `merchant_cap` | `['DYNAMIC']` | — |
| `convenience_swap` | `['groceries', 'eat_drinking_out']` | — |
| `weekend_cap` | `['eat_drinking_out', 'entertainment']` | — |
| `cap_top_category` | `['DYNAMIC']` | — |
| `velocity_brake` | — | — |
| `value_leak_pause` | — | `'leak'` |
| `redirect_windfall_to_goal` | — | — |
| `creep_reverse` | — | — |
| `sawtooth_smooth` | — | — |

---

## Synthetic before/after comparison

The full functional behaviour is proven by 19 unit tests on the scoring engine and 12 on the value-profile module (49 + 690 tests pass in total). The two canonical scenarios:

### Lewis (Foundation dining, Leak subscriptions)

Per-category profile:
```
eat_drinking_out: { foundation: 0.7, investment: 0.1, leak: 0.1, burden: 0.1 }
subscriptions:    { foundation: 0.1, investment: 0,   leak: 0.85, burden: 0.05 }
```

Detected patterns: `day_of_week_skew`, `recurring_expense_total`. Goal: `savings`.

Scoring breakdowns:

| Template | goal | meas | effort | reach | values | total |
|---|---|---|---|---|---|---|
| `weekend_cap` (before) | 0.30 | 0.25 | 0.12 | 0.15 | — | 0.82 |
| `weekend_cap` (after) | 0.2625 | 0.20 | 0.09 | 0.15 | **0.25**×0.15 = **0.0375** | **0.7400** |
| `subscription_audit` (before) | 0.34 | 0.25 | 0.20 | 0.075 | — | 0.865 |
| `subscription_audit` (after) | 0.2975 | 0.20 | 0.15 | 0.075 | **0.95**×0.15 = **0.1425** | **0.865** |

**Result:** `subscription_audit` now outranks `weekend_cap` by `0.125` instead of `0.045`. The gap widens 2.8× — the engine has materially shifted away from capping Foundation behaviour. Verified by `scoring.test.ts:236` (`flips weekend_cap below subscription_audit for a Foundation-dining user with Leak subscriptions`).

### Dorcas (Leak dining/entertainment, Leak subscriptions)

Per-category profile:
```
eat_drinking_out: { foundation: 0.05, investment: 0.05, leak: 0.8,  burden: 0.1  }
entertainment:    { foundation: 0.1,  investment: 0.05, leak: 0.8,  burden: 0.05 }
subscriptions:    { foundation: 0.1,  investment: 0,    leak: 0.85, burden: 0.05 }
```

Same detected patterns + goal:

| Template | values_alignment |
|---|---|
| `weekend_cap` | **0.95** (MIN of dining=0.95, entertainment=0.95) |
| `subscription_audit` | **0.95** |
| `velocity_brake` | 0.5 (no affects_categories) |

All cap-targeting experiments score high because she has self-identified the targets as Leaks. `value_leak_pause` (which has `quadrant_intent: 'leak'`) also lifts to 0.85 (ceiling) because she has leak signal anywhere. Verified by `scoring.test.ts:197` (`lifts weekend_cap when dining is Leak for the user`).

### No-Value-Map user (regression case)

Without a `UserValueProfile`, all templates score `values_alignment = 0.5`. Combined with the uniform weight shift, ranking degrades to v2.3 + a constant offset. Verified by `scoring.test.ts:259` (`preserves all-neutral 0.5 for users with no Value Map`).

---

## Staging verification procedure (Lewis to execute)

The Supabase MCP configured for this session is pointed at a different project. Run these against `qlbhvlssksnrhsleadzn` (CFO Staging) before declaring v2.3.1 ready to ship:

### Step 1 — Confirm Dorcas's signal

```sql
-- Per-category quadrant distribution from rules table (post-filter).
SELECT match_value AS category, value_category, COUNT(*) AS rule_count
FROM value_category_rules
WHERE user_id = 'c6b1dd54-0c90-47ab-b098-d724d27471f7'
  AND source IN ('value_map', 'correction', 'learned')
  AND match_type IN ('category', 'category_time', 'category_amount')
GROUP BY match_value, value_category
ORDER BY match_value, rule_count DESC;
```

Expected: at least 3 weighted signals per category for `subscriptions`, `eat_drinking_out`, and ideally `entertainment`. If sparse, the `values_alignment` dimension falls through to neutral and the integration test won't differentiate.

```sql
-- Confirmed per-category transactions (secondary signal).
SELECT category_id, value_category, COUNT(*)
FROM transactions
WHERE user_id = 'c6b1dd54-0c90-47ab-b098-d724d27471f7'
  AND value_category IS NOT NULL
  AND value_confirmed_by_user = true
  AND category_id IS NOT NULL
GROUP BY category_id, value_category
ORDER BY count DESC LIMIT 30;
```

### Step 2 — Run the insight engine end-to-end

The cleanest way to surface the post-change ranking on staging is a one-off invocation. From `cfos-office/`:

```bash
NEXT_PUBLIC_SUPABASE_URL=<staging-url> \
SUPABASE_SERVICE_ROLE_KEY=<staging-key> \
npx tsx -e '
  import { createClient } from "@supabase/supabase-js";
  import { computeFirstInsight } from "./src/lib/analytics/insight-engine";
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const result = await computeFirstInsight(supabase, "c6b1dd54-0c90-47ab-b098-d724d27471f7");
  console.log(JSON.stringify(result.experiment_proposal, null, 2));
'
```

### Step 3 — Inspect a freshly-proposed experiment

After Dorcas's next insight pass (or after triggering one manually), confirm the JSONB shape:

```sql
SELECT
  template_id,
  proposal_score,
  scoring_breakdown
FROM proposed_experiments
WHERE user_id = 'c6b1dd54-0c90-47ab-b098-d724d27471f7'
ORDER BY proposed_at DESC
LIMIT 5;
```

**Expected:** every row proposed post-deploy has a 5-key `scoring_breakdown` JSON: `{ goal_alignment, measurability, effort, reach, values_alignment }`. Rows proposed before the deploy keep their 4-key shape (no migration; the JSONB column accepts both).

### Step 4 — Cofounder dominance check

After 10–20 fresh proposals exist on staging, eyeball the breakdown JSON. If `values_alignment` is dominating in ways that feel wrong (e.g. every proposal for a user who labelled everything Foundation scores 0.25 across the board), drop the weight to 0.10 and give 0.05 back to `goal_alignment`. This is the dial the cofounder flagged in the session prompt.

---

## Pre-existing issues noted (out of scope)

While auditing `merchant_fragmentation`, the food-category filter at `pattern-detectors.ts:44` references slugs that don't match the canonical category table:

```ts
const FOOD_CATEGORIES = ['groceries', 'dining_out', 'convenience'];
```

The canonical slugs (from `supabase/migrations/003_category_system.sql`) are `groceries`, `eat_drinking_out`, and no `convenience` category exists. The detector therefore probably never matches dining transactions in production. This is an existing bug, separate from this session — flagging so it doesn't get lost. A fix would also benefit `convenience_swap`'s template targeting (currently tagged `['groceries', 'eat_drinking_out']`, which is correct for the template even though the trigger detector uses the wrong slugs).

---

## Verification checklist (signed off)

- [x] All 10 templates tagged with `affects_categories` and/or `quadrant_intent` (or deliberately empty per the plan)
- [x] `SCORING_WEIGHTS` sum to 1.0 with boot-time assertion in place
- [x] `tsc --noEmit` clean (no `npm typecheck` script — uses `./node_modules/.bin/tsc`)
- [x] `npm run build` clean
- [x] `npm test` — 690 tests across 60 files pass
- [x] `merchant_fragmentation` enhancement produces `topMerchant`/`topMerchantCategory` in its data payload
- [x] `resolveDynamicCategories` maps `cap_top_category` and `merchant_cap` (preferring `merchant_fragmentation` for the latter)
- [x] No-VM users get all-neutral 0.5 on `values_alignment` (regression preserved modulo uniform weight shift)
- [x] `propose_catalog_experiment` accepts both 4-field and 5-field `scoring_breakdown` shapes (Zod `.default(0.5)`)
- [ ] **Pending (Lewis):** Dorcas staging data confirmed non-empty after source filter
- [ ] **Pending (Lewis):** `proposed_experiments.scoring_breakdown` has 5 fields on freshly proposed rows
- [ ] **Pending (Lewis):** Eyeball 10–20 fresh proposals; decide whether to retune the 0.15 weight

The functional implementation is complete and locally verified. The remaining items are staging-environment verifications that require Supabase project access this session did not have.
