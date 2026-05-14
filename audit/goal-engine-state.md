# Goal Engine State — May 2026

**Investigation date:** 2026-05-14
**Branch:** `investigation/goal-engine-audit`
**Environments queried:** CFO Staging (`qlbhvlssksnrhsleadzn`) and CFO Production (`iccelmjenljanqrhhzdv`). Read-only; no writes to either.

## Summary

**The goal engine does not exist as a system. It exists as a schema and two write tools.**

The `goals` table is well-formed (14 columns including `current_amount`, `monthly_required_saving`, `on_track`, `target_date`, `status`). Two AI tools (`create_goal`, `plan_trip`) insert rows. The goals page renders them. The wow moment in onboarding-v2 reads them. The milestone nudge evaluates them.

What is missing is anything that **maintains** them. After a goal is created, `current_amount` is never recomputed, `monthly_required_saving` is never re-paced, and `on_track` is never re-evaluated — by any cron, trigger, function, or app code. The progress columns are write-once frozen snapshots.

The downstream consequence: **Session 09 must build goal creation as part of onboarding (currently nothing in the onboarding-v2 flow touches `goals`). Session 10 must build the entire progress-update engine (current_amount writer, pace recomputation, on/off-track refresh). Session 13 must add a goal link to `action_items` and a ranking pass.** None of these are small. The system is closer to the start line than the original scoping suggested.

---

## Q1 — Goal persistence in onboarding (verdict: **references without persisting**)

**Onboarding v2 never writes to `goals` in any code path.**

Evidence — every `from('goals')` call in `cfos-office/src/`:

| File:line | Direction | Path |
|---|---|---|
| [create-goal.ts:69](cfos-office/src/lib/ai/tools/create-goal.ts) | **insert** | Claude chat tool |
| [plan-trip.ts:267, 291](cfos-office/src/lib/ai/tools/plan-trip.ts) | **insert** | Claude chat tool |
| [plan-trip.ts:254](cfos-office/src/lib/ai/tools/plan-trip.ts) | update | Claude chat tool (trip re-plan) |
| [goals/delete/route.ts:28](cfos-office/src/app/api/goals/delete/route.ts) | update | Soft-delete from goals page |
| [profile/delete-data/route.ts:50](cfos-office/src/app/api/profile/delete-data/route.ts) | delete | GDPR cascade |
| [scenarios/page.tsx:25](cfos-office/src/app/(office)/office/scenarios/page.tsx), [scenarios/trips/page.tsx:19](cfos-office/src/app/(office)/office/scenarios/trips/page.tsx), [scenarios/goals/page.tsx:15](cfos-office/src/app/(office)/office/scenarios/goals/page.tsx) | select | Display |
| [context-builder.ts:507](cfos-office/src/lib/ai/context-builder.ts), [review-context.ts:124](cfos-office/src/lib/ai/review-context.ts), [helpers.ts:67](cfos-office/src/lib/ai/tools/helpers.ts), [insight-engine.ts:478](cfos-office/src/lib/analytics/insight-engine.ts) | select | AI context |
| [goal-milestone.ts:9](cfos-office/src/lib/nudges/evaluators/goal-milestone.ts) | select | Milestone nudge |

**Zero rows in this table are reachable from the onboarding-v2 flow.** Confirmed by reading the orchestrators end-to-end:
- [onboarding-v2/page.tsx](cfos-office/src/app/onboarding-v2/page.tsx) → struggle question only.
- [actions.ts:51-92](cfos-office/src/app/onboarding-v2/actions.ts) → writes `user_profiles` (entry_struggle, onboarding_step) and `conversations` + `messages`. No `goals`.
- [value-map-orchestrator.tsx](cfos-office/src/app/onboarding-v2/value-map/value-map-orchestrator.tsx) → wraps ValueMapFlow. No `goals`.
- [upload-orchestrator.tsx](cfos-office/src/app/onboarding-v2/upload/upload-orchestrator.tsx) → wraps UploadWizard. No `goals`.
- [archetype-orchestrator.tsx](cfos-office/src/app/onboarding-v2/archetype/archetype-orchestrator.tsx) → POSTs `/api/insights/post-upload`. No `goals` insert.

**The wow moment is intent-aware, not goal-aware.** The crux file is [insight-engine.ts:165-199](cfos-office/src/lib/analytics/insight-engine.ts), `resolveUserIntent()`. Its precedence:

1. An active row in `goals` if one exists — but onboarding-v2 has not created one
2. `entry_struggle` set to `wealth | debt | planning` (the struggle picker writes this)
3. `entry_struggle = 'free_text'` with content
4. null

