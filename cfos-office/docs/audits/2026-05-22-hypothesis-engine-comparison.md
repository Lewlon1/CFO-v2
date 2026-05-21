# Hypothesis Engine — Comparison Audit (Session v2.3.3)

**Date:** 2026-05-22
**Branch:** `claude/gifted-tharp-ea43e7` (atop `session-28/onboarding-tweaks-batch-1`)
**Schema migration:** `061_user_hypotheses.sql` applied to CFO Staging (`qlbhvlssksnrhsleadzn`)
**Prod backfill:** `cfos-office/supabase/prod-backfill-hypotheses.sql` — NOT applied; handoff to Lewis.

---

## What landed

Six pieces, all behind `HYPOTHESIS_ENGINE_PROMPT=1` / `HYPOTHESIS_ENGINE_GENERATE=1`:

1. `user_hypotheses` table + RLS (migration 061)
2. Deterministic source-signals builder (`src/lib/hypothesis/source-signals.ts`)
   - Pure composer with 28 unit tests
   - Soft-depends on `value-profile.ts` via dynamic import; falls through cleanly when absent
3. Haiku generator (`src/lib/hypothesis/generator.ts`) — Zod-schema'd `generateObject`
4. Validator (`src/lib/hypothesis/validator.ts`) — digit/currency/greeting/merchant/6-gram gate
5. Variant-aware `buildFirstInsightContextV2`
   - New 10th positional arg: `options?: { variant: 'v2' | 'v2_hypothesis' }`
   - Default `'v2'` keeps baseline behaviour
6. `mark_hypothesis_line_contradicted` tool + value-map regen trigger

Plus rating-tool integration: `compare-first-insight.ts --hypothesis` captures `v2` vs `v2_hypothesis` pairs into `eval/golden-set/pairs/` for the standard rate/judge/tournament flow.

---

## Phase 8c — Archetype-aware compatibility test (LOCAL MERGE)

The archetype-aware sibling session lives on worktree `jolly-easley-0d9577`, branch `claude/jolly-easley-0d9577`. Key commit: `de22183 feat(value-map): UserValueProfile builder + resolveValuesAlignment` introduces `cfos-office/src/lib/value-map/value-profile.ts`, which my source-signals builder soft-depends on.

**Procedure executed:**

```bash
# From the hypothesis-engine branch
git checkout -b temp-archetype-aware-compat
git merge claude/jolly-easley-0d9577 --no-ff --no-edit

# Verify both worlds compile and test together
npx tsc --noEmit -p tsconfig.json   # exit 0
npm test                            # 742 tests pass (was 717 pre-merge — gained 25 from archetype-aware suite)

# Discard
git checkout claude/gifted-tharp-ea43e7
git branch -D temp-archetype-aware-compat
```

**Outcome: ✅ PASS.**

- Both branches' code coexists cleanly. No type conflicts.
- All 742 tests pass on the merged tree.
- `value-profile.ts` becomes a real module post-merge; my dynamic-import path in `source-signals.ts:loadValueProfileSafely` will resolve it and call `buildUserValueProfile`, populating `value_map.has_personal_data`, `top_foundation_categories`, and `top_leak_categories` in the source signals payload.
- The temp branch was discarded; nothing pushed to origin.

**What stays open until landed properly:** the live persona run (Phase 8b below) where the hypothesis lines and proposed experiment must be internally consistent for Dorcas. Recommend re-running that on a real local merge when archetype-aware lands on `main`.

---

## Phase 8d — Prompt-token budget delta

Measured with sample inputs (Alex-shape profile, no Value Map, one stub active hypothesis):

| Variant         | Prompt chars | ~Tokens |
|-----------------|--------------|---------|
| v2 (baseline)   | 3,790        | 948     |
| v2_hypothesis   | 3,709        | 927     |
| **Delta**       | **−81**      | **−21** |

**Outcome: ✅ PASS — flat-or-lower.**

The hypothesis variant is *smaller* than the v2 baseline by ~20 tokens. This is achievable because the "Rules:" overhead in the hypothesis section was absorbed into the trimmed approach block (one place to read the behavioural contract instead of two).

Source: `src/lib/ai/context-builder-hypothesis.test.ts:158` enforces `delta < 250` chars as a regression guard.

---

## Phase 8a/8b — Calibration personas + judge run (DEFERRED to manual run)

These require `.env.local` with Bedrock AWS keys (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), a budgeted Bedrock spend, and at least one staging user with sufficient transaction history. They were not executed in this session — manual run steps below.

### Manual run — Dorcas (staging user)

```bash
cd cfos-office
# 1) Verify Dorcas's user_id resolves on staging (the plan referenced
#    c6b1dd54-0c90-47ab-b098-d724d27471f7 — confirm with Lewis).
# 2) Capture + judge a v2 vs v2_hypothesis pair.
npx tsx scripts/compare-first-insight.ts c6b1dd54-0c90-47ab-b098-d724d27471f7 --hypothesis --capture --judge

# 3) Inspect the new pair JSON:
#    cat eval/golden-set/pairs/<pair-id>.json | jq '.judge_predictions[0]'
# 4) Open the rater to do a human rating:
npx tsx scripts/eval/rate.ts
```

### Manual run — calibration persona suite

```bash
HYPOTHESIS_ENGINE_GENERATE=1 HYPOTHESIS_ENGINE_PROMPT=1 \
  npx tsx scripts/run-personas-v2.ts --prompt-version v2
```

Then inspect each persona's `user_hypotheses` row on staging:

```sql
select user_id, thesis_lines, confidence, generated_from
from public.user_hypotheses
where superseded_at is null
order by generated_at desc
limit 20;
```

And cross-check that no validator firings occurred during the run:

```sql
select count(*) from public.user_events
where event_type = 'hypothesis_validator_fired'
  and created_at > now() - interval '1 hour';
```

Expected: 0 validator firings on calibration personas. Any firings indicate either (a) the prompt needs a tighter "no digits/merchants/greetings" instruction or (b) the validator's merchant list needs an addition — open `user_events.payload.offenders` to localise.

### Acceptance criteria (when run)

- ≥4 of 5 calibration personas produce a 3-line valid hypothesis on first try
- Judge scores `v2_hypothesis` not worse than `v2` on persona_fit + actionability
- For users with archetype-aware merged: the hypothesis line about values references the user's real-spending Foundation/Leak classifications (not just the perception exercise)

---

## Open items / followups

1. **Dorcas's user_id** — the plan referenced `c6b1dd54-0c90-47ab-b098-d724d27471f7` from memory; confirm before running 8a/8b.
2. **Re-run 8c against a real merge** once archetype-aware lands on `main` — the local-merge compat test verified type compatibility but not behavioural consistency under real Bedrock + DB data.
3. **Regeneration gating** — deliberately deferred. Codebase has no input-hash precedent; `regenerateArchetype` runs ungated every time. Revisit if any staging user accumulates >50 hypothesis rows in the first month.
4. **Haiku vs Sonnet** — generator uses `utilityModel` (Haiku). If persona runs (8a) reveal shallow / generic theses across ≥3 personas, swap to `chatModel`. One-line change in `generator.ts`.
