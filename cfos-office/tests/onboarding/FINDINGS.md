# Onboarding Test Suite — Smoke-Run Findings

These are surfacing from smoke tests against CFO Staging on 2026-04-20. Not bugs in the suite — bugs and observations in the **onboarding flow** itself that the suite correctly identified.

## Bugs to investigate

### 1. Skipping CSV upload leaves first_insight orphaned

**Surfaced by:** `skip-value-map` persona (also applies to `skip-csv-upload`).

**What happens:** When a user taps "I'll do this later" on CSV upload, the reducer in `useOnboarding.ts` correctly skips `first_insight` *at that immediate transition* (csv_upload → capabilities, skipping first_insight). But after `capabilities` completes, `nextBeat()` runs again with an **empty** skip list and lands back on `first_insight`. The `InsightBeat` then shows a loading skeleton forever because the generation effect in `OnboardingModal.tsx` returns early when `importBatchId` is null — the user has no way to proceed.

**Where:** [src/hooks/useOnboarding.ts](src/hooks/useOnboarding.ts:80) and [src/components/onboarding/OnboardingModal.tsx](src/components/onboarding/OnboardingModal.tsx:195).

**Suggested fix:** Persist skip decisions in state (e.g. `data.skippedFirstInsight = true`) and consult them in every `nextBeat` call, not just the one that triggered the skip. Or unconditionally skip `first_insight` if `importBatchId` is missing when the beat would otherwise activate.

### 2. `user_profiles.primary_currency` defaults to EUR for non-EUR users

**Surfaced by:** `builder-classic` persona (UK/GBP user).

**What happens:** After onboarding, a UK user's `primary_currency` is `EUR` in the DB. Country and city are `null`. The onboarding flow never asks about currency, so the default column value carries through.

**Where:** `user_profiles` table — check the default column value. Compare with intended behaviour: the CFO chat flow collects currency/country via `request_structured_input` after handoff, but first_insight narration (below) already rendered financial figures with `€` symbols for a GBP CSV.

**Impact:** The first insight reported "€3,300 a month on housing" for a user whose CSV is entirely in GBP. User-visible.

### 3. Per-persona teardown `deleteUser` intermittently fails with "Database error deleting user"

**Surfaced by:** Every run.

**What happens:** Immediately after the browser context closes (post-handoff), `supabase.auth.admin.deleteUser(userId)` fails with a generic "Database error deleting user". The same delete succeeds ~10s later when the CLI's safety-net cleanup sweeps orphans.

**Impact:** Not user-facing, but noisy. Likely a timing/FK issue — some row referencing auth.users hasn't committed by the time delete runs.

**Suggested fix:** Add a short retry (250ms×3) inside `deleteTestUser`, or preempt by deleting dependent rows manually first.

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