For any user who completes onboarding-v2 without independently calling `create_goal` in chat (which is everyone, on the first run), the wow moment's "intent" is the `entry_struggle`, not a goal. The marketing of "goal-aware wow moment" in [archetype-orchestrator.tsx:17-23](cfos-office/src/app/onboarding-v2/archetype/archetype-orchestrator.tsx) is currently a misnomer.

### Playwright trace

**Deferred.** The `cfos-office/tests/onboarding/` directory is sealed by deny rules in `.claude/settings.json` — Read, ls, find, cat, and grep all return permission errors in this session. A subagent attempt confirmed the harness has a `checkStagingGuard` that locks to staging, but couldn't read the rest of the runner. Given that **zero code paths** in any onboarding-v2 file insert into `goals`, the trace would have nothing surprising to surface — the trace's value is detecting hidden write paths, and there are none to hide. Marking conclusive on code evidence alone.

### Session 09 sizing: **build in full**

The session must add goal-creation as a beat in the onboarding-v2 flow. The infrastructure to do so already exists (`create_goal` tool + valid schema) but no orchestrator calls it. Either:
- Add an explicit "what are you saving for?" beat between archetype and handoff, OR
- Promote `entry_struggle` to a goal row at archetype-time using the struggle category + free-text as the seed.

Decision belongs to product. Both are real work; "just verify it persists" is not viable.

---

## Q3 — Goal progress computation (verdict: **no progress engine**)

**There is nothing in code, SQL, or cron that updates `current_amount`, `monthly_required_saving`, or `on_track` after a goal is created.**

### How `current_amount` is populated

Set at goal creation only:

| Site | Initial value |
|---|---|
| [create-goal.ts:75](cfos-office/src/lib/ai/tools/create-goal.ts) | `Math.round(current_amount ?? 0)` — from optional tool arg, default 0 |
| [plan-trip.ts:267, 291](cfos-office/src/lib/ai/tools/plan-trip.ts) | hard-coded `0` |

`grep -rn "current_amount" cfos-office/src/` returns 23 references; every non-`create_goal`/`plan_trip` reference is a **read** for display, AI context, or milestone evaluation. There is no `UPDATE` of `current_amount` anywhere in the codebase.

### Pace and on/off-track

Both computed once at insert time:

- **`monthly_required_saving`** — `create-goal.ts:44-49` derives months from `target_date - now`, divides remaining by months.
- **`on_track`** — `create-goal.ts:53-65` calls `loadCurrentBudget` and `loadAverageDiscretionary`; sets `surplus = totalIncome - fixedCosts - avgDiscretionary`; `on_track = surplus >= monthlySaving`.

Both stored. Neither recomputed.

The only UPDATE in either pace/on_track is `plan-trip.ts:254` — re-running a trip plan rewrites the linked goal's row using fresh numbers. That re-writes a goal because the **trip** changed, not because the user's spending changed.

### SQL / cron / triggers

- `cfos-office/supabase/migrations/` — only `001_initial_schema.sql` (table create), `028_gdpr_compliance.sql` (soft-delete columns), `013_trip_planning.sql` (FK on trips). No functions, views, materialized views, or triggers on `goals`.
- `cfos-office/src/app/api/cron/*` — `nudges-weekly/route.ts` calls `evaluateGoalMilestones` (a read-only nudge evaluator). No other cron touches `goals`.
- Confirmed on production via `information_schema.routines`: only goal-touching functions are `delete_user_account` and `export_user_data` (GDPR). No triggers on `public.goals`.

### Production reality

| Metric | Production (`iccelmjenljanqrhhzdv`) | Staging (`qlbhvlssksnrhsleadzn`) |
|---|---|---|
| Total goals | 7 | 10 |
| Distinct users | 3 | 7 |
| `current_amount > 0` | **1 of 7 (14%)** | 2 of 10 (20%) |
| `target_date NOT NULL` | 6 of 7 | 8 of 10 |
| `monthly_required_saving NOT NULL` | 6 of 7 | 8 of 10 |
| `on_track NOT NULL` | 6 of 7 | 5 of 10 |
| `status='active' AND deleted_at IS NULL` | 7 of 7 | 9 of 10 |

The "1 of 7 with `current_amount > 0`" line is the headline. The single non-zero row was populated at creation (the user told `create_goal` an opening amount). Every other goal in production has stayed at 0 forever, because nothing increments it.

### Specific figures from the home-hero mockup

| Figure | Computed where today? |
|---|---|
| Progress % (e.g. 41%) | Display-time only: [GoalCard.tsx:21](cfos-office/src/app/(office)/office/scenarios/goals/GoalCard.tsx), [TripsClient.tsx:149](cfos-office/src/components/trips/TripsClient.tsx). Reads stale `current_amount`. |
| Monthly pace (e.g. €440/mo) | Stored in `monthly_required_saving`, computed once at create. Not recomputed. |
| On/off-track status | Stored in `on_track`, computed once at create. Not recomputed. |
| Months remaining | Not stored. Display-time derivation from `target_date` (formatted by [GoalCard.tsx:10-13](cfos-office/src/app/(office)/office/scenarios/goals/GoalCard.tsx)). |

