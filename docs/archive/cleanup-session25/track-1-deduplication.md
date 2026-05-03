# Track 1 — Deduplication

## Summary

Three HIGH-confidence duplications were found and removed: `toMonthlyEquivalent` was redefined locally in `calculate-monthly-budget.ts` despite already being exported from `helpers.ts` (the sister file `calculate-emergency-fund.ts` imports it correctly); `formatCurrency`/symbol-table inside `lib/value-map/feedback.ts` was a byte-for-byte clone of `formatAmount`/`currencySymbol` already exported from `lib/value-map/format.ts`; and `app/(office)/layout.tsx` had local copies of `formatDate` and `getGreeting` whose bodies are identical to the existing `formatHeaderDate` and `getGreeting` in `lib/utils.ts`. All other suspected clusters (the three currency-formatter "families", the signed-amount transaction formatters, the API-route auth check, the `loadCurrentBudget` vs `calculateMonthlyBudget` overlap) turned out either to be intentional behavioural variants or to require structural change exceeding HIGH confidence — they are documented below as recommendations rather than implemented.

---

## HIGH-confidence findings — implemented

### 1. `toMonthlyEquivalent` duplicated in two adjacent tool files

**Files:**
- `src/lib/ai/tools/helpers.ts:3` — canonical exported `toMonthlyEquivalent`.
- `src/lib/ai/tools/calculate-monthly-budget.ts:4-14` — local copy with identical body.
- `src/lib/ai/tools/calculate-emergency-fund.ts:3` — already imports from `helpers.ts` (proves the canonical pattern).

**Before:**
```typescript
// calculate-monthly-budget.ts
import { z } from 'zod';
import type { ToolContext } from './types';

function toMonthlyEquivalent(amount: number, frequency: string): number {
  switch (frequency) {
    case 'monthly': return amount;
    case 'bimonthly':
    case 'bi-monthly': return amount / 2;
    case 'quarterly': return amount / 3;
    case 'annual':
    case 'yearly': return amount / 12;
    default: return amount;
  }
}
```

**After:**
```typescript
import { z } from 'zod';
import type { ToolContext } from './types';
import { toMonthlyEquivalent } from './helpers';
```

**Rationale:** Identical body, identical call sites, sister file already imports it. Zero risk; removes 12 lines of duplication. Diverging the two by accident (e.g. adding a `weekly` case to one) would silently produce inconsistent budget vs. emergency-fund numbers — a category of bug worth eliminating.

### 2. `formatCurrency` duplicated inside `value-map/feedback.ts`

**Files:**
- `src/lib/value-map/format.ts:7` — canonical `formatAmount(amount, currency)`.
- `src/lib/value-map/format.ts:3` — canonical `currencySymbol(currency)`.
- `src/lib/value-map/feedback.ts:303-311` — local `formatCurrency` byte-for-byte identical to `formatAmount`; same module folder.

