# Dead & Redundant Code Audit
> Generated: 2026-06-09 | Branch: `claude/dead-redundant-code-analysis-ojnldr` | Tip: `fea6a0b`

## Method

1. `npm run knip` (CI config) — **clean** (files / dependencies / unlisted / binaries / unresolved all pass).
2. knip re-run with the relaxed checks re-enabled (`exports`, `types`, `duplicates`) — 75 unused exports, 80 unused exported types, 16 duplicate exports raw. Every function/const finding was then manually grep-verified across `src/`, `scripts/`, `eval/`, `tests/` to separate true dead code from documented false positives (same-file use, registry dispatch, named+default pairs, generated `supabase/types.ts`).
3. Full route-caller sweep (61 routes), server-action import sweep, and deep traces of both default-on feature gates (`isLayeredReadEnabled`, `isChatIntelligenceV2Enabled`).

## Summary

- **1 dead API route** (zero callers, stale doc-comment)
- **17 dead exports** (function/const bodies with zero references anywhere)
- **2 redundant barrel re-export clusters**
- **1 orphaned dev script**
- **2 duplicate-implementation patterns** (both sides alive — consolidation candidates)
- **Legacy kill-switch paths: NOT dead now** — everything behind `LAYERED_READ_DISABLED` / `CHAT_INTELLIGENCE_V2_FORCE=0` is intentionally retained rollback (per CLAUDE.md), inventoried below for the eventual removal session
- **1 stale claim in a prior audit** (`/api/transactions/recategorise` is now ALIVE)

---

## 1. Dead now — high confidence

### 1.1 Orphan API route

| Route | File | Evidence |
|---|---|---|
| `GET /api/goals/active-count` | `cfos-office/src/app/api/goals/active-count/route.ts` | Zero fetch/import callers anywhere. The route's own comment claims it is "used by the GoalBeatWatcher", but `GoalBeatWatcher` actually polls `/api/onboarding/essentials-status`. Stale comment, dead route. |

All other 60 routes have verified callers (UI fetches, `vercel.json` cron registrations, or onboarding orchestrators). All five `'use server'` action files have live importers.

### 1.2 Dead exports (zero references outside their own definition)

Each verified by whole-word grep across `src/`, `scripts/`, `eval/`, `tests/` (excluding test-output):

| File | Export | Notes |
|---|---|---|
| `src/lib/actions/types.ts:30` | `findAction` | Generic action-lookup helper; never called |
| `src/lib/ai/usage-logger.ts:17` | `estimateCostUSD` | Cost estimator never wired into logging |
| `src/lib/ai/provider.ts:31` | `opusModel` | Dead client. `value-map/reveal` builds its own `bedrock(OPUS_MODEL)` instead (see §3.2) |
| `src/lib/analytics/categories.ts:33` | `isRefundRow` | Predicate never imported |
| `src/lib/csv/column-detector.ts:31,50` | `detectColumnMapping`, `isMappingHighConfidence` | File stays alive via `SEMANTIC_FIELD_LABELS` / `SemanticField`; these two functions are dead |
| `src/lib/experiments/templates.ts:218` | `templatesForPattern` | Never called |
| `src/lib/nudges/rules.ts:172–198` | `NUDGE_ICONS`, `NUDGE_LABELS`, `PRIORITY_ORDER` | UI lookup tables with no consumers; only `NUDGE_RULES` is live |
| `src/lib/onboarding-v2/labels.ts:10` | `STRUGGLE_LABELS` | `STRUGGLE_OPTIONS` is live; this map is not |
| `src/lib/onboarding-v2/types.ts:62,73` | `isStartUploadAction`, `isStartValueMapRealAction` | Only `isStartValueMapAction` is used (MessageList) |
| `src/lib/parsers/holdings-detector.ts:149` | `isHoldingsMappingHighConfidence` | `detectHoldingsMapping` is live; this helper is not |
| `src/lib/prediction/predictor.ts:160` | `predictValueCategory` | File alive via `resolveValueCategory` / `loadUserRules`; this wrapper is dead |
| `src/lib/utils/money.ts:125` | `resolveUserCurrency` (async) | Dead AND name-collides with the *live* sync `resolveUserCurrency` in `analytics/insight-engine.ts:43` — delete to remove the trap |
| `src/lib/categorisation/normalise-merchant.ts:88` | `getMerchantKey` | Pure alias of `normaliseMerchant`; zero callers |

