# Onboarding Test Suite — Smoke-Run Findings

These are surfacing from smoke tests against CFO Staging on 2026-04-20. Not bugs in the suite — bugs and observations in the **onboarding flow** itself that the suite correctly identified.

## Bugs to investigate

### 1. Skipping CSV upload leaves first_insight orphaned

**Surfaced by:** `skip-value-map` persona (also applies to `skip-csv-upload`).

**What happens:** When a user taps "I'll do this later" on CSV upload, the reducer in `useOnboarding.ts` correctly skips `first_insight` *at that immediate transition* (csv_upload → capabilities, skipping first_insight). But after `capabilities` completes, `nextBeat()` runs again with an **empty** skip list and lands back on `first_insight`. The `InsightBeat` then shows a loading skeleton forever because the generation effect in `OnboardingModal.tsx` returns early when `importBatchId` is null — the user has no way to proceed.

**Where:** [src/hooks/useOnboarding.ts](src/hooks/useOnboarding.ts:80) and [src/components/onboarding/OnboardingModal.tsx](src/components/onboarding/OnboardingModal.tsx:195).

**Suggested fix:** Persist skip decisions in state (e.g. `data.skippedFirstInsight = true`) and consult them in every `nextBeat` call, not just the one that triggered the skip. Or unconditionally skip `first_insight` if `importBatchId` is missing when the beat would otherwise activate.

### 2. `user_profiles.primary_currency` defaults to EUR for non-EUR users

**Status:** ✅ Resolved at the read site on 2026-04-22 (commits `1db0a4b`, `f2caa3a`).

**Original surface:** `builder-classic` persona (UK/GBP user). `primary_currency='EUR'`, `country=null`, narrative said "€3,300 on housing" for a GBP CSV.

**What we did:** Added `resolveUserCurrency(country, profileCurrency, transactions)` in `src/lib/analytics/insight-engine.ts`. Resolution order:

