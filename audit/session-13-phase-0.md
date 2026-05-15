# Session 13 — Phase 0 ground truth

**Date:** 2026-05-15
**Branch:** `claude/action-items-goal-ranking-E5VkH`
**Purpose:** Confirm the audit's findings on `action_items` schema, `create_action_item` / `get_action_items` contracts, and the `action-item-reminder.ts` bug — and pin down the primary-goal mechanism this session's ranking will hang off — before writing the migration and code.

---

## 0.1 — `action_items` schema (production verified)

Queried `iccelmjenljanqrhhzdv` (production) and `qlbhvlssksnrhsleadzn` (staging) via Supabase MCP. **Schemas are identical between the two environments.**

```
id              uuid       NOT NULL DEFAULT gen_random_uuid()
user_id         uuid       NOT NULL
title           text       NOT NULL
description     text       NULL
source          text       NULL DEFAULT 'ai'
status          text       NULL DEFAULT 'pending'
due_date        date       NULL
reminder_at     timestamptz NULL
completed_at    timestamptz NULL
potential_savings numeric  NULL
actual_savings  numeric    NULL
category        text       NULL
created_at      timestamptz NULL DEFAULT now()
updated_at      timestamptz NULL DEFAULT now()
deleted_at      timestamptz NULL
anonymised_at   timestamptz NULL
conversation_id uuid       NULL
priority        text       NULL DEFAULT 'medium'
```

Audit findings confirmed:
- **No `goal_id`.** No foreign key to `goals`. No join table.
- **Has `priority`** (TEXT, default `'medium'`) — unused in current ranking.
- **Has `category`** (TEXT) — written but not used for ranking.
- **Has `reminder_at`** (timestamptz) — present in schema, **not read or written anywhere in `cfos-office/src/`** (only the generated `supabase/types.ts` references it).
- **Does NOT have `last_nudge_at`.** Does NOT have `nudge_count`.

Production data shape (5 rows, all distinct categories):
| category | priority | count |
|---|---|---|
| `goal_setting` | `high` | 3 |
| `savings_transfer` | `medium` | 1 |
| `research` | `medium` | 1 |

`goal_setting` + `savings_transfer` cover **4 of 5** rows — strong signal for the category-match heuristic.

---

## 0.2 — Tool contracts

### `create-action-item.ts` ([create-action-item.ts:1-76](../cfos-office/src/lib/ai/tools/create-action-item.ts))

Inputs (zod):
- `title` — string, max 200
- `description?` — string, max 500
- `category` — enum: `bill_switch | savings_transfer | investment | admin | research | spending_change | goal_setting`
- `priority?` — enum: `high | medium | low`
- `due_date?` — string (YYYY-MM-DD)

Writes (line 39–52):
```
user_id, conversation_id, title, description, category,
priority (default 'medium'), due_date, status='pending'
```

No `goal_id` write today. The `category` enum already includes both goal-adjacent categories (`goal_setting`, `savings_transfer`) — the audit's heuristic foundation.

### `get-action-items.ts` ([get-action-items.ts:1-61](../cfos-office/src/lib/ai/tools/get-action-items.ts))

Inputs:
- `status?` — `pending | in_progress | completed | all` (default returns `pending + in_progress`)
- `limit?` — number, default 10, max 20

Query (line 22–34):
```
SELECT id, title, description, category, status, due_date, created_at
FROM action_items
WHERE user_id = $userId
[AND status filter]
ORDER BY created_at DESC
LIMIT min(limit ?? 10, 20)
```

Confirmed: **ordering is `created_at DESC` only.** `priority` is selected nowhere. No goal-impact ranking.

---

## 0.3 — The adjacent bug in `action-item-reminder.ts` (intent + fix direction)

[`action-item-reminder.ts`](../cfos-office/src/lib/nudges/evaluators/action-item-reminder.ts) — called by [`/api/cron/nudges-weekly`](../cfos-office/src/app/api/cron/nudges-weekly/route.ts) every Monday.

### Confirmed bug

- Line 13: `SELECT id, title, created_at, last_nudge_at, nudge_count`
- Line 17: `.or('last_nudge_at.is.null,last_nudge_at.lte....')`
- Line 22, 26: reads `action.nudge_count`, `action.last_nudge_at`
- Lines 47–52: `UPDATE action_items SET last_nudge_at=..., nudge_count=...`

Neither column exists in either environment. The weekly cron's invocation is wrapped in `Promise.allSettled` ([nudges-weekly/route.ts:29](../cfos-office/src/app/api/cron/nudges-weekly/route.ts)) so the cron itself doesn't crash, but **the evaluator throws PostgrestError 42703 every Monday and produces zero `action_item_reminder` nudges.**

### Intent