**Not dead (knip false positives, verified):** `assignToLayers` / `computeStatCards` / `determineHook` / `computeDisciplineScore` (same-file use in `insight-engine.ts`), all 8 `pattern-detectors.ts` exports (in-file `PATTERN_LIBRARY` registry), `computeNetWorthSnapshot` / `currentMonthStart`, `recomputeUserGoals`, `trendSalience` / `freqSalience`, `MAX_AMOUNT_CV` / `MAX_GAP_CV`, `NEUTRAL_CATEGORY_IDS`, `BENCHMARK_COUNTRIES`, `FIXED_COST_CATEGORIES`, `TIME_BUCKET_LABELS`, `profileFieldsSchema`, `ChatContext`, dynamic-imported chart components. These are merely *over-exported* — removing the `export` keyword is optional hygiene, not dead-code removal.

### 1.3 Redundant barrel re-exports

- `src/components/data/index.ts` — the `ValuePill` re-export is unused (its one consumer, `DataComponents.tsx`, imports `./ValuePill` directly).
- `src/lib/analytics/chat-signals/index.ts` — only `extractAndStoreSignals` is consumed via the barrel (`api/chat/route.ts`). The re-exports of `matchPatterns`, `SIGNAL_PATTERNS`, `llmExtractSignals`, `PatternMatch` and the type re-exports are dead barrel lines (internals import submodules directly).

### 1.4 Orphan dev script

- `cfos-office/scripts/test-tools.ts` — zero references in `package.json` scripts, docs, or any other file (every other script in `scripts/` has 2+ references). It is the Phase 2 Chat Intelligence sanity harness ("before Phase 4 swaps the prompt") — purpose served, now stale.

---

## 2. Redundant — duplicate implementations (both alive)

### 2.1 Two `formatMoney` implementations

- **Canonical:** `src/lib/utils/money.ts` `formatMoney` — 8+ importers, with `lib/format/currency.ts` and `lib/utils/format-currency-rounded.ts` already converged onto it as shims.
- **Second source:** `src/lib/format/money.ts` `formatMoney` + `currencySymbol` — a separate implementation imported by exactly 3 files, all in the first-read prompt path (`lib/ai/prompts/first-read.ts`, `lib/ai/context-builder.ts`, `lib/ai/compose-first-read.ts`).

Two formatters with the same name and different behaviour is the same "third source of truth" failure mode the token lock exists to prevent. Consolidation candidate: fold `format/money.ts` into `utils/money.ts` (or make it a shim like `format/currency.ts`).

### 2.2 Opus model resolution duplicated

`BEDROCK_OPUS_MODEL ?? 'eu.anthropic.claude-opus-4-6'` is resolved twice: in `lib/ai/provider.ts` (`opusModelId`, whose only remaining job after `opusModel` dies is a startup log line) and again locally in `app/api/value-map/reveal/route.ts:8`. Reveal should import from the provider, or the provider's opus exports should go entirely.

---

## 3. Retained legacy — dead only when the kill-switches retire

> **EXECUTED 2026-06-10** — both kill-switches retired and the legacy paths below removed (see `docs/decisions/2026-06-10-legacy-onboarding-removal-plan.md`). Kept for the historical record.

**Nothing here is dead today.** Both gates are default-ON with env-var escape hatches that CLAUDE.md explicitly designates as runtime rollback. This is the inventory for the already-planned removal session.

### 3.1 `isLayeredReadEnabled()` false-branches (`LAYERED_READ_DISABLED=true`)

