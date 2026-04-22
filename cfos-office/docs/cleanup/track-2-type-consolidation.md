# Track 2 — Type consolidation

## Summary

Four HIGH-confidence consolidations were implemented, all narrowly scoped (1 file each, 0 cascading dependents). The two byte-identical archetype types (`ArchetypeData` and `ArchetypeResult`) were collapsed; a misleading deprecated alias (`analytics/insight-types.ts:ValueMapResult`) that name-collided with `value-map/types.ts:ValueMapResult` was removed; and two locally-redefined database row types in `goals/page.tsx` and `OfficeTransactionsClient.tsx` were replaced with `Database['public']['Tables'][...]['Row']` references (one via `Pick<>` projection because the page only selects a subset of columns). The widely-redefined `Transaction` type in `components/transactions/TransactionList.tsx` (and its sister `TransactionsClient`/`BatchClassifier`) was investigated but **not** touched: that whole component cluster is **orphan code** (no imports outside its own three files) and should be deleted by Track 3 rather than refactored. The `ValueMapResult` collision in `lib/onboarding/types.ts` (same identifier, different shape, same module folder as one of its consumers) was investigated but ruled MEDIUM — the analytics-layer `ValueMapResult` was actually unused externally, so removing the deprecated alias resolved the collision without touching the per-transaction `ValueMapResult` shape.

---

## HIGH-confidence findings — implemented

### 1. `ArchetypeResult` and `ArchetypeData` are byte-identical

**Files:**
- `src/lib/onboarding/types.ts:36-42` — `interface ArchetypeData { archetype_name; archetype_subtitle; traits: [string,string,string]; certainty_areas; conflict_areas }`
- `src/lib/onboarding/archetype-prompt.ts:5-11` — `interface ArchetypeResult` with **identical** field list and identical types.

Both live in the same `lib/onboarding/` folder. `ArchetypeData` is the input shape on `OnboardingData.archetypeData`; `ArchetypeResult` is the validated output of the LLM archetype generator. They describe the same wire-format payload from two consumers' perspectives.

A drift between these two would silently break the round-trip from LLM → `OnboardingData` → DB. Already happened in spirit — they're maintained as parallel definitions that just happen to match today.

**Before:**
```typescript
// archetype-prompt.ts
export interface ArchetypeResult {
  archetype_name: string
  archetype_subtitle: string
  traits: [string, string, string]
  certainty_areas: string[]
  conflict_areas: string[]
}
```

**After:**
```typescript
// archetype-prompt.ts
import type { ArchetypeData } from './types'
// Canonical shape lives in `./types` as `ArchetypeData`. Re-exported here under
// the name `ArchetypeResult` because this module historically owned the LLM
// validation contract; consumers import whichever name suits the call site.
export type ArchetypeResult = ArchetypeData
```

**Rationale:** Both names are kept (back-compat with all five existing import sites — `OnboardingModal`, `WelcomeBeat`, `profile-seeder`, `regenerate-archetype-prompt`, `generate-archetype/route`) but only one definition exists. Future schema changes go in one place. Net change: 1 file, +2 lines / -7 lines.

### 2. `ValueMapResult` deprecated alias in `analytics/insight-types.ts` removed

**Files:**
- `src/lib/analytics/insight-types.ts:11-12` — `/** @deprecated alias kept for call-site compatibility */ export type ValueMapResult = ValueMapSession`
- `src/lib/analytics/insight-types.ts:66` — `valueMap: ValueMapResult | null;` inside `DetectorContext`

Audit of all `import { ... ValueMapResult ... } from '@/lib/analytics/insight-types'` returned **zero results**. The alias's only consumer was the field type one line below in the same file. Comment claimed "kept for call-site compatibility" — no longer true.

This alias was actively misleading because there's a **completely unrelated** `ValueMapResult` in `src/lib/value-map/types.ts:17` representing per-transaction quadrant categorisation telemetry (consumed by 33 files). Two types with the same name and totally different shapes is the textbook source-of-drift bug.

**Before:**
```typescript
export type ValueMapSession = Database['public']['Tables']['value_map_sessions']['Row'];

/** @deprecated alias kept for call-site compatibility — points at value_map_sessions (archetype lives there) */
export type ValueMapResult = ValueMapSession;

// ...

export interface DetectorContext {
  // ...
  valueMap: ValueMapResult | null;
  // ...
}
```

**After:**
```typescript
export type ValueMapSession = Database['public']['Tables']['value_map_sessions']['Row'];

// ...

export interface DetectorContext {
  // ...
  valueMap: ValueMapSession | null;
  // ...
}
```