The evaluator wants to:
1. Find pending action items older than 7 days (`created_at <= now - 7d`).
2. Implement a per-item exponential backoff for re-nudges (7 → 14 → 21 → 28 days, capped at 28).
3. Skip items still inside their backoff window.
4. Otherwise create a `action_item_reminder` nudge tagged with `scope_key: action:<id>`.
5. Track per-item `last_nudge_at` and `nudge_count` to drive the backoff.

### The dedup already exists in the nudges layer

`createNudge` ([`create.ts:21`](../cfos-office/src/lib/nudges/create.ts)) calls `canSendNudge` ([`cooldown.ts:1-54`](../cfos-office/src/lib/nudges/cooldown.ts)) before inserting. Per-scope cooldown is enforced by querying the `nudges` table for prior rows with matching `type` + `scope_key` inside `cooldown_hours`. For `action_item_reminder` the rule ([`rules.ts:100-112`](../cfos-office/src/lib/nudges/rules.ts)) is:

- `cooldown_hours: 168` (7 days, per scope)
- `max_per_month: 4` (across all action items of this user/type)

So: **the 7-day per-item gap is already enforced by `canSendNudge`** querying the `nudges` table. The `nudges` table is the source of truth for "have we nudged this item recently". The `last_nudge_at` / `nudge_count` columns on `action_items` would be a redundant local cache.

### Fix direction

The clean path is to **drop the local tracking entirely and rely on `canSendNudge`** — no migration, no missing-column add. The trade-off is the exponential backoff (7 → 14 → 21 → 28) collapses to a flat 7-day cooldown + `max_per_month: 4`. Effective per-item behaviour:
- Week 1: nudge created.
- Week 2: cooldown matches scope-key on `nudges`, skip.
- ...
- After 7 days from last nudge: nudge created. Same again.

So a still-pending item gets at most 4 nudges per month, at least 7 days apart — close enough to the original intent that the divergence is not behavioural regression.

If exponential backoff is judged load-bearing, we'd need to add the columns via migration. Phase 4 chooses the no-migration path because (a) `canSendNudge` already gives us the right shape of behaviour, (b) adding redundant columns to fund a microoptimisation the product hasn't asked for is the wrong direction, and (c) flat cadence + monthly cap is what the rule definition already declares.

`reminder_at` is preserved — it's still part of the schema and unused, but this session does not assign it new semantics; the column stays available for a future "user-scheduled reminder time" feature.

---

## 0.4 — Primary-goal mechanism

Session 11 centralised the primary-goal signal in [`cfos-office/src/lib/goals/primary-goal.ts`](../cfos-office/src/lib/goals/primary-goal.ts):

```ts
export async function getPrimaryGoal(
  supabase: SupabaseClient,
  userId: string,
): Promise<PrimaryGoal | null>
```

Selection rule (lines 41–62):
1. Filter to `user_id = userId AND status = 'active' AND deleted_at IS NULL`.
2. Sort by priority rank (`high=0, medium=1, low=2, null/unknown=3`), then `created_at DESC`.
3. Return the first row; `null` if no active goals.

Session 12 imports this same helper for CFO prompt context ([`SESSION-LOG.md` entry](../cfos-office/SESSION-LOG.md)) — there is a single source of truth for "which goal is the user's current focus".

**Session 13 uses `getPrimaryGoal` for tier-1 ranking.** No new helper, no duplication of the priority-rank logic.

---

## 0.5 — Audit confirmation summary

| Audit claim | Confirmed | Notes |
|---|---|---|
| `action_items` has no `goal_id` in either env | ✓ | Both environments verified via `information_schema.columns`. |
| `action_items` has `priority` (unused in ranking) | ✓ | Default `'medium'`; not read by `get-action-items.ts`. |
| `get_action_items` orders by `created_at DESC` only | ✓ | [get-action-items.ts:26](../cfos-office/src/lib/ai/tools/get-action-items.ts). |
| Limit hardcoded to `min(limit ?? 10, 20)` | ✓ | [get-action-items.ts:20](../cfos-office/src/lib/ai/tools/get-action-items.ts). |
| `goal_setting`+`savings_transfer` cover 80% of prod action items | ✓ | 4 of 5 rows; matches audit's count. |
| `create-action-item.ts` accepts those two categories | ✓ | [create-action-item.ts:11-21](../cfos-office/src/lib/ai/tools/create-action-item.ts). |
| `action-item-reminder.ts` selects nonexistent columns | ✓ | `last_nudge_at`, `nudge_count` — neither in either env schema. |
| `reminder_at` exists but is unused by app code | ✓ | Only `cfos-office/src/lib/supabase/types.ts` references it. |
| Weekly cron invokes the broken evaluator | ✓ | [nudges-weekly/route.ts:29](../cfos-office/src/app/api/cron/nudges-weekly/route.ts) via `Promise.allSettled`. |
| `getPrimaryGoal` exists and centralises primary-goal selection | ✓ | [primary-goal.ts:41](../cfos-office/src/lib/goals/primary-goal.ts), used by Sessions 11 and 12. |
