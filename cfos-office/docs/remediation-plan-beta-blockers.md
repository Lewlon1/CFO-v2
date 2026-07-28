# Remediation plan — beta-blocking defects from the dorcas/lewis observability review

Source: staging review of `dorcas1234@tester.com` and `lewis@tester1234.com`
(2026-07-06). Both users received false financial statements from C. Every
false figure traced to server-side computation defects, not LLM hallucination
— Rule 2 worked as designed and faithfully amplified wrong inputs.

Severity key: **P0 = blocks the next beta round** (false information reaches
users, or EU residency breach). P1 = ship in the same window if possible.
P2 = schedule after.

All DB work targets staging (`qlbhvlssksnrhsleadzn`), additive-only. Any
schema change ships with a `prod-backfill-*` companion marked do-not-apply.

---

## Issue 1 (P0) — False "funded at plan / spare cash" figures

**Symptom.** dorcas: told "$2,867/mo spare, plan already funded" (reality:
over budget). lewis: told "€1,497/mo to spare, even the 4% stress case is
covered" (reality: ~€317/mo short of plan on observed spending; stress case
short €132/mo even on declared figures). Both times the CTA seeded the next
question with the false number.

**Root cause.** `computeCurrentSurplus` (`src/lib/analytics/levers.ts:254`)
= income − fixedCosts − avgDiscretionary, where:

- `loadCurrentBudget` (`src/lib/ai/tools/helpers.ts:15`) sums fixed costs
  from `recurring_expenses` only — no rent, no `user_declared_fixed_costs`,
  no `status` filter (dismissed rows counted). dorcas: $0. lewis: €445
  (subscription noise incl. duplicates) vs the true €1,492.
- `loadAverageDiscretionary` (`helpers.ts:51`) selects
  `monthly_snapshots.total_discretionary`, **a column that does not exist**.
  The 42703 error is never checked → returns null → coerced to 0. Fails
  silently for every user on every call.
- The accelerate gate falls back to a live surplus-vs-required comparison
  whenever `goals.on_track` is null (it was null for both users).

The Read composer's own facts (`getFinancialFacts` + `reconcileFixedCosts`)
were correct in the same prompt — two disagreeing sources of truth for the
same facts (Rule 8 violation), and the prompt instructed the model to lead
with the lever's figure.

**Fix.**