**Rationale:** Removes a confusing name-collision with `lib/value-map/types.ts:ValueMapResult`. Makes the data type at the call site (`valueMap.archetype_name`, `valueMap.merchants_by_quadrant`, `valueMap.dominant_quadrant`) match its declared name (the row from `value_map_sessions`, not the per-transaction quadrant response). Net: 1 file, -3 lines.

### 3. `Goal` row redefined in `goals/page.tsx`

**Files:**
- `src/app/(office)/office/scenarios/goals/page.tsx:5-17` — local `type Goal = { id; name; description; target_amount; current_amount; target_date; priority; status; monthly_required_saving; on_track; created_at: string }`
- Canonical row: `Database['public']['Tables']['goals']['Row']` (defined in `src/lib/supabase/types.ts:741`).

Local definition was a strict subset of the canonical row but **drifted on nullability**: `created_at: string` (non-null) vs canonical `created_at: string | null`. The page only uses `created_at` in a `.order()` call, never reads it for display, so the null-skew was invisible — but a future change that did read `goal.created_at` would inherit a wrong type.

**Before:** 13-line local `type Goal = { ... }`.

**After:**
```typescript
import type { Database } from '@/lib/supabase/types'
type Goal = Database['public']['Tables']['goals']['Row']
```

**Rationale:** All current usage (`goal.name`, `goal.description`, `goal.target_amount`, `goal.current_amount`, `goal.target_date`, `goal.priority`, `goal.status`, `goal.monthly_required_saving`, `goal.on_track`) is a strict subset of the canonical Row. No call site touches the additional fields (`user_id`, `anonymised_at`, `deleted_at`) added by the canonical type, but they're irrelevant to the rendering. Build is clean.

Net: 1 file, -10 lines.

### 4. `Transaction` row redefined in `OfficeTransactionsClient.tsx`

**Files:**
- `src/app/(office)/office/cash-flow/transactions/OfficeTransactionsClient.tsx:8-16` — local `interface Transaction { id; date; description: string; amount; currency: string; category_id; value_category: string|null }`
- Canonical row: `Database['public']['Tables']['transactions']['Row']`.

Local definition was a strict subset projection of the canonical row but **lied about three nullability contracts**:
- `description: string` → DB `description: string | null`
- `currency: string` → DB `currency: string | null` (and the field is never read; declared dead)
- `value_category: string | null` → DB `value_category: ValueCategoryEnum | null` (loses the enum specificity)

The server page (`page.tsx:29`) selects exactly seven columns. Aligning the type to a `Pick<Row, ...seven cols>` makes the projection explicit and surfaces the nullability that the DB already enforces. Surfaced one latent bug: `merchant={tx.description}` was passed to a prop typed `merchant: string`, with no null guard.

**Before:**
```typescript
interface Transaction {
  id: string
  date: string
  description: string       // ← lied
  amount: number
  currency: string          // ← lied + dead
  category_id: string | null
  value_category: string | null   // ← lost enum specificity
}
// ...
<TransactionRow merchant={tx.description} ... />
```

**After:**
```typescript
import type { Database } from '@/lib/supabase/types'
type Transaction = Pick<
  Database['public']['Tables']['transactions']['Row'],
  'id' | 'date' | 'description' | 'amount' | 'currency' | 'category_id' | 'value_category'
>
// ...
<TransactionRow merchant={tx.description ?? '—'} ... />
```