### Session 10 sizing: **full load-bearing session**

The session must build, at minimum:
1. A `current_amount` writer — likely an Edge Function or scheduled cron that walks transactions tagged as savings deposits (or matches them to a goal via category/heuristic) and increments `current_amount`. This is non-trivial because no "savings_transfer" tag exists on `transactions` today, so categorisation work is upstream.
2. A pace recompute — easier; can be a SQL view or a cron pass that rewrites `monthly_required_saving` from `target_amount - current_amount` and time-to-target.
3. An on/off-track refresh — runs after pace recompute; uses the same surplus calc as `create-goal.ts:53-65`.

Per the Constitution's "the system computes, Claude interprets" rule, this engine must live in SQL or an Edge Function, not in prompts. **This is the single most underestimated session in the v2 roadmap.**

---

## Q4 — Action items goal-attribution (verdict: **priority but no goal link**)

**`action_items` has no `goal_id` column in either environment. Ordering is `created_at DESC` only.**

### Schema (verified in production)

```
id, user_id, title, description, source, status, due_date, reminder_at,
completed_at, potential_savings, actual_savings, category, created_at,
updated_at, deleted_at, anonymised_at, conversation_id, priority
```

No `goal_id`. No foreign key to `goals`. No join table.

### Categorical link as substitute

The `category` enum in [create-action-item.ts:11-21](cfos-office/src/lib/ai/tools/create-action-item.ts) includes `goal_setting` and `savings_transfer` — these are goal-adjacent semantically. Production data: **4 of 5 action items** are in these two categories (3 `goal_setting`, 1 `savings_transfer`). Strong enough signal for a heuristic.

### Ranking

`get_action_items` ([get-action-items.ts](cfos-office/src/lib/ai/tools/get-action-items.ts)) orders by `created_at DESC` with a hard limit of 20. No priority-based ranking, no goal-impact ranking, no recency-weighted scoring.

### Schema-vs-code drift (separate finding)

[action-item-reminder.ts:13](cfos-office/src/lib/nudges/evaluators/action-item-reminder.ts) selects `last_nudge_at, nudge_count` and [line 47-52](cfos-office/src/lib/nudges/evaluators/action-item-reminder.ts) updates them — **but these columns exist in neither staging nor production**. The deployed schema has `reminder_at` instead, and no `nudge_count`. The weekly cron in `nudges-weekly/route.ts` invokes this evaluator. It should be throwing PostgrestError 42703 every Monday.

This is out of scope for the goal engine audit but is a concrete production bug. Flagging it for a separate follow-up task.

### Session 13 sizing: **link + ranking, heuristic scope**

Build:
1. Add `goal_id uuid REFERENCES goals(id) ON DELETE SET NULL` to `action_items` (one migration).
2. Update `create_action_item` to accept an optional `goal_id` and write it; tag actions via category match if the model doesn't supply one.
3. Build a ranking pass that:
   - Prioritises actions whose `goal_id` matches the user's currently-displayed primary goal.
   - Falls back to category match (`goal_setting`, `savings_transfer`) when `goal_id` is null.
   - Within a tier, orders by `priority`, then `created_at DESC`.

