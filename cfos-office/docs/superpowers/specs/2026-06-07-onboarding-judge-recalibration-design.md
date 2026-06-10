# Onboarding Judge Recalibration + Real-Bug Fixes — Design

**Date:** 2026-06-07
**Branch:** `fix/validator-note-leak`
**Status:** Design (awaiting review → writing-plans)
**Target version:** folds into the current test-hardening work (no version bump on its own)

---

## 1. Context

The value-first onboarding e2e suite (`cfos-office/tests/onboarding/`) ran 10 personas against
Staging on 2026-06-06 (`test-output/2026-06-06T19-35-51-656Z/`). Headline result:

- **Functional 8/10** (sofia-chaotic, zane-spain fail)
- **Visual 10/10**
- **LLM judge hard-rules 0/10**
- **Likert** warmth 4.7 · accuracy 3.7 · on-brand 4.3 · persona-fit 3.6 · actionability 4.6

The prevailing interpretation was "judge rules are stale, the Reads are good, just make it green."
Reading the **actual captured Reads + per-rule failures** disproves that. The truth:

> The judge has real false-fails **and** it correctly surfaced two genuine defects.
> "Greening the judge" naïvely would ship a live €-for-£ currency bug. The single biggest
> judge failure (H1 failing all 10) was not in the original action list.

This spec fixes the judge's false-fails, fixes the two real defects it caught, broadens goal
coverage (per product owner: goals are core and must be tested with variance), and makes the
whole judge **calibratable offline** so we never again need a 15-minute Staging run to learn a
rule is mis-tuned.

---

## 2. Ground-truth diagnosis

All evidence below is from the captured run, not inference.

### A. Judge false-fails (fix the judge — these are NOT Read defects)