**Rationale:** `Pick<>` keeps the type as narrow as the actual `select()` columns (so adding a new column to the page's `select()` requires updating the type — good signal). Honest nullability surfaces the real DB contract. The `'—'` fallback at the call site matches the project's existing convention (see `HoldingsPreview.tsx:formatMoney` which uses the same em-dash for null money). Build is clean, all 58 tests pass.

Net: 1 file, +8 lines / -10 lines, plus +9 chars at one call site.

---

## MEDIUM-confidence findings — documented, not implemented

### M1. `Transaction` in `components/transactions/TransactionList.tsx` is in dead code

**Files:**
- `src/components/transactions/TransactionList.tsx:9-23` — local `type Transaction` adds UI-flavoured fields
- `src/components/transactions/TransactionsClient.tsx` — only consumer, **not imported by any page**
- `src/components/transactions/BatchClassifier.tsx` — also only references the local `Transaction` via `TransactionsClient`

Full grep across `src/` and `app/` for `TransactionsClient` returned only the file itself + the dead-code consumer chain. Cross-checked: the live transactions page (`src/app/(office)/office/cash-flow/transactions/page.tsx`) imports `OfficeTransactionsClient`, not `TransactionsClient`. The legacy `TransactionsClient` cluster (3 files: `TransactionsClient.tsx`, `TransactionList.tsx`, `BatchClassifier.tsx`) is orphan.

**Why MEDIUM, not HIGH:**
- The right action is **delete the dead files**, not consolidate types within them.
- Deleting orphan code is the remit of Track 3 (dead-code), not Track 2 (types).
- Touching the type to align with the canonical Row would just be wasted churn before deletion.

**Recommendation:** Track 3 should evaluate the `TransactionsClient` / `TransactionList` / `BatchClassifier` cluster (~600 lines) for deletion. If kept (e.g. someone plans to re-wire it), then a follow-up Track 2 pass should replace the local `Transaction` type with `Database['public']['Tables']['transactions']['Row']` directly — the local fields it adds (`value_confidence`, `user_confirmed`, `is_holiday_spend`, `prediction_source`, `is_recurring`, `value_confirmed_by_user`) are all already on the Row. The local definition contradicts the Row's nullability for `description`, `currency`, `user_confirmed` — same family of bugs as M3 below.

### M2. `ValueMapResult` name collision across modules (now reduced from 2× to 1× by HIGH-2)

**Files (post-fix):**
- `src/lib/value-map/types.ts:17` — `interface ValueMapResult` (per-transaction quadrant + telemetry; consumed by 33 call sites in onboarding, demo, value-map UI).

After HIGH-2 removed the deprecated `analytics/insight-types.ts` alias, this is the only `ValueMapResult` left in the codebase. It is unambiguous.

**Why this section exists:** If anyone later re-introduces a DB-row `ValueMapResult` alias, it will collide again. Worth a comment.

**Recommendation:** Add a leading comment to `lib/value-map/types.ts:ValueMapResult` clarifying it represents the per-transaction quadrant **response** (vs. the row-level `ValueMapSession` in analytics). Cosmetic; not implemented in this track to keep the file change minimal.

### M3. `TransactionList.tsx:Transaction` lies about nullability of `description`, `currency`, `user_confirmed`

Same diagnostic as M1, but worth calling out separately because it's the canonical example of why parallel type definitions are dangerous:

- DB: `description: string | null`, `currency: string | null`, `user_confirmed: boolean | null`.
- Local: `description: string`, `currency: string`, `user_confirmed: boolean`.

If these files were live, the JSX `merchant={t.description}` would be a runtime bug waiting for the first null-description transaction (e.g. an early upload pre-validation). Because the cluster is orphan today, no impact in production — but it's the same class of bug we just fixed in HIGH-4 for `OfficeTransactionsClient`.

**Recommendation:** Identical to M1's recommendation — fold into the dead-code track or, if revived, switch to canonical Row.

### M4. Inline DB-row projection types in `lib/ai/review-context.ts`

**Files:**
- `src/lib/ai/review-context.ts:6-46` — four inline interfaces (`SnapshotRow`, `GoalRow`, `ActionRow`, `RecurringRow`) that are partial projections of `monthly_snapshots`, `goals`, `action_items`, `recurring_expenses`.

Each is a strict subset of the canonical Row, used internally by the LLM-context-builder. They're **not** duplicated — they're the only definitions of these specific projections. Replacing each with `Pick<Database[..]['Row'], 'col1' | 'col2' | ...>` would buy us nullability honesty (same family as HIGH-4) but adds verbose `Pick<>` boilerplate inside an already-large file (~720 lines of context assembly).

**Why MEDIUM:** The change is mechanically safe but the file is on the brittle side (constructs the LLM prompt) and the brief explicitly limits surgical edits to `lib/ai/context-builder.ts`-class files. `review-context.ts` is the same family. Worth doing as part of a deliberate "context builder hardening" pass, not as type cleanup.

**Recommendation:** Defer to a focused pass over `review-context.ts` that also evaluates whether the four interfaces could be replaced with simpler positional `Pick<>` projections at each `select(...)` call site.

### M5. `interface TransactionHistory` in `BillDetailPanel.tsx` is a narrow inline projection

**Files:**
- `src/components/bills/BillDetailPanel.tsx:16-20` — `interface TransactionHistory { date; amount; description }`.

Hits a distinct REST endpoint (`/api/bills/[id]/transactions`) which projects exactly these three fields. Not a duplicate of the DB Row; it's the response-shape contract for that one endpoint. Switching to `Pick<>` would couple the UI component to the DB schema in a place where the API explicitly decouples them.

**Recommendation:** Leave as-is. If anything, the API-route handler should export this shape and both sides should import it from there — but that's an API conventions change, not type consolidation.

---

## LOW-confidence findings — documented, not implemented

### L1. `type Profile = Record<string, unknown>` in `ProfilePageClient.tsx`

**Files:**
- `src/components/profile/ProfilePageClient.tsx:16` — `type Profile = Record<string, unknown>`.

Intentional opaque sink — the page renders any field via the `PROFILE_QUESTIONS` registry, so the row shape is irrelevant. Replacing with the canonical `Database['public']['Tables']['profiles']['Row']` would force a `Record<string, unknown>` cast everywhere it's keyed dynamically. Net negative.

### L2. `interface SnapshotRow` etc duplicated narrowly between analytics and review-context

The analytics `monthly_snapshots` Row alias is in `insight-types.ts:7` (`MonthlySnapshot`). `review-context.ts:6-15` defines `SnapshotRow` with a 7-field projection. They're not duplicates — `MonthlySnapshot` is the full Row, `SnapshotRow` is a deliberate narrowing for LLM context. Folding `SnapshotRow = Pick<MonthlySnapshot, 'month' | 'total_income' | ...>` is plausible (covered in M4) but cross-module.

### L3. `interface GoalProgress { current_amount; target_amount }` in `TripsClient.tsx`

A 2-field projection used as a map value (`Record<string, GoalProgress>`). Not worth pulling out into a shared type — would just create a thin module for a 2-field record that exists nowhere else.

### L4. `interface ToolContext` in `lib/ai/tools/types.ts` is canonical and clean

Single definition, 4 fields, used by ~10 tool files. **No action needed.** Confirms healthy local convention.

### L5. `lib/parsers/types.ts` — already canonical for parser surface

Defines `ParsedTransaction`, `ParseResult`, `Category`, `ValueRuleMatchType`, `UserMerchantRule`, `ParsedHolding`, `RecurringMatch` — each with a single definition. No duplicates anywhere in the codebase. **No action needed.**

### L6. `lib/value-map/types.ts` — already canonical for value-map surface

Single definitions of `ValueQuadrant`, `ValueMapTransaction`, `ValueMapResult`, `MoneyPersonality`, `QuadrantDef`, `PersonalityDef`, `Observation`. After HIGH-2 removed the colliding `analytics/insight-types.ts:ValueMapResult` alias, these are unambiguous. **No action needed.**

### L7. `lib/onboarding/types.ts` — `FirstInsightResult`, `OnboardingBeat`, `BeatMessage`, `OnboardingData`, `OnboardingState`, `OnboardingAction`

After HIGH-1 deduplicated `ArchetypeData`/`ArchetypeResult`, the rest of `onboarding/types.ts` has single definitions. No collisions. **No action needed.**

---

## Verification

Run from `cfos-office/`:

| Check | Baseline (post-Track-1) | Post-Track-2 | Status |
|---|---|---|---|
| `npm run lint` | 20 errors / 38 warnings | 20 errors / 38 warnings | unchanged |
| `npm run build` | succeeds | succeeds | unchanged |
| `npm test` | 58/58 passing | 58/58 passing | unchanged |

No lint regression, no new TS errors, no test failures.

Notable: HIGH-4 added a real null-guard at one call site (`merchant={tx.description ?? '—'}`) that the build would have caught if it was a regression. This is the value-add of switching from a parallel type definition to the canonical Row — TypeScript now enforces a contract that the DB has always enforced.

## Files touched

- `src/lib/onboarding/archetype-prompt.ts` — replaced 7-line `interface ArchetypeResult` with `type ArchetypeResult = ArchetypeData` (re-export).
- `src/lib/analytics/insight-types.ts` — removed `@deprecated` `ValueMapResult` alias, switched `DetectorContext.valueMap` field type to `ValueMapSession`.
- `src/app/(office)/office/scenarios/goals/page.tsx` — replaced 13-line local `type Goal` with `Database['public']['Tables']['goals']['Row']`.
- `src/app/(office)/office/cash-flow/transactions/OfficeTransactionsClient.tsx` — replaced 9-line local `interface Transaction` with a `Pick<>` of the canonical Row, added `?? '—'` guard at `merchant={tx.description}`.

4 files, no commits, staged in working tree.

## Out-of-scope (not touched)

- `lib/supabase/types.ts` — generated; never edit manually.
- Cron `nudges-{daily,weekly,monthly}` routes — DEFERRED.md.
- TODO(session-14) markers in `lib/ai/tools/{upsert-asset,upsert-liability,get-balance-sheet}.ts` — TECH_DEBT.md #30.
- Demo / value-map flow — product-critical.
- `lib/ai/context-builder.ts`, `app/api/chat/route.ts`, `app/api/upload/route.ts` — large files, surgical only; no type consolidations were narrow enough to apply here.
- `components/transactions/TransactionsClient.tsx`, `TransactionList.tsx`, `BatchClassifier.tsx` — orphan cluster; deletion is Track 3's job (see M1, M3).