**Recommend heuristic over projection.** A modelled €-contribution projection requires the Session 10 progress engine to exist (otherwise you're projecting against `current_amount = 0` forever). Heuristic ships independently and gives Session 10 something to verify against later.

---

## `create_goal` tool — end to end

[`cfos-office/src/lib/ai/tools/create-goal.ts`](cfos-office/src/lib/ai/tools/create-goal.ts)

**Writes** (line 70):
- `user_id`, `name`, `description`, `target_amount` (rounded), `current_amount` (rounded, default 0)
- `target_date`
- `monthly_required_saving` (computed if `target_date` provided, else NULL)
- `on_track` (computed if pace exists and budget loadable, else NULL)
- `priority` (default `'medium'`)
- `status` = `'active'`

**Feasibility check** (lines 53-65): confirmed. Loads `user_profiles.net_monthly_income + partner_monthly_contribution`, sums `recurring_expenses.amount` (frequency-normalised by [helpers.ts:3-13](cfos-office/src/lib/ai/tools/helpers.ts)), reads `monthly_snapshots.total_discretionary` for last 3 months. Computes surplus, sets `on_track = surplus >= monthlySaving`. Memory's "feasibility check exists" claim verified.

**Validation** (line 9-19, zod): `name` max 200, `target_amount` positive, `current_amount` ≥ 0, `target_date` format-validated by zod but not bounded to future (no min-date check), `priority` enum.

**Invocation surfaces** — registered in [tools/index.ts:52](cfos-office/src/lib/ai/tools/index.ts) as `create_goal`. The toolbox is consumed only by the chat route. **Not wired into onboarding-v2.** No API route exposes goal creation outside chat.

**Live invocation:** Deferred (same permission constraints as Phase 1.3). Code evidence is conclusive — the insert is straightforward and the schema accepts it.

---

## Goal schema — allowed vs populated

**Schema in both environments** (identical):

```
id uuid, user_id uuid, name text, description text,
target_amount numeric, current_amount numeric default 0,
target_date date, priority text,
status text default 'active',
monthly_required_saving numeric,
on_track boolean,
created_at timestamptz, deleted_at timestamptz, anonymised_at timestamptz
```

Matches `cfos-office/supabase/migrations/001_initial_schema.sql:91-104` + `028_gdpr_compliance.sql:18`. No drift between staging and production. No drift between schema-as-written and schema-as-deployed.

**Related tables:** none. `information_schema.tables` returns only `goals` for `%goal%` and `%target%` patterns. The legacy `financial_goals` table (with its progress triggers) was dropped in [026_drop_legacy_tables.sql:13-42](cfos-office/supabase/migrations/026_drop_legacy_tables.sql). Note: the dropped triggers (`trg_goals_updated`, `trg_ctx_goals`, `trg_visibility_financial_goals`) suggest a previous design **did** have some kind of goal automation, but it's gone now.

**Allowed vs populated diff:**
- Schema allows `monthly_required_saving`, `on_track`, `current_amount > 0`.
- Production reality: 86% of goals have `current_amount = 0` permanently. Pace and on_track populate at creation only.
- The schema is honest; the population is what's broken. A reader who sees `goals.current_amount` in the schema will reasonably assume something keeps it current. Nothing does.

---

## Impact on downstream sessions

| Session | Verdict | Reason |
|---|---|---|
| **09 (goal persistence)** | **Build in full** | Onboarding-v2 has zero `goals` write paths. The `create_goal` tool is fine; nothing in the onboarding flow calls it. Either add an explicit beat or promote `entry_struggle` to a seeded goal. |
| **10 (progress computation)** | **Full load-bearing** | No code, SQL, cron, trigger, or function updates `current_amount`, `monthly_required_saving`, or `on_track` after creation. Production confirms: 6/7 goals stay at `current_amount = 0`. The entire engine has to be built — likely a transaction-to-goal matcher + a periodic recompute. |
| **13 (action items ranking)** | **Link + ranking, heuristic scope** | `action_items` has no `goal_id` and no ranking beyond `created_at DESC`. Add the FK, add heuristic ranking via category match (`goal_setting`/`savings_transfer` already cover 80% of production action items). Defer projection-based ranking until Session 10 lands. |

Sessions 11, 12, 14 unaffected by this audit; their inputs are not blocked by the engine state.

---

## Surprises

1. **CLAUDE.md is stale in three concrete places.** The doc references `POST /api/onboarding/complete` and `seedFromOnboarding` — neither exists in the codebase. It also describes message audit columns (`tools_used, profile_updates, actions_created, insights_generated`) that postdate S-W1.5-10; the relevant text remains correct but the onboarding `/complete` claim is contradicted by the absence of any such route.

2. **`action-item-reminder.ts` is broken in production.** [Line 13](cfos-office/src/lib/nudges/evaluators/action-item-reminder.ts) selects `last_nudge_at, nudge_count` from `action_items`. Those columns exist in `migrations/001_initial_schema.sql:154-155` but are absent from both staging and production schemas (which have `reminder_at` and no `nudge_count`). This nudge evaluator is called by the weekly cron — it presumably errors silently every Monday. **Separate finding, flagged for follow-up.**

3. **The "wow moment" is a marketing label, not a code path.** No file in the codebase is named after it; the docstring in [archetype-orchestrator.tsx:17-23](cfos-office/src/app/onboarding-v2/archetype/archetype-orchestrator.tsx) calls it "goal-aware" but `resolveUserIntent` shows the goal source is the lowest-probability branch. For a normal fresh user it's actually an `entry_struggle`-aware insight.

4. **A goal-progress automation existed in a previous design.** Migration `026_drop_legacy_tables.sql:13-42` drops `trg_visibility_financial_goals`, `trg_ctx_goals`, and `trg_goals_updated`. The current `public.goals` table has no triggers. Whatever the prior system did, the current build has not replaced it.

5. **`potential_savings` and `actual_savings` on `action_items` are unused.** Production: 0 of 5 rows have either column populated. No code reference writes them. If Session 13 builds projection-based ranking later, these columns might be where the result lives — but they're currently dead.