**Before:**
```typescript
// feedback.ts
function formatCurrency(amount: number, currency: string): string {
  const symbols: Record<string, string> = {
    GBP: '\u00A3',
    USD: '$',
    EUR: '\u20AC',
  }
  const symbol = symbols[currency] ?? currency + ' '
  return `${symbol}${amount.toLocaleString('en', { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`
}

function resolveFeedback(template: string, ctx: FeedbackContext): string {
  // ...
  const formatted = formatCurrency(ctx.amount, ctx.currency)
  const annualised = formatCurrency(ctx.amount * 12, ctx.currency)
  return template
    .replace(/{merchant}/g, merchantDisplay)
    .replace(/{amount}/g, ctx.amount.toLocaleString('en', { ... }))
    .replace(/{currency}/g, ({ GBP: '\u00A3', USD: '$', EUR: '\u20AC' }[ctx.currency] ?? ctx.currency + ' '))
    .replace(/{formatted}/g, formatted)
    .replace(/{annualised}/g, annualised)
}
```

**After:**
```typescript
import { formatAmount, currencySymbol } from './format'

function resolveFeedback(template: string, ctx: FeedbackContext): string {
  // ...
  const formatted = formatAmount(ctx.amount, ctx.currency)
  const annualised = formatAmount(ctx.amount * 12, ctx.currency)
  return template
    .replace(/{merchant}/g, merchantDisplay)
    .replace(/{amount}/g, ctx.amount.toLocaleString('en', { ... }))
    .replace(/{currency}/g, currencySymbol(ctx.currency))
    .replace(/{formatted}/g, formatted)
    .replace(/{annualised}/g, annualised)
}
```

**Rationale:** Same directory, same intent (variable-fraction-digit value-map UI strings), bodies are character-identical. The inline currency-symbol map (line 324) was a third duplicate of the same lookup — collapsed via `currencySymbol()`. Removes ~13 lines.

### 3. `formatDate` and `getGreeting` duplicated in `app/(office)/layout.tsx`

**Files:**
- `src/lib/utils.ts:8` — canonical `getGreeting()`.
- `src/lib/utils.ts:15-21` — canonical `formatHeaderDate()`.
- `src/app/(office)/layout.tsx:32-45` — local `formatDate(Date)` and `getGreeting()`.

**Before:**
```typescript
// (office)/layout.tsx
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Morning'
  if (h < 18) return 'Afternoon'
  return 'Evening'
}

// ...
<span>{formatDate(new Date())}</span>
```

**After:**
```typescript
import { formatHeaderDate, getGreeting } from '@/lib/utils'

// ...
<span>{formatHeaderDate()}</span>
```

**Rationale:**
- `getGreeting`: identical body in both places. No-arg, no behaviour difference.
- The local `formatDate(Date)` accepted a `Date` parameter, but the only call site passes `new Date()`. `formatHeaderDate()` already calls `new Date()` internally and uses the exact same `toLocaleDateString` options (`weekday: 'short', day: 'numeric', month: 'short'`). Behaviour-preserving substitution.
- Removes ~17 lines from the layout file.

---

## MEDIUM-confidence findings — documented, not implemented

### M1. Three "currency formatter" families with different intents

**Files:**
- `src/lib/constants/dashboard.ts:60` — `formatCurrency(amount, currency='EUR')` → 2dp, `Math.abs`, `'en-GB'` locale. Used by every dashboard / balance-sheet card.
- `src/lib/analytics/pattern-detectors.ts:24` — `formatCurrency(amount, currency)` → `Math.round` to integer, default locale, no `Math.abs`. Re-exported and consumed by `insight-engine.ts` only. Used inside narrative prompts shipped to Claude.
- `src/lib/value-map/format.ts:7` — `formatAmount(amount, currency)` → variable digits (0 if integer, 2 otherwise), `'en'` locale. Used by value-map UI.
- `src/components/onboarding/beats/ExperimentCard.tsx:10` — `formatCurrencyBand(low, high, currency)` → range output `"€10–€20"`, `low.toLocaleString()` (default locale, default digits).
- `src/components/upload/HoldingsPreview.tsx:78,86` — local `currencySymbol(code)` + `formatMoney(n, currency)` returning `'—'` for null, `'en-GB'` locale, max 2 dp.

**Why MEDIUM, not HIGH:** These look similar but have distinct, deliberately different behaviours that touch user-visible output and LLM prompts:
- `dashboard.formatCurrency` always shows 2dp because it's beneath summary cards where ragged amounts read as bugs.
- `pattern-detectors.formatCurrency` rounds to integer because narrative prompts (e.g. "spending up €1,200 month-over-month") look junky with cents.
- `format.formatAmount` shows 0 dp for whole numbers because value-map sample transactions are designed to look natural.
- `ExperimentCard.formatCurrencyBand` shapes a range and uses default toLocaleString for the band format.
- `HoldingsPreview.formatMoney` has a null-handling contract.

A naïve consolidation (e.g. one `formatCurrency` with a `digits` option) would blur the contracts and let a future change to one consumer accidentally affect five others — the opposite of what this track is meant to achieve. The duplication is mostly the 4-line currency-symbol switch (`EUR → €`, etc.).

**Recommendation:** Extract just the 5-line `currencySymbol(code)` helper into one shared location (`src/lib/format/currency-symbol.ts` or extend `lib/value-map/format.ts`) and import it from each file, but keep each `formatCurrency`/`formatAmount`/`formatMoney`/`formatCurrencyBand` distinct. Lower priority; deliberate consolidation in a follow-up pass would also need to update tests, prompt snapshots, and a brief design check on the rendered output.

### M2. Signed-amount transaction formatters duplicated 3× in client components

**Files:**
- `src/components/transactions/TransactionList.tsx:34-40`
- `src/components/transactions/UncategorisedQueue.tsx:22-27`
- `src/components/upload/TransactionPreview.tsx:19-25`

All three define `formatAmount(amount, currency)` with the same body: prepend `+`/`-` sign + currency symbol + abs amount with 2 fraction digits in `'en-GB'` locale. (`UncategorisedQueue` skips assigning to a `sign` variable but emits the same string.)

**Why MEDIUM:** The three are character-identical (modulo the sign-variable styling) and they serve the same intent (signed transaction display). The reason this is MEDIUM rather than HIGH:
- All three are `'use client'` components and sit in the same `components/transactions/` + `components/upload/` neighbourhood.
- There is no existing shared module for client-side transaction formatters; consolidating creates a new file.
- The existing `lib/value-map/format.ts:formatAmount` does not include the sign and uses `'en'` locale instead of `'en-GB'` — these are the value-map-specific shape, not the transaction-list shape, so they cannot be merged.

**Recommendation:** Add a `formatSignedAmount(amount, currency)` to either `lib/utils.ts` or a new `lib/format/transactions.ts` and have all three components import it. ~12 lines saved across three files. A single behavioural change (e.g. switching `+` to a thin space for positive amounts) currently has to be made in three places.

### M3. Auth-check pattern in ~49 API routes

Per the task brief: the prior survey identified `const { data: { user } } = await supabase.auth.getUser(); if (!user) return new Response('Unauthorized', { status: 401 })` as a repeated idiom across `/api/*`. This is **explicitly out-of-scope for HIGH-confidence implementation** and remains a documented MEDIUM recommendation.

**Why MEDIUM:** The pattern is small, idiomatic to App Router, and easy to read. Wrapping it in a helper (`requireUser(req)`) marginally reduces lines but adds an indirection layer through which every reviewer needs to mentally pass when reading a route. The win is real (consistent error shape, single place to add logging) but small enough that it should be done deliberately as part of a route-level refactor pass rather than as cleanup.

**Recommendation:** Consider as part of a future "API conventions" pass; not now.

### M4. `loadCurrentBudget` vs `createCalculateMonthlyBudgetTool` overlap

**Files:**
- `src/lib/ai/tools/helpers.ts:15-49` — `loadCurrentBudget(ctx)` returns `{ netIncome, partnerContribution, fixedCosts, monthlyRent, grossSalary }`.
- `src/lib/ai/tools/calculate-monthly-budget.ts:16-119` — full tool that reads the same profile fields, the same recurring expenses, computes `totalIncome`, `discretionary`, then enriches with last-3-months actual discretionary spend and returns a tool-shaped object.

**Why MEDIUM:** They share an income+fixed-costs-load step, but `calculate-monthly-budget` is explicitly a Claude tool (returns `{ error, field, message, suggestion }` shapes for the LLM, includes per-item breakdown capped at 15 entries for token budget, fetches an extra 3-month transaction window to compute surplus/deficit). `loadCurrentBudget` is a primitive that nudge rules and a couple of background helpers consume. Refactoring `calculate-monthly-budget` to call `loadCurrentBudget` is plausible — it would deduplicate the profile + recurring read — but the tool also returns the per-item breakdown that the helper currently throws away, so the helper would need to return richer shape, OR the tool would need a second query, OR we accept some duplication of intent.

**Recommendation:** A targeted refactor where `loadCurrentBudget` returns the raw recurring rows and `calculate-monthly-budget` derives the per-item breakdown locally would be clean, but it's structural and crosses tool / nudge boundaries. Defer to the chat/tools refactor session.

### M5. Multiple fire-and-forget `.catch(() => {})` patterns

Around 15 call sites use the pattern `someAsync().catch(() => {})` to swallow errors on background writes (snapshots refresh, analytics tagging, telemetry). They are scattered across `app/api/*/route.ts`, `components/chat/*`, `hooks/useOnboarding.ts`, and a few others.

**Why MEDIUM:** A `fireAndForget(promise, label)` helper would centralise the pattern and let us add a single `console.warn` line with the label so silently swallowed errors at least leave a trace. Worth doing, but each call site has slightly different error semantics (some legitimately don't care, some are masking bugs). A pass-through helper risks normalising "swallow all errors" as a sanctioned pattern, which is not what we want.

**Recommendation:** Audit each call site individually — some should `console.warn`, some should retry, some should bubble. Track separately as TECH_DEBT rather than as a deduplication.

---

## LOW-confidence findings — documented, not implemented

### L1. `formatMonth` duplicated across three files

- `src/lib/constants/dashboard.ts:65` — `formatMonth(dateStr)` accepts `'YYYY-MM'` or full ISO date, returns `'October 2025'`.
- `src/lib/ai/review-context.ts:57` — `formatMonth(month)` accepts only `'YYYY-MM'`, returns `'October 2025'`.

**Why LOW:** Bodies are small (3 lines), inputs differ (the dashboard one tolerates `'YYYY-MM-DD'` by appending `-01` if length is 7; the review one is strict). The review-context one is a private helper inside an LLM-context-builder file. Consolidating saves perhaps 8 lines across the codebase, but creates a cross-module coupling between the LLM prompt-builder and the dashboard constants. Risk: any change to the dashboard formatter (e.g. localisation or short-month variant) cascades into prompt context. Not worth it.

### L2. `formatDate` duplicated in `lib/value-map/format.ts`, `lib/ai/tools/get-value-review-queue.ts`, `app/(office)/office/scenarios/goals/page.tsx`

Three different shapes:
- `format.ts:formatDate` → `'2 Apr'` (day + short month).
- `get-value-review-queue.ts:formatDate` → `'Wed 2 Apr, 14:30'` (weekday + day + month + time).
- `scenarios/goals/page.tsx:formatDate` → `'Apr 2026'` (month + year).

**Why LOW:** Despite the shared name, the three render different things for different contexts (transaction list, LLM tool output for scheduled reviews, goal target dates). Naming collision, not behaviour duplication. Renaming might be clearer (e.g. `formatTransactionDate`, `formatReviewTimestamp`, `formatTargetMonth`) but is bikeshedding.

### L3. Supabase client helpers — confirmed clean

- `src/lib/supabase/client.ts` — browser client, anon key.
- `src/lib/supabase/server.ts` — server client (App Router), uses cookies, anon key.
- `src/lib/supabase/service.ts` — service-role client.

Three files, three distinct responsibilities, ~20 lines total. No duplication. Confirms the prior survey's note: this area is already cleanly separated. **No action.**

### L4. `currencySymbol` defined twice (value-map/format.ts and HoldingsPreview.tsx)

`value-map/format.ts:3` exports a 2-line `currencySymbol`; `components/upload/HoldingsPreview.tsx:78` defines a 6-line local one with `up = code.toUpperCase()` normalisation. The second is more defensive. Saves ~5 lines if consolidated, but `HoldingsPreview` is in the file-upload path which is on the brittle side; touching it for a 5-line saving isn't worth a regression. **Defer to M1's extraction of a shared symbol helper.**

### L5. `normaliseMerchant` is exported from two analytics files

- `src/lib/analytics/pattern-detectors.ts:16` — exported.
- `src/lib/categorisation/normalise-merchant.ts` — separate module with the categorisation-grade normaliser.

These are intentionally different (the categorisation one strips legal entity suffixes, branch codes, etc; the analytics one is a lighter normaliser for merchant clustering). **Confirmed not duplication.**

---

## Verification

Run from `cfos-office/`:

| Check | Baseline | Post-track-1 | Status |
|---|---|---|---|
| `npm run lint` | 20 errors / 38 warnings | 20 errors / 38 warnings | unchanged |
| `npm run build` | succeeds | succeeds | unchanged |
| `npm test` | 58/58 passing | 58/58 passing | unchanged |

No lint regression, no new build errors, no test failures. Changes are entirely additive in terms of import statements; deletions are of unused local definitions whose behaviour is byte-identical to imported alternatives.

## Files touched

- `src/lib/ai/tools/calculate-monthly-budget.ts` — removed local `toMonthlyEquivalent`, imported from `./helpers`.
- `src/lib/value-map/feedback.ts` — removed local `formatCurrency`, imported `formatAmount` + `currencySymbol` from `./format`.
- `src/app/(office)/layout.tsx` — removed local `formatDate` + `getGreeting`, imported `formatHeaderDate` + `getGreeting` from `@/lib/utils`.