10 call sites whose false-branches become unreachable on flag removal:

| Site | Legacy behaviour when flag OFF |
|---|---|
| `lib/ai/tools/index.ts:101` | Layered tools (`get_cluster_behaviour`, `get_conversation_signals`) not registered |
| `lib/ai/context-builder.ts:975, 1354` | Why-beat context empty; layered instructions omitted |
| `app/api/chat/route.ts:232, 402` | No chat-signal extraction; no why-beat gate |
| `app/api/upload/route.ts:111` | No `merchant_aggregates` MV refresh |
| `app/api/insights/post-upload/route.ts:33` | Falls back to legacy `computeFirstInsight()` payload path |
| `app/api/wow/event/route.ts:21` | Wow events discarded |
| `app/onboarding-v2/first-read/page.tsx:22` | Redirects to `/onboarding-v2/archetype` |
| `app/(office)/layout.tsx:70,99` | Routes `upload_done` users to archetype instead of first-read |
| `lib/onboarding-v2/resume.ts:42–43` | Post-upload routing → archetype |

Dies with the flag:
- `computeFirstInsight()` and its private pipeline in `lib/analytics/insight-engine.ts` (sole caller: post-upload legacy branch). NB: `resolveUserCurrency` (sync) in the same file IS used by live code — extract before deleting the module.
- `buildFirstInsightContext()` + the `conversationIsFirstInsight && firstInsightPayload` system-prompt branch in `context-builder.ts:1288`.

Does **not** die with the flag: `/onboarding-v2/archetype` + `generate-archetype` route + `archetype-prompt.ts` (still the terminal for legacy-stamped and `dont_know`-path users), and the `essentials_done` / `goal_set` / `goal_skipped` forward-migration in `resume.ts` (mid-flow users).

### 3.2 `isChatIntelligenceV2Enabled()` false-branch (`CHAT_INTELLIGENCE_V2_FORCE=0`)

4 call sites (`the-gap/page.tsx:56`, `api/chat/route.ts:941`, `api/insights/post-upload/route.ts:96`, `context-builder.ts:1167`). The V1 deterministic-narration prompt path in `context-builder.ts` exists only for this escape hatch (docstring: "local debugging and the verify-first-insight.ts script"). The function's `profile` parameter is already a no-op — flagged in its own docstring.

When V1 dies, so do the comparison harnesses: `scripts/compare-first-insight.ts`, `scripts/verify-first-insight.ts`, `scripts/_stub-next-headers.ts` (stub used only by that harness).

---

## 4. Prior-audit reconciliation

- 2026-05-01 dead-code audit's three dead routes (`/api/transactions/low-confidence-count`, `/api/nudges/count`, `/api/value-map/regenerate`) — **all confirmed deleted**.
- `/api/transactions/recategorise` — marked DEAD in that audit, **now ALIVE**: called from `value-map-card.tsx:340`. The 2026-05-01 doc is stale on this point; do not act on its C1 recommendation.

## 5. Low-priority noise

- ~80 unused exported **types** (interfaces/type aliases). Zero runtime weight; many are intentional public shapes (`ButtonProps`, parser types, generated `supabase/types.ts` helpers). Not itemised; tighten via knip `types` rule only after the feature-code cleanup CLAUDE.md already tracks.
- 16 named+default duplicate exports (components) — documented knip-relaxation false-positive class.

## 6. Recommended actions

**Safe to delete now (no behaviour change, typecheck-verifiable):**
1. `src/app/api/goals/active-count/route.ts`
2. The 17 dead exports in §1.2
3. The dead barrel lines in §1.3
4. `scripts/test-tools.ts`

**Consolidate (small refactor):**
5. Fold `lib/format/money.ts` into `lib/utils/money.ts` (3 import sites)
6. Single opus model-id resolution (provider or reveal route, not both)

**Defer to the planned flag-retirement session:** everything in §3, per the CLAUDE.md rollback policy (first live cohort proven in prod).