1. **`H1_signoff_present` fails all 10 — the judge grades the wrong string.**
   Every Read ends correctly with `…[CTA:…][/CTA]\n\n— C.`. But
   [`judge.ts:180`](../../tests/onboarding/runner/judge.ts) does
   `JSON.stringify(cfoOutput)` on the **message wrapper object**
   `{ conversationType, content, messageId }` returned by
   [`playwright-driver.ts:447`](../../tests/onboarding/runner/playwright-driver.ts), not on
   the Read content string. So the end-anchored signoff regex (and `H5`'s last-sentence check)
   run against `…"}` with backslash-escaped `\n`. **Dominant cause; one fix at the judge
   boundary clears H1 + H5 for all 10.**

2. **`R4_numbers_match_csv` has four distinct tokenizer/structural bugs.**
   [`extractNumbers`](../../tests/onboarding/runner/judge.ts) (`/-?\d+(?:\.\d+)?/g`) produces
   false positives:
   - Thousands-comma fragmentation: `€5,191` → `5` + `191`; `€3,300` → `300`.
   - Year tokens: `2026`, `2025`.
   - Percentages: `70` (from "70%").
   - Counts / day-windows: `21 transactions`, `90 days`.
   - **Structural:** the Read quotes *computed* facts absent from the CSV — builder's
     "fixed costs of €1,717/month, leaving €1,283/month in free cash flow." Neither is a CSV
     transaction (they come from the essentials form + `reconcileFixedCosts`). A perfect
     tokenizer still flags them. R4's premise ("every quoted number is a raw CSV amount") is
     **false** for the value-first format.

3. **`R3` / `R3b` calibrated to the retired first-insight format.** They expect curated exact
   merchants/keywords; the value-first Read leads with categories/clusters and the top merchant
   by spend (often rent), not the curated subset.

### B. Real defects the judge correctly surfaced (fix the product/harness — do NOT mask)

4. **The Read renders `€` for everyone → wrong for all 8 GBP personas.** Confirmed: all 10
   Reads use `€`, zero `£`. (The `£` seen in some judge *reasons* is the LLM judge mentally
   converting — not the Read.) Root cause:
   [`compose-first-read.ts:318`](../../src/lib/ai/compose-first-read.ts) sets
   `currency = primary_currency || 'EUR'` with **no** country/transaction fallback, and nothing
   in onboarding-v2 *or* the test driver sets `primary_currency`, so it defaults to EUR. The two
   EUR personas (drifter, zane) pass by luck. The robust
   [`resolveUserCurrency(country, profileCurrency, transactions)`](../../src/lib/analytics/insight-engine.ts)
   (built for exactly this in the Bug #2 fix) is **not used** here. `financialFacts.currency` is
   the *single* currency source feeding income, rent, FCF, the spending picture, clusters, and
   the goal ([`compose-first-read.ts:113`](../../src/lib/ai/compose-first-read.ts)), so one fix
   corrects every number.
   The LLM judge only docked this when magnitudes were *also* wrong (builder=2, time-saver=1,
   tom=1) and passed it on fortress/truth-teller/drifter — i.e. it is an **unreliable** catch,
   which is precisely why a deterministic currency rule earns its place.

5. **Personas feed an income that contradicts their own CSV.** Personas set no
   `monthlyIncome`/`monthlyRent`, so the driver types the default `3000`
   ([`playwright-driver.ts:314`](../../tests/onboarding/runner/playwright-driver.ts)) into the
   essentials form. That becomes `net_monthly_income`, which the Read states verbatim: time-saver
   "net income of €3,000" (real ≈ £6,200/mo), tom "€3,000" (real ≈ £4,200/mo) → accuracy=1,
   persona_fit=2. Harness realism, not Read quality.

> **Therefore accuracy=3.7 is explained, not noise.** It is defects #4 + #5 dragging down
> builder/time-saver/tom. Fix those → accuracy ≈ 4.7.

### C. Structural

6. [`persona-runner.ts:126`](../../tests/onboarding/runner/persona-runner.ts) makes **any** of
   ~12 mixed-importance hard rules → `llm=fail` (all-or-nothing). Decision: keep flat (see §3),
   so every rule must be sound and false-positive-free.

### D. Coverage gaps found while diagnosing

7. **Zero personas seed a goal.** The harness supports `expectations.goal` (driver inserts it
   pre-upload) but no persona uses it, so goal-awareness, goal-denial, and the goal-pace line are
   **untested**. (Resolved by §6.)
8. **`H8_cites_known_merchant`** (shared `read-judge.ts` rule) over-fires on low-transaction
   personas: aiko legitimately writes category-level ("your landlord… housing… groceries").
9. **Value-first CTA detection is dead + contradicts the docs.**
   [`judge.ts:203`](../../tests/onboarding/runner/judge.ts) keys `isValueFirst` on
   `[CTA:start_value_map_real]`, which **no** Read emits (they use `supply_input` / `set_goal`).
   So mode is always `default` and `H3b` never runs. CLAUDE.md/onboarding docs say the first Read
   closes on `start_value_map_real`; the product does not. (Flagged, §9.)
10. **Teardown leaves `llm_usage_log` orphans** (FK `llm_usage_log_user_id_fkey`, `user_id`) —
    not in [`user-factory.ts`](../../tests/onboarding/runner/user-factory.ts) tear-down list.

---

## 3. Decisions (resolved with product owner)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Scope of real bugs | **Fix both layers** | Fix product currency robustness *and* harness realism; the suite then guards the real bug end-to-end. |
| D2 | Judge gate architecture | **Flat, recalibrate everything** | Keep `any-failure → fail`; make every rule sound. No tiering. |
| D3 | R4 redesign | **Minimal R4** | Currency-anchored + comma-aware; flag only when a money token matches nothing plausible AND exceeds total spending. Self-contained in `csv-summariser`; no categoriser coupling. |
| D4 | Goal coverage | **8 of 10 personas seed goals, with variance** | Goals are core; test goal-aware Reads (8) and the goal-prompt path (2). |
| D5 | CTA / H3b | **Recalibrate to real CTA vocabulary + flag doc drift** | Accept `{supply_input, set_goal, start_value_map_real}`; retire the brittle detection. Doc-vs-product reconciliation flagged separately, non-blocking. |
| D6 | Merchant-citation (aiko/H8) | **Gate on transaction count, threshold 20** | Don't weaken the shared prod rule; in the test, only require merchant citation when `transactionCount ≥ 20`. |

---

## 4. The offline golden corpus (verification backbone)

The highest-leverage piece. Freeze captured Reads as fixtures and unit-test every deterministic
rule against expected verdicts — turning judge calibration into fast `npm run test` (CI) unit
tests, and permanently encoding "expected verdict per rule" so future edits can't silently
regress. It also directly answers the "eyeball accuracy before trusting the suite" concern: the
corpus *is* the locked-in eyeballing.

**Two phases** (goal-aware £ Reads don't exist yet — no persona had a goal in the captured run):

- **Phase 1 (now, from the 2026-06-06 run):**
  - **Negative fixtures** = the captured `€` GBP Reads → must FAIL the new currency rule (R5).
  - **Positive fixtures** = the same Reads transformed `€`→`£` for GBP personas → must PASS R5
    and all structural/tokenizer rules. EUR personas' Reads used as-is (positive).
  - Synthetic bad Reads: hallucinated big money, missing signoff, `[OPTIONS]` block,
    question-close, emoji, `(System note:` leak, goal-denial-with-goal.
  - Calibrates: object-unwrap (H1/H5), Minimal R4 tokenizer, R5 currency, R3/R3b vocabulary,
    structural H-rules, bans.
- **Phase 2 (after product+harness+goal fixes land, from a fresh Staging run):**
  - Capture the new `£`, goal-aware Reads as the **authoritative positive corpus**.
  - Finalise goal-reference calibration + promote it from soft to hard if reliable.

Fixture location: `cfos-office/tests/onboarding/fixtures/reads/` (raw Read strings) +
`cfos-office/tests/onboarding/unit/judge.test.ts` (new). The corpus stores the **content
string**, mirroring the post-unwrap judge input.

---

## 5. Workstreams

### WS-A — Judge correctness (`tests/onboarding/runner/judge.ts`, `read-judge` wiring)

- **A1. Unwrap the message object.** Judge the Read **content string**. Derive
  `content = typeof cfoOutput === 'string' ? cfoOutput : (cfoOutput?.content ?? JSON.stringify(cfoOutput))`
  and feed it to both the deterministic rules and the LLM prompt. Clears H1 + H5 for all 10.
- **A2. Minimal R4** (D3). Replace `extractNumbers` + `checkNumbersMatchCsv` with a
  currency-anchored extractor:
  - Match tokens of the form `(£|€|$)\s?\d[\d,]*(?:\.\d+)?`; strip thousands commas before
    `Number()`. Bare ints (years, %, counts) are ignored — not currency-anchored.
  - `plausible = {txn amounts} ∪ {per-merchant subtotals} ∪ {incomeTotal, spendingTotal}` (all
    already on `CsvSummary`), tolerance `±max(1, value*0.01)`.
  - **Violation iff** token ∉ plausible **AND** token > `spendingTotal`. (Egregious-only.)
- **A3. R3 / R3b recalibration** (D2 flat ⇒ must be false-positive-free):
  - R3 (`mustReferenceMerchantsFromCsv`): align to the **top-merchant-by-spend** universe the
    Read reliably names; only enforce when `transactionCount ≥ 20` (D6).
  - R3b (`mustReferenceOneOf`): replace old-format keywords with value-first vocabulary
    actually present (dominant category names, "fixed costs", "free cash flow",
    "snapshot/baseline", cluster words). Calibrate against the corpus.
  - **Gotcha:** `csv-summariser` keys merchants off the **raw** CSV description, but the Read
    cites the **normalised** merchant (e.g. CSV "Rent - Landlord Property Ltd" → Read
    "Rent Landlord"). A naïve substring match will false-fail. Normalise both sides (reuse the
    product's `normaliseMerchantDescription`) or match on a stable token; the corpus test will
    expose any mismatch.
- **A4. New R5 — currency-symbol matches persona.** Deterministic, persona-specific (lives in
  `judge.ts`, NOT shared `read-judge.ts`): expected symbol from `persona.profile.currency`
  (GBP→£, EUR→€, USD→$). FAIL if a foreign symbol appears, or if the expected symbol never
  appears when the Read quotes money. This is the reliable €-bug guard.
- **A5. Merchant-citation threshold (D6).** In `judge.ts`, pass `knownMerchants` into
  `checkReadHardRules` only when `transactionCount ≥ 20`, so `H8` does not run for
  low-transaction personas (aiko). **Shared `read-judge.ts` is unchanged** (prod wow-cron
  unaffected).
- **A6. CTA recalibration (D5).** Retire the `start_value_map_real`-only `isValueFirst`
  detection. Add a rule that the single CTA type ∈ `{supply_input, set_goal, start_value_map_real}`.
- **A7. Shared bans.** Add a `(System note:` banned pattern (belt-and-braces with the existing
  `assertNoValidatorNoteLeak` DB invariant) and a **goal-denial** banned-pattern set
  (`/no (active )?goal/i`, `/don'?t have (a|any) goal/i`, `/without a goal/i`) **applied only to
  personas that seed a goal** (the 2 goal-less personas must remain free to prompt "set a goal").

### WS-B — Real fixes (D1: product + harness)

- **B1. Product currency robustness.** In
  [`getFinancialFacts`](../../src/lib/ai/compose-first-read.ts) (~L264–328): add `country` to the
  `user_profiles` select, query `transactions.currency` for the user (lightweight), and set
  `currency: resolveUserCurrency(country, primary_currency, txnRows)`
  ([`insight-engine.ts:43`](../../src/lib/analytics/insight-engine.ts)). Fixes every number in
  the Read at once and real currency-unset users.
  - **Verify:** that the CSV importer persists `transactions.currency` (the dominant-transaction
    signal depends on it). If not, the country path still resolves GB→GBP — hence B2 sets country.
- **B2. Harness realism** (`tests/onboarding/personas/*.ts`, `playwright-driver.ts`):
  - Set realistic `monthlyIncome` / `monthlyRent` on every persona, aligned to its CSV
    (critical: time-saver ≈ £6,200, tom ≈ £4,200). The driver already types these into the
    essentials form ([`fillEssentials`](../../tests/onboarding/runner/playwright-driver.ts)).
  - Driver writes `country` (and optionally `primary_currency`) to `user_profiles` to mirror a
    real onboarded user, so `resolveUserCurrency` resolves deterministically and the suite
    **exercises** the B1 fix end-to-end (revert B1 → suite goes red).

### WS-C — Functional + hygiene

- **C1. `onboarding_completed_at` race.** In the driver's `first_read` stage, after the Read
  message arrives, poll `user_profiles.onboarding_completed_at` (or
  `onboarding_step='first_read_delivered'`) until set, with a ~30s timeout, then proceed (on
  timeout proceed anyway so a genuine regression still fails the assertion with the real signal).
  Fixes sofia + zane → functional 10/10.
- **C2. Teardown orphans.** Add `llm_usage_log` (FK `user_id`) to `USER_DATA_TABLES_BY_USER_ID`
  in [`user-factory.ts`](../../tests/onboarding/runner/user-factory.ts) before
  `auth.admin.deleteUser`.

### WS-D — Goal coverage (D4) — see §6

### WS-E — Verify & ship

- Phase-1 corpus unit tests green; `npm run typecheck`, `npm run lint`, `npm run knip`,
  `npm run test` green.
- Fresh Staging judged run → 10/10 functional + judge; capture Phase-2 corpus; finalise
  goal-reference calibration; re-run to confirm.
- Push `fix/validator-note-leak`; open PR.

---

## 6. Goals: 8 of 10 personas, with variance

**Hard constraint:** `goals.type` is CHECK-constrained to
`{debt_clearance, savings, investment, general}`
([`052_experiment_engine.sql:135`](../../supabase/migrations/052_experiment_engine.sql)). The
driver inserts directly into `goals`
([`playwright-driver.ts:275`](../../tests/onboarding/runner/playwright-driver.ts)), so any other
`type` fails the constraint and crashes the run. Variance lives in the 4 valid types +
name/target/current/timeframe/currency. Narrow the persona type `goal.type?: string` →
`'debt_clearance' | 'savings' | 'investment' | 'general'` so an invalid value is a compile error.

**Split:** 8 with goals; **fortress-saver + aiko-low-transaction stay goal-less on purpose** —
their Reads are the canonical "no goal yet → here's why one matters" path, which is also core
onboarding behaviour and must remain tested.

| Persona | `type` | name | target | current | timeframe | notes |
|---|---|---|---|---|---|---|
| builder-classic | `investment` | Grow ISA pot | £40,000 | £12,000 | 2028 | matches archetype |
| time-saver-expert | `investment` | Max the ISA | £20,000 | £8,898 | this year | near target |
| tom-long-history | `investment` | Pension top-up | £50,000 | £9,000 | open | long horizon |
| truth-teller-balanced | `savings` | 6-month safety net | £15,000 | £3,000 | 2027 | classic |
| sofia-chaotic | `savings` | 3-month runway | £9,600 | £2,000 | open | irregular income |
| zane-spain | `savings` | Entrada para piso | €30,000 | €5,000 | 2029 | EUR, purchase-flavour |
| anchor-debt | `debt_clearance` | Clear credit card | £8,000 | £1,500 | 2027 | debt variance |
| drifter-expat | `general` | Move-home fund | €6,000 | €1,200 | open | EUR, general |

Covers all four types (investment ×3, savings ×3, debt_clearance ×1, general ×1), both
currencies, near/far progress, fixed/open timeframes.

**Checks unlocked:**
- DB: goal row persisted for the 8, absent for the 2.
- Hard rule: **goal-denial ban** (WS-A7) applied to the 8; the 2 exempt.
- **Goal-reference** (soft now → promote to hard after Phase-2 capture): Read references goal by
  name or target.
- Exercises the **goal-pace** income-blur line (processing screen) for 8 personas — currently
  unexercised.

---

## 7. Sequencing

1. **WS-A1** (unwrap) + **WS-C** (race, teardown) — fast, unlocks functional 10/10 + clears the
   dominant judge bug.
2. **WS-A2/A3/A4/A5/A6/A7** + **Phase-1 corpus** (`unit/judge.test.ts`) — calibrate every
   deterministic rule offline against fixtures.
3. **WS-B** (product currency + harness realism) + **WS-D** (goals).
4. **WS-E** — Staging judged run → Phase-2 corpus → finalise goal-reference → re-run green → PR.

---

## 8. Verification

- Unit/corpus + CI gates: `npm run typecheck` · `npm run lint` · `npm run knip` ·
  `npm run test` (full — scoped vitest misses the `tests/` tree; `npx vitest` is broken, use the
  local bin).
- e2e judged suite: the onboarding CLI (`tests/onboarding/runner/cli.ts`; exact npm script in
  `package.json`) against Staging (`qlbhvlssksnrhsleadzn`), without `--skip-judge`.
- Acceptance: functional 10/10; judge hard-rules 10/10; Likert accuracy ≳ 4.5; corpus unit tests
  encode each rule's expected verdict.

---

## 9. Flagged (non-blocking, needs product owner confirmation)

- **CTA contract drift.** CLAUDE.md / onboarding docs say the value-first first Read closes on
  `[CTA:start_value_map_real]`; the product emits `supply_input` / `set_goal`. Either the Value
  Map hook CTA regressed (product bug) or the doc is stale. WS-A6 makes the judge accept the real
  vocabulary; the doc-vs-product reconciliation is separate.

---

## 10. Out of scope

- No tiering of the judge gate (D2 = flat).
- No rewrite of the LLM Likert prompt (it is working; it caught the real bugs).
- No DB migration (goal seeding uses existing columns; `transactions.currency` assumed present —
  verify, don't migrate, in B1).
- The `start_value_map_real` product decision (flagged §9), pending owner input.