1. **One financial-position module.** Extract a shared
   `src/lib/finance/financial-position.ts` exposing
   `getFinancialPosition(supabase, userId)` → `{ income, incomeProvenance,
   fixedCostsMonthly (reconciled: rent + declared bills + confirmed
   recurring, deduped), avgObservedSpendMonthly, avgDiscretionaryMonthly,
   freeCash, observedSurplus, basis: 'observed' | 'modelled' }`. Implement it
   on top of the already-correct `reconcileFixedCosts` +
   `getFinancialFacts` logic (move, don't duplicate). Every consumer —
   `deriveLevers`, `compose-first-read`, `calculate_monthly_budget`,
   `get_spending_summary`-adjacent tools — reads from it. Delete the
   fixed-cost arithmetic from `loadCurrentBudget` (keep it only as a thin
   wrapper if chat tools need its shape).
2. **Fix discretionary.** Add `monthly_snapshots.total_discretionary`
   (additive migration, staging) and populate it in the snapshot writer
   (`src/lib/analytics/monthly-snapshot.ts`) as total_spending minus
   fixed-cost-categorised transactions; backfill existing staging rows.
   `loadAverageDiscretionary` must check and log the Supabase error — a
   missing column must never silently become "the user spends nothing".
   (Alternative if the migration is unwanted: derive from
   `total_spending − observed fixed portion` at read time. Decide once;
   do not leave two definitions.)
3. **Tighten the accelerate gate.** Emit the accelerate lever only when
   (a) surplus comes from the unified module, (b) surplus ≥ required, and
   (c) `basis === 'observed'` OR the Read explicitly frames the verdict as
   modelled. Never claim "stress case covered" off a modelled basis.
4. **Compose-time consistency assertion.** Before building the prompt,
   assert the lever's `surplusOverRequired` reconciles with
   FINANCIAL FACTS (`|surplusOverRequired − (freeCash − monthlyRequired)| ≤
   rounding tolerance`). On mismatch: drop the lever, log an error with both
   values, compose without it. The system must refuse to hand the model two
   contradictory numbers for the same fact.
5. **Regression tests.** Fixtures reproducing both users: (a) empty
   `recurring_expenses` + declared bills + rent (dorcas), (b)
   subscription-only recurring incl. dismissed + case-duplicates (lewis).
   Assert no accelerate lever fires and surplus matches the reconciled
   position. Unit-test the consistency assertion.

**Files:** `levers.ts`, `helpers.ts`, `compose-first-read.ts`,
`monthly-snapshot.ts`, new `financial-position.ts`, one staging migration +
`prod-backfill-*` companion, tests.

---

## Issue 2 (P0) — Multi-file upload batch killed in the chat upgrade surface

**Symptom.** dorcas uploaded 3 statements via the declared-Read upgrade CTA;
only file 1 (Feb, 72 txns) imported. Files 2–3 died with no error, no event,
no durable record. Every downstream Read then computed off one month.
lewis's identical 3-file batch via the *onboarding* beat imported fully —
confirming the wizard is sound and the kill is host-specific.

**Root cause.** `UploadWizard.onImported` fires per file, before
`advanceOrFinish` starts the next one. `UpgradeUploadSurface`
(`src/components/chat/UpgradeUploadSurface.tsx:171`) treats the first
`onImported` as batch completion: it flips to the `composing` phase, which
unmounts the wizard mid-batch.

**Fix.**

1. Key the upgrade compose off **`onDone`** (batch completion), not
   `onImported`. The wizard already calls `onDone` for single-file
   autoImport and for multi-file autoImport when all files succeed.
2. Cover the partial-failure path: `batch_done` state must surface a
   continue affordance that fires `onDone` so the upgrade still runs on
   whatever landed (with the thin-data decline already in place).
3. Telemetry: emit `upload_batch_completed` `{ files_attempted,
   files_succeeded, files_failed, transactions_imported }` from
   `advanceOrFinish`, and write one `import_attempts` row per file
   server-side (the table exists and is empty — only the PDF route writes
   to it today).
4. E2E test: 3-file batch through the upgrade surface asserts 3 import
   batches exist before the upgrade POST fires.

**Files:** `UpgradeUploadSurface.tsx`, `UploadWizard.tsx`,
`InSheetStatementUpload.tsx` (prop docs), `/api/upload` (import_attempts
write), tests.

---

## Issue 3 (P0) — Non-EU Bedrock inference profile (Rule 5 breach)

**Symptom.** Every `first_read_compose` for both users ran on
`global.anthropic.claude-sonnet-4-6`. Code defaults are all `eu.`
(`provider.ts`), so a staging env var (`BEDROCK_COMPOSE_MODEL` or
`BEDROCK_CLAUDE_MODEL`) overrides to the global profile.

**Fix.**

1. Correct the Vercel staging env var to the `eu.` profile (manual, Lewis).
2. Add a guard in `provider.ts`: any resolved Bedrock model ID that does not
   start with `eu.` throws at first use in production/staging builds (allow
   override only via an explicit `ALLOW_NON_EU_BEDROCK=1` escape hatch for
   local dev). A unit test locks the rule.
3. Log the **resolved** model ID everywhere (see Issue 6) so a regression is
   visible in `llm_usage_log` immediately.

---

## Issue 4 (P1) — Recurring detector writes case-duplicate rows; dismissed rows still counted

**Symptom (lewis).** `claude.ai`/`Claude.ai`, `vercel`/`Vercel`,
`supabase`/`Supabase` — pairs with identical amounts, created across
successive import batches → ~€178/mo phantom fixed cost. User-dismissed
rows (Cabify, Avolta) still summed into budget math.

**Fix.**

1. Normalise the merchant key (reuse `normaliseMerchantDescription`) before
   insert in the recurring detector; upsert on
   `(user_id, normalised_name, frequency)` instead of blind insert.
2. Staging migration: dedupe existing rows, then add a unique index on the
   normalised key (additive + backfill; `prod-backfill-*` companion).
3. Every consumer of `recurring_expenses` filters
   `status in ('detected','confirmed')` — dismissed means dismissed.
   (Largely subsumed by Issue 1's unified module, but fix the chat tools'
   `loadCurrentBudget` regardless.)

---

## Issue 5 (P1) — Income never observed, never flagged

**Symptom (lewis).** 301 transactions over ~4 months contain zero income
deposits (`total_income = 0` in every snapshot, `t3m_income_monthly = 0`),
yet `income_provenance` stayed `'unknown'` and the Read stated
"Free cash flow is €1,308 a month" as fact, unhedged.

**Fix.** After each import/snapshot rebuild, set
`income_provenance = 'declared_unverified'` when declared income exists and
no income transactions were observed in the covered window. Verify the
`value_first` prompt path actually renders the declared-income hedge (the
machinery exists; the hedge did not appear in lewis's Read). Add a test:
declared income + zero observed income ⇒ hedge line present.

---

## Issue 6 (P1) — Observability gaps that hid all of the above

1. **Hardcoded model IDs in chat logs** — `api/chat/route.ts:281` and
   `:839` log the literal `'claude-sonnet-4-6'` regardless of the model
   used. Log the resolved `chatModelId`.
2. **Multi-step token undercount** — a turn with tool calls logged
   `completion_tokens: 2` for a ~150-word message. Sum step usage in the
   `onFinish` backfill.
3. **Unchecked Supabase errors** — audit `.select()` call sites for
   ignored `error` returns (the `total_discretionary` failure was invisible
   for its entire life). Minimum bar: log with call-site tag.
4. **`import_attempts` wired for CSV** (covered in Issue 2.3).

---

## Issue 7 (P1) — Chat turns do their own arithmetic when no tool covers the question

**Symptom (dorcas).** The "correction" turn misexplained where $2,867 came
from (its explanation was itself arithmetically impossible), and the
"February vs the debt goal" answer derived "$2,900 target" / "$833 short"
by mixing frames — subtracting all-inclusive `total_spending` from the
post-fixed-costs budget (double-counting fixed costs). The snapshot's own
numbers say February had a $967.50 surplus.

**Fix.**

1. **New tool `compare_month_to_goal`** (or extend `compute_goal_pace`):
   server-computed month-vs-goal reconciliation — income, fixed costs,
   spending split into fixed-portion vs discretionary, goal requirement,
   verdict (`covered | short_by_X`), all from the Issue-1 module. The model
   frames; it never assembles the comparison.
2. **Wire numeric validation into chat + recompose output.**
   `insight-validator.ts` already has `extractNumbers` /
   `buildCitationAllowlist` / `validateCitations`; neither the chat
   post-stream path nor `recompose-first-read` uses them for figures. On a
   number outside the allowlist (tool results + prompt facts): forced retry
   (the chat route already has a forced-retry mechanism), then strip/flag.
   Note honestly: this catches *derived* numbers; it cannot catch a wrong
   number the server handed in (that is Issue 1's consistency assertion).
3. When a prompt's instructions change, re-derive its few-shot examples in
   the same edit (Rule 7).

---

## Issue 8 (P2) — Copy/framing repairs

- `declared_upgrade` claimed "the fixed costs landed exactly where you
  declared them — no gap there" when the "actual" side was derived from the
  declared bills themselves (circular). Only claim confirmation when the
  actual side comes from observed transactions; otherwise say the statements
  don't contradict the declared bills, or omit.
- Goal-chat opener invented "by July 2026" from "20K" then self-corrected
  mid-message (dorcas). Covered partially by Issue 7.2; otherwise polish.

---

## Sequencing

**Phase 1 — launch blockers (do first, in this order):**
1. Issue 3 env fix (minutes) + provider guard.
2. Issue 1 (the financial-position module is the keystone; Issues 4.3 and
   7.1 build on it).
3. Issue 2.

**Phase 2 — same window if capacity allows:** Issues 4, 5, 6, 7.
**Phase 3 — post-launch:** Issue 8, the broader unchecked-error audit.

**Verification before opening the beta (staging, end-to-end):**
- Re-run the dorcas scenario: declared path → chat-upgrade CTA → 3-file
  upload. Assert 3 import batches, Read cites 3-month coverage, no
  accelerate lever unless the unified surplus truly covers the goal.
- Re-run the lewis scenario: onboarding 3-file upload, investment goal.
  Assert the Read's spare-cash figure equals freeCash − required, stress
  verdict matches observed basis, hedge present when income unobserved.
- `select distinct model from llm_usage_log where created_at > <deploy>` —
  every row `eu.`-prefixed.
- `npm run typecheck && npm run build` green; append lessons to
  SESSION-LOG.md.

---

## Model guidance for implementation

Sonnet 5 is the right default for nearly all of this — the fixes above are
pinned to specific files and behaviours, and the design decisions are made
in this document. Suitable for Sonnet 5 end-to-end: Issues 2, 3, 4, 5, 6, 8,
and the mechanical parts of 1 and 7 (migrations, gate changes, tests,
logging).

Use a stronger model (Opus-class) for three pieces, or have one review
Sonnet's output before merge:

1. **Issue 1.1–1.2, the financial-position module** — cross-cutting
   refactor with many consumers and Rule 8 stakes; the failure mode of
   getting it subtly wrong is exactly the class of bug being fixed.
2. **Issue 1.4 consistency assertion semantics** — deciding tolerance,
   fallback behaviour, and what "same fact" means across modelled vs
   observed bases.
3. **Issue 7.2 prompt/validator changes** — touching Read prompts means
   re-deriving few-shot examples in C.'s voice (Rule 7); voice work and
   validator-retry interaction benefit from the stronger model.

A good split: implement with Sonnet 5 using this plan as the spec, then a
single Opus-class review pass over the Issue 1 + Issue 7 diffs before merge.
