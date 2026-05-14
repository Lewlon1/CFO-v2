# Session 09 — Phase 0 ground truth

**Date:** 2026-05-14
**Branch:** `feature/goal-persistence-onboarding`
**Purpose:** Pin down the load-bearing facts about the onboarding-v2 flow and the `create_goal` write contract before wiring goal creation into onboarding. Inherited as context by Sessions 10 (progress engine) and 12 (Constitution v1.3 fold-in).

---

## The bifurcation at the struggle picker

[`actions.ts:43-44`](../cfos-office/src/app/onboarding-v2/actions.ts) routes users by `entry_struggle`:

- `dont_know` → Marcus path: `/onboarding-v2/value-map` → `upload` → `archetype` → wow-moment → `/office`
- everything else (`debt | wealth | planning | free_text`) → straight to `/office?chat=open` with a canned opener

**Both paths missed goal creation entirely** before Session 09. The audit's "zero `goals` write paths" finding applies to both. Session 09 inserts a goal-derive-and-confirm beat that runs for both — universally, immediately after the struggle picker, before either downstream path resumes.

## New sequence per path

**Marcus (`dont_know`):**
1. Struggle picker (`/onboarding-v2`)
2. **NEW:** goal-derive-and-confirm chat (in `/office` chat sheet, `onboarding_step='goal_chat_started'`)
3. Value-map (`/onboarding-v2/value-map`)
4. Upload (`/onboarding-v2/upload`)
5. Archetype reveal (`/onboarding-v2/archetype`)
6. Wow-moment (POST `/api/insights/post-upload`) → first_insight conversation in `/office`

By the time `resolveUserIntent()` fires at [`insight-engine.ts:97`](../cfos-office/src/lib/analytics/insight-engine.ts), the goal exists in `goals`. The wow moment becomes goal-aware (the misnomer the audit flagged is now true).

**Chat path (other struggles):**
1. Struggle picker (`/onboarding-v2`)
2. **NEW:** goal-derive-and-confirm chat (in `/office` chat sheet)
3. Same chat continues into normal /office usage; `onboarding_completed_at` stamped on goal creation.

The CHAT_OPENERS canned strings ([was at `lib/onboarding-v2/openers.ts`](../cfos-office/src/lib/onboarding-v2/openers.ts)) are deleted — the auto-trigger registered for `type='onboarding_goal_chat'` in [`ChatProvider.tsx`](../cfos-office/src/components/chat/ChatProvider.tsx) is the new opener mechanism.

## `entry_struggle` capture

- Schema: [`migration 040_onboarding_v2_struggle.sql`](../cfos-office/supabase/migrations/040_onboarding_v2_struggle.sql) declares `entry_struggle` as TEXT (no enum constraint) with valid values `dont_know | debt | wealth | planning | free_text`.
- Free-text content lives in a separate column `entry_struggle_text` (TEXT), populated only when `entry_struggle = 'free_text'`.
- UI: [`struggle-question.tsx`](../cfos-office/src/components/onboarding-v2/struggle-question.tsx) — four preset buttons + a 2-row textarea. User provides ONE: a button OR free-text. No character limit on the free-text.
- The CFO derive-and-confirm prompt layer ([`buildGoalDeriveConfirmContext()` in `context-builder.ts`](../cfos-office/src/lib/ai/context-builder.ts)) renders both fields into the system prompt so the model has the user's exact words to draft from.

## Statement balance is NOT available at this beat

The derive-and-confirm runs BEFORE upload (for Marcus) and never reaches upload (for chat path). So the upload pipeline isn't a source of `current_amount` here.

What this means in practice: the CFO must ASK the user for their starting amount as part of the conversation. This is the universal seeding pattern, baked into the prompt layer:

> "You do not yet have access to the user's statements at this point — they have not been uploaded. To seed the starting amount, you must ask. For a debt-clearing goal: 'what's on the card today?'. For a savings goal: 'what have you put away so far?'. The user's answer is the starting point."

For reference: the CSV parser ([`universal-csv.ts:70`](../cfos-office/src/lib/parsers/universal-csv.ts)) does extract a per-transaction `balance` field when the source has a balance column, and the PDF/screenshot balance-sheet flow ([`balance-sheet-import.ts`](../cfos-office/src/lib/upload/balance-sheet-import.ts)) writes typed `outstanding_balance` / `current_value` to `liabilities` / `assets` / `investment_holdings`. Neither flow is triggered before the goal beat. Future sessions could pre-seed from these sources if the goal beat moves later in the journey.

## `create_goal` write contract

[`cfos-office/src/lib/ai/tools/create-goal.ts`](../cfos-office/src/lib/ai/tools/create-goal.ts):

- Inserts to `goals` with: `user_id`, `name`, `description`, `target_amount` (rounded), `current_amount` (rounded, default 0), `target_date`, `monthly_required_saving` (computed from `(target_amount - current_amount) / monthsLeft` when target_date is provided), `on_track` (computed from budget surplus vs `monthly_required_saving`), `priority` (default 'medium'), `status='active'`.
- Feasibility check loads `user_profiles.net_monthly_income + partner_monthly_contribution`, sums `recurring_expenses.amount` (frequency-normalised), reads `monthly_snapshots.total_discretionary` for last 3 months. For onboarding-time goals, `monthly_snapshots` is empty and `net_monthly_income` may be null — `on_track` will land NULL. That's expected and Session 10's progress engine will recompute it.
- **Validation gap closed in Session 09:** `target_date` is now refined to require a future date. Previously a past date silently set `monthsLeft ≤ 0`, leaving `monthly_required_saving` and `on_track` NULL.

## `onboarding_step` schema notes

- Column: TEXT, no enum ([`migration 041_onboarding_v2_marcus_and_bridge.sql:10`](../cfos-office/supabase/migrations/041_onboarding_v2_marcus_and_bridge.sql)).
- New values added in Session 09: `goal_chat_started`, `goal_set`, `goal_skipped`. Code-only change to [`OnboardingStep` type](../cfos-office/src/lib/onboarding-v2/types.ts) — no migration needed.
- `conversations.type` is similarly TEXT default 'general' ([`001_initial_schema.sql:39`](../cfos-office/supabase/migrations/001_initial_schema.sql)) — new type `onboarding_goal_chat` is a code-only change.