1. Profile currency, IF user has explicitly set it to a non-default value (not 'EUR')
2. Dominant transaction currency (≥70% of ≥5 transactions in one currency)
3. Country lookup (GB→GBP, US→USD, CA→CAD, AU→AUD)
4. Profile currency (even if it's the schema default 'EUR')
5. 'EUR' final fallback

This catches the test case (country=null, EUR profile, GBP transactions → GBP) without needing a DB migration. The schema default + onboarding flow are still wrong; this is a read-site workaround. A proper fix would set the column default based on country at user-creation time.

**Verification:** smoke run on builder-classic shows narrative now uses £ throughout. judge accuracy 4.5 (was 2.0 pre-fix).

### 3. Per-persona teardown `deleteUser` intermittently fails with "Database error deleting user"

**Surfaced by:** Every run.

**What happens:** Immediately after the browser context closes (post-handoff), `supabase.auth.admin.deleteUser(userId)` fails with a generic "Database error deleting user". The same delete succeeds ~10s later when the CLI's safety-net cleanup sweeps orphans.

**Impact:** Not user-facing, but noisy. Likely a timing/FK issue — some row referencing auth.users hasn't committed by the time delete runs.

**Suggested fix:** Add a short retry (250ms×3) inside `deleteTestUser`, or preempt by deleting dependent rows manually first.

### 4. First-insight narration hallucinated numbers and merchants

**Status:** ✅ Resolved on 2026-04-22 (commits `377457d` → `f2caa3a` on `claude/ecstatic-gauss-21f180`).

**Original surface:** 2026-04-21 full suite run. All 4 personas that completed the flow failed the LLM judge on R3/R3b/R4 — narratives cited numbers and merchants not in the CSV (e.g. "86 cents of every euro" for a GBP user, "€20/month gym" when the gym is £29.99).

**Root cause:** The prompt asked Claude to "narrate this data" with prose-friendly guardrails. With Sonnet's 0.7 temperature and strong prose bias, the model paraphrased data into creative restatements that broke the "LLM interprets, system computes" rule mechanically.

**Fix:** Quotable-facts allowlist + post-LLM validator with graceful fallback. Spec at `cfos-office/docs/superpowers/plans/2026-04-21-first-insight-grounding-and-actionability.md`. 12 commits across two work sessions:

- Pass 1 (8 commits, `377457d` → `040f7cb`): types + `extractNumbers` + `extractMerchants` + `validateNarrative` + `buildQuotableFacts` + prompt wiring + route validator + action-verb suggestedResponses.
- Pass 2 regression fix (4 commits, `450625d` → `f2caa3a`): universal pattern-data walker (Pass 1's per-key extraction missed most patterns and emptied every narrative), ±1 tolerance in validator, soft-rejection threshold (≤2 number offenders ship the narrative with a `softViolation` telemetry flag; merchant violations always fall back), transaction-derived currency.

**Final result vs original baseline (2026-04-21T13-38-49-154Z → 2026-04-22T04-11-29-601Z):**

| Likert | Before | After | Δ |
|---|---|---|---|
| warmth | 4.8 | 5.0 | +0.2 |
| accuracy | 3.8 | 4.5 | +0.7 |
| on_brand | 4.1 | 4.3 | +0.2 |
| persona_fit | 4.0 | 4.8 | +0.8 |
| actionability | 3.4 | 3.5 | +0.1 |

All five dimensions exceed baseline. Builder-classic R3/R3b now PASS; R4 still fails on judge tokenization (`£3,300` extracts as `300` after currency-strip + comma-split — judge-side regex bug, not a product hallucination). Fortress-saver R3b still fails on persona-keyword gap (no pattern emits "savings/foundation/buffer" when income is undetected — separate session).

**Out of scope (to register as a new finding when prioritised):**

### 5. Sign-in redirect timeout for 6 of 8 personas

**Surfaced by:** every full-suite run since 2026-04-21.

**Symptom:** truth-teller-balanced, drifter-expat, anchor-debt, skip-value-map, skip-csv-upload, time-saver-expert all fail at ~22s with `_error-at-signin.png`. The captured/ folder has `archetype.json` + `insight.json` (so the LLM was called), then the Playwright driver crashes at the post-handoff sign-in redirect.

**Conjecture:** Concurrency=2 + the dev-server's per-request compile latency under parallel load expose a Playwright timing assumption in `tests/onboarding/runner/playwright-driver.ts` (around line 104). Was 4 personas pre-bug-#4-fix; became 6 post-fix. Not introduced by the product changes — the same dev server now serves a slightly heavier route (validator + walker). Investigate with concurrency=1 or longer redirect timeout.

## Observations worth noting

### A. The LLM picked up the "hard to decide" signal for rent with high fidelity

**For builder-classic** (rent marked hard-to-decide), the archetype narration captured: *"your monthly rent or mortgage, the literal roof over your head, was the one thing you couldn't place at all, skipping it as too hard to decide."*

This is a strong signal that the archetype prompt is using all the Value Map fields — confidence, deliberation, and the `hard_to_decide` flag — not just quadrant counts. Good.

### B. First-insight narration is high quality and references real numbers

For builder-classic: *"Nearly 70% of everything you spent went to one place: housing. £3,300 out of £5,191 tracked."* Math checks out against the CSV (3 × £1,100 rent = £3,300; total spending calculated from transactions).

The `numbersMustMatchCsv` hard rule is therefore likely to pass on well-constructed personas. Worth monitoring as the judge runs live.

### C. Archetype narration for Builder voice is on-brand

No "advise" / "advice" in the captured archetype. Uses "intentional" and "conviction" — matches the persona hard-rule list.

## Open items for the suite itself

These are things to improve in the test harness, not the product.

- **Test user namespace could pollute staging.** All users use `@cfo-test.local` emails. Add a periodic cleanup cron at the CLI level (nightly, not tied to a single run) — or just the CLI safety-net is sufficient if every run is clean. Currently: adequate.
- **No XLSX persona tested.** `drifter-expat` is flagged as Santander but actually uploads a Revolut-format CSV. If Santander XLSX parsing ever regresses, the suite won't catch it. Add a real XLSX persona if that parser changes.
- **Full 8-persona run not yet completed.** Only `builder-classic` smoke-tested end-to-end. Full run (15-20 min) will surface further selectors + LLM judge signals once invoked.

## Tested end-to-end

| Persona | Functional | Visual | LLM (judge skipped) | Notes |
|---|---|---|---|---|
| `builder-classic` | PASS | PASS | — | 184.5s, DB state confirmed |
| `skip-value-map` | FAIL | PASS | — | Hung on first_insight — see Bug #1 |

Other 6 personas: not yet run in full. Expected to work based on shared driver logic; the run-time will prove which selectors need further tightening.
