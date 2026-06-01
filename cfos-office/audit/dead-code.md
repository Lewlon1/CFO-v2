# Dead-Code Audit (Whole-App Repo Hygiene)

**Run date:** 2026-05-29
**Branch:** `claude/dead-code-audit` (off `claude/visual-consistency-audit`, which carries `audit/visual-consistency.md` + the dev-only `/styleguide`)
**Author:** Claude (Dead-Code Audit, Phase 0)
**Tooling:** `knip` (npx, latest), `ts-prune` (npx), `madge` (npx, `--ts-config`). None committed as a dependency this session.
**Type:** Identification only. Nothing deleted, moved, or merged. No DB / no `supabase/`.

> **Revision 1 (2026-05-29):** §2 now enumerates **all 88** unused exports, each individually classified by internal/test/other-module usage; §3 replaces the coarse string-match with a **rigorous per-route caller check** (0 zero-caller routes, evidence-backed); the VERIFY items are **resolved** (pattern-detectors ×8 and insight-engine ×4 → **KEEP** — live via the `PATTERN_LIBRARY` registry / internal calls); §4 adds a **card-cluster re-check** (no merge candidate). Method, §1, and hazards otherwise unchanged.

> Feeds the keep/kill triage ledger. Classification: **KILL** (delete in execution session) · **ARCHIVE** (move to `docs/archive/`) · **MERGE** (consolidate into a survivor — Phase 2) · **KEEP** (live via dynamic/registry/relative/internal use — recorded so it isn't re-flagged). A **SPARE** column is reserved for Lewis's triage veto.

---

## Method note — why this supersedes the `audit/03-*` snapshot

The prior orphan analysis (`audit/03-summary.md`, `03-components.md`) is from an **older project snapshot** — it cites paths under `/home/user/CFO-v2/…` and lists `office/dashboards/ScenariosDashboard.tsx` as a deletion candidate, but Scenarios was **deleted in v2.5**. It is unsafe to delete from:

- It reported **113 components, 63 orphans (56%)** — yet noted **44 were live via relative imports**, leaving "true orphans ~19."
- Its top "ready for deletion" list named `dashboard/TrendChart.tsx`, `dashboard/ValuesDonut.tsx`, `balance-sheet/NetWorthTrendChart.tsx`. **All three are live** — lazy-loaded via `next/dynamic` in `DashboardClient.tsx` / `BalanceSheetClient.tsx`. A grep audit can't see `() => import('./TrendChart')`.

This pass uses **`knip`** (real reachability from entry points; understands the Next App Router, barrels, relative + dynamic imports) as the primary instrument; `ts-prune` and `madge` cross-check.

**Three blind spots, each cross-checked (not auto-classified):**

1. **Dynamic / registry references.** Swept `import(` (16 sites) and `Registry|Record<string`. Confirmed the three "orphan charts" are `next/dynamic` (KEEP). **Confirmed the 8 "unused" `pattern-detectors` exports are live via the in-file `PATTERN_LIBRARY: PatternDetector[]` array** (KEEP) — the canonical false-positive this blind spot exists for.
2. **Route deadness is a product judgment.** Enumerated every `page.tsx`/`route.ts`; cross-referenced link/`router.push`/`redirect` targets, `vercel.json`, and per-route callers (§3).
3. **Cron / API wiring.** Diffed cron dirs vs `vercel.json`; per-route caller match for all 59 API routes (§3).

---

## Headline counts (current branch)

| Metric | This audit (accurate) | Stale `03-*` | Delta |
|---|---:|---:|---|
| Unused **files** | **18** — **0 in `src/`** (all `scripts/`/`eval/`/`tests/`) | 63 "orphans" / ~19 "true" | the "~19" were mis-located — unwired CLIs, not components |
| Dead **components/pages** in `src/` | **0** | implied many | charts rescued by `next/dynamic`; ScenariosDashboard already deleted |
| Unused **exports** (knip) | **88** → 18 redundant-default · ~18 genuinely-dead (KILL) · ~34 internal-only (KEEP) · ~12 barrel/ambiguous · data-layer | n/a | full breakdown in §2 |
| Unused exported **types** | 79 | n/a | mostly hygiene (incl. generated Supabase types — KEEP) |
| Circular deps (madge) | 3 | n/a | hygiene |
| Superseded routes (`(app)/*`) | **0** (group removed) | implied present | already cleaned |
| Unwired cron routes | **0** (8/8 in `vercel.json`) | "3 never wired" | gap closed |
| Unwired API routes | **0** (rigorous per-route caller check) | "4 with 0 refs" | gap closed |
| `portfolio-analyzer` / `tool-handlers` | **absent** | flagged suspects | resolved |
| Card-component MERGE candidates | **0** (all have ≥1 consumer) | "12-member cluster" (dismissed) | re-confirmed dismissal |

**True deletable source files: 0.** The actionable dead code is **~18 unused exports** (§2a) + the dead `data/` layer. `ts-prune` reported **218** src "true-unused" vs knip's 88 — the gap is ts-prune noise (test-only consumers + unresolved `@/` re-exports). knip is authoritative.

---

## Section 1 — Unreachable files (knip: 18)

**None are in `src/`.** Every one is a standalone executable (CLI / eval / test-runner module) *invoked* (`npx tsx …`, the onboarding runner, the eval workflow) rather than *imported* — flagged only because knip's default config has no entry-point glob for `scripts/**`, `eval/**`, or the runner's dynamically-loaded modules. **KEEP** (+ config fix), not KILL.

| Group | Files | Rec. | Blast radius / verify note |
|---|---|---|---|
| Eval harness | `eval/judges/2026-05-17-baseline.ts`, `scripts/compare-first-insight.ts`, `scripts/verify-first-insight.ts`, `scripts/run-personas-v2.ts`, `scripts/eval/{calibrate,diagnose,promote,rate,tournament}.ts`, `scripts/eval/_lib/judge-runner.ts` | **KEEP** (verify w/ eval owner) | Invoked via the eval workflow / each other by relative path. Some may be superseded iterations — Lewis/eval-owner call; if obsolete → ARCHIVE. |
| Manual CLIs (documented) | `scripts/reextract-portrait.ts`, `scripts/show-shape-and-posture.ts` | **KEEP** | Documented in CLAUDE.md / BUILD-STATUS as ad-hoc `npx tsx` tools. |
| One-shot backfills | `scripts/backfill-balance-sheet-portrait.ts`, `scripts/backfill-categories.ts` | **KEEP/ARCHIVE** | Lewis call — keep for re-run reference or archive. |
| Test-runner libs | `tests/onboarding/runner/judge-first-insight.ts`, `tests/onboarding/runner/prompt-version-flag.ts` | **KEEP** | Loaded by the onboarding runner CLI; removing breaks `npm run test:onboarding`. |
| Test stub | `scripts/_stub-next-headers.ts` | **KEEP** | Runtime stub for a script harness. |

**Action (not a deletion):** add `knip.json` declaring `scripts/**`, `eval/**`, `tests/onboarding/runner/cli.ts` as entries so these stop reading as unused.

---

## Section 2 — Unused exports in live files (knip: 88, each classified)

Every export was checked for **own-file internal use** (`own>1`), **test-only use** (`t`), and **other-module use** (`s`). Disposition below.

### §2a — KILL: genuinely dead exports (own=1, no test, no other reference)

| Export | File | Note / blast radius |
|---|---|---|
| `findAction` | `lib/actions/types.ts` | helper never called; action lookup done elsewhere |
| `opusModel` | `lib/ai/provider.ts` | archetype gen (`api/value-map/reveal`) defines its own `OPUS_MODEL`; this export unconsumed (`opusModelId` is used in-file → KEEP) |
| `estimateCostUSD` | `lib/ai/usage-logger.ts` | cost-estimate helper never called |
| `isRefundRow` | `lib/analytics/categories.ts` | predicate never called (other `categories` exports are live) |
| `getMerchantKey` | `lib/categorisation/normalise-merchant.ts` | dead twin of the live `normaliseMerchant` (the "duplicate export") |
| `detectColumnMapping`, `isMappingHighConfidence` | `lib/csv/column-detector.ts` | both exports dead — verify the CSV detector path uses a different entry before removing the file |
| `templatesForPattern` | `lib/experiments/templates.ts` | unused selector (other `templates` exports live) |
| `NUDGE_ICONS`, `NUDGE_LABELS`, `PRIORITY_ORDER` | `lib/nudges/rules.ts` | display/ordering maps; nudge UI doesn't import them |
| `STRUGGLE_LABELS` | `lib/onboarding-v2/labels.ts` | label map never consumed |
| `isStartUploadAction`, `isStartValueMapRealAction` | `lib/onboarding-v2/types.ts` | type-guard predicates with **zero callers** (confirmed by grep) |
| `isHoldingsMappingHighConfidence` | `lib/parsers/holdings-detector.ts` | unused confidence predicate |
| `predictValueCategory` | `lib/prediction/predictor.ts` | **zero callers**; file is live via `resolveValueCategory`/`loadUserRules` (`upload/pipeline.ts`). Either superseded or a future prediction-surface entry — confirm with prediction owner |
| `personaIds` | `tests/onboarding/personas/index.ts` | test helper, no caller (test scope) |
| `loadDotenvLocal` | `tests/onboarding/runner/preflight.ts` | test helper, no caller (test scope) |

→ **~18 genuinely-dead exports**, safe to remove **except** where the whole file's other exports are also dead (`column-detector.ts`) or feature-roadmapped (`predictValueCategory`) — each carries its verify note above.

### §2b — KILL: dead `data/` layer (Phase 2 primitive cleanup)

| Export(s) | File | Note |
|---|---|---|
| `FolderCard`, `FolderMetric` | `data/FolderCard.tsx` | only the `data/index.ts` barrel references them (their `s=1` **is** the barrel) → effectively 0 consumers |
| `CategoryBar`, `FileRow` | `data/DataComponents.tsx` | the 2 dead members of the 8-export barrel (the other 6 — `MonthSelector`, `TransactionRow`, `FilterPills`, `ProvenanceLine`, `GapCard`, `SectionTitle` — are live via `TheGapClient`/`OfficeTransactionsClient`) |
| barrel re-exports of all above | `data/index.ts:1–10` | remove dead entries when the underlying exports go |
| `MetricTile`, `ValuePill` | `data/MetricTile.tsx`, `data/ValuePill.tsx` | **KILL-pending** — `s=2`/`s=3` here is the **dev-only `/styleguide`** on the parent branch (the only consumers). Deletion must drop those styleguide demos first (see §5). |

### §2c — KEEP: live, but only used in-module or via in-file registry (un-export candidates, NOT dead)

These are exported yet consumed only inside their own file (or an in-file registry) — the `export` keyword is redundant, but the code is **live**. Optional hygiene; **do not delete the symbol**.

- **Resolved VERIFY items:**
  - `pattern-detectors.ts` ×8 — `transactionSizeDistribution`, `spendingVelocity`, `dayOfWeekSkew`, `convenienceVsPlanned`, `incomeDetected`, `valueMapGap`, `geographicSpendingModes`, `balanceTrajectory` → all members of the exported `PATTERN_LIBRARY: PatternDetector[]` array (lines 931–944), which the AI tools consume. **Live via the registry.** (The 4 siblings that knip *didn't* flag are imported individually by `find-outliers`/`find-money-clusters`/etc.)
  - `insight-engine.ts` ×4 — `assignToLayers`, `computeStatCards`, `determineHook`, `computeDisciplineScore` → all **called at lines 149–158** by the engine's compose function; defined lower. Live-internal.
- **Internal-only (own-file use):** `monthly-snapshot.ts` trio (`updateIncomeShape`, `backfillClosingBalances`, `updateFinancialPosture` — called by `refreshMonthlySnapshots()`); `buildFirstInsightContext` (V1 — still called at `context-builder.ts:1207` + tested); `traitSchema`, `profileFieldsSchema`, `BENCHMARK_COUNTRIES`, `NEUTRAL_CATEGORY_IDS`, `FIXED_COST_CATEGORIES`, `DISCRETIONARY_CATEGORY_IDS`, `computeNetWorthSnapshot`, `MAX_GAP_CV`, `fetchRecentCompletionStats`, `countActiveExperiments`, `recomputeUserGoals`, `parseLooseNumber`, `makeKey`, `resolveMerchantKeys`, `TIME_BUCKET_LABELS`, `opusModelId`, plus eval-script internals (`pairPath`, `HOLDOUT_BUCKET_COUNT`).

### §2d — KEEP / verify: name also appears in another module (barrel passthrough or local shadow)

knip flagged the export as unused, but grep finds the same identifier elsewhere — **not safe to KILL** without confirming it isn't a real consumer:

- `ChatContext` (`ChatProvider.tsx`) — the React context; consumers use `useChatContext`. **KEEP.**
- `matchPatterns`, `SIGNAL_PATTERNS`, `llmExtractSignals` (`chat-signals/index.ts`) — barrel re-exports; consumers import the submodules directly. **Cleanup** (barrel hygiene), Layer-4 is live.
- `isExpense`, `currentMonthStart`, `MAX_AMOUNT_CV`, `resolveUserCurrency`, `Constants` (generated Supabase) — same-named symbols found in other files (likely local shadows or generated). **KEEP / verify** before any removal.

### §2e — Redundant `default` exports (18) — cleanup, NOT dead components

Each exports **both** a named and a `default`; consumers use the named import, leaving `export default` dead. **All components are LIVE** (e.g. the four `*Section`s render in `OfficeHomeClient.tsx:79–124`). Drop the redundant `export default` line only:

`OfficeHomeClient`, `CFOAvatar`, `NavigationBar`, `Briefing`, `CashFlowDashboard`, `DetailHeader`, `DrillDownRow`, `NetWorthDashboard`, `ValuesDashboard`, `FolderSection`, `CashFlowSection`, `GoalsSection`, `NetWorthSection`, `ValuesSection`, `GoalsEmptyState`, `UserAvatarMenu` (+ `getMerchantKey` is the one *named* dup, already KILL in §2a).

### §2f — Unused exported types (79) — mostly KEEP / hygiene

Dominated by **generated Supabase types** (`Json`, `Tables`, `TablesInsert`, `TablesUpdate`, `Enums`, `CompositeTypes`, `Constants`) → **KEEP** (regenerated; conventional surface). Public-API types (`ButtonProps`) → KEEP. The remainder (parser/insight/experiment type exports) are a low-risk type-hygiene pass — not load-bearing dead code.

---

## Section 3 — Dead / superseded routes (all clear)

- **Superseded `(app)/*` pages: NONE.** No `(app)` route group exists — only `(auth)`, `(office)`, `(public)`, `admin`, `api`, `onboarding-v2`, `value-map`, `styleguide`. The old→`office/*` migration cleanup already landed.
- **Cron routes: 8/8 wired.** Dirs `{daily-bills, expire-experiments, nudges-daily, nudges-monthly, nudges-weekly, portrait-extraction, profile-extraction, wow-aggregate}` exactly match the 8 `vercel.json` crons. "3 unwired crons" flag closed.
- **API routes: 0 zero-caller (rigorous).** Each of the 59 `api/**/route.ts` paths was matched against `/api/<path>` references in source with a **precise boundary** (`/api/<path>` followed by a non-path char or EOL, excluding the route file itself, excluding crons which Vercel invokes). **Every non-cron route has ≥1 caller** — no orphaned API routes. The old "4 with 0 references" flag is closed. (Stronger than R0's string-match: this version is evidence-backed, not caveated.)

No KILL/ARCHIVE route candidates.

---

## Section 4 — MERGE clusters (input required from Lewis)

### Cluster: EmptyState — **6** implementations → 1 primitive (Phase 2)

| File | Distinct behaviour |
|---|---|
| `office/dashboards/DashboardEmptyState.tsx` | Props-driven (`icon/body/actionLabel/actionHref/accent`); office tokens. Lightest. **Recommended survivor base.** |
| `dashboard/EmptyState.tsx` | `variant: 'no_data' \| 'no_values'`; hardcoded copy + two CTAs; shadcn tokens. |
| `balance-sheet/EmptyState.tsx` | Chat-context aware (`useChatContext`, `onUploadClick`); "start a conversation" path. |
| `bills/EmptyBillsState.tsx` | Bills-feature-specific. |
| `office/sections/GoalsEmptyState.tsx` | Home-section goals empty state. |
| `office/goals/GoalsEmptyStateCTA.tsx` | Goals-folder CTA variant. |

**Survivor must do (stub for Lewis):**
- [ ] Accept an optional **chat-context action** (balance-sheet's `onUploadClick` / "start a conversation") — keep or drop?
- [ ] Support **named variants** vs fully prop-driven (`no_data`/`no_values`) — which variants survive?
- [ ] Token system: office vs shadcn (ties into Visual Phase 1 / decision D2).
- [ ] Do the two Goals variants collapse into the survivor or stay bespoke?

*(Hazard: `session-32/staging-user-hygiene` edits `dashboard/EmptyState.tsx` + `office/sections/GoalsEmptyState.tsx` — see §5.)*

### Cluster: `data/` primitives layer (Phase 2)

`MetricTile`, `ValuePill`, `FolderCard`/`FolderMetric` — the never-adopted v2.4 initiative (§2b). Overlaps Visual Phase 2's "primitive layer to demand (≥3-consumer)."

### Card components — re-checked, **no MERGE candidate**

All 16 `*Card*` components carry **≥1 real consumer** (range 1–3): `AssetGroupCard`, `LiabilityGroupCard`, `NetWorthCards`, `SummaryCards`, `ValueCategoryCards`, `StatCardBlock`, `SavedItemCard`, `ProfileCard`, `demo-card`, `onboarding-banner-card`, `value-map-card`, `GoalCard`, `BillCard`, and the three gap cards (`CoverageGapCard`, `SingleIntentGapCard`, `MultiIntentGapCard` — Session-26 chat-intelligence, live). The only "orphan-ish" one is `FolderCard` — its lone reference is the dead `data/` barrel (already KILL in §2b). **Re-confirms the stale audit's "cards are feature-local, no consolidation needed."** No card survivor stub required.

---

## Section 5 — Hazards (read before any execution session)

1. **Unmerged `session-32/staging-user-hygiene` overlaps targets.** `git diff main..session-32` touches `lib/analytics/pattern-detectors.ts` (+ test), `components/dashboard/EmptyState.tsx`, `office/sections/GoalsEmptyState.tsx`. The pattern-detector exports are now **KEEP** (so no deletion conflict there), but the **§2c un-export hygiene** on that file and the **EmptyState MERGE (§4)** must wait for session-32 to merge or be fenced around these files. Other unmerged branches (`docs/rescue-session-30-latency`, `claude/quirky-easley-78125c`, `claude/romantic-joliot-14629b`) touch **none** of the targets.
2. **Cross-branch styleguide dependency.** `MetricTile` + `ValuePill` are imported by the dev-only `/styleguide` on this branch's parent (`claude/visual-consistency-audit`). KILL-ing them (§2b) breaks that route unless the demos are dropped first. Coordinate execution order. `FolderCard`/`FolderMetric` have no consumer → clean.
3. **Dynamic / registry — confirmed KEEP (do not re-flag):** the `next/dynamic` charts (`TrendChart`, `ValuesDonut`, `SpendingChart`, `ValuesTrendChart`, `NetWorthTrendChart`, `AllocationDonut`); the `PATTERN_LIBRARY` detectors; the insight-engine internals. The stale audit's "delete these charts" verdict is **wrong** — recorded so the next pass doesn't repeat it.
4. **Session 26 (`feature/v2.2-chat-intelligence`)** not present as a ref here; its artefacts (`LabelTransactionsBlock`, the gap cards) already appear on-branch, i.e. reads as **already merged** — no separate file-level hazard, but couldn't be diffed. **O1/O2 already on `main`** — the plan's O1/O2 hazard is stale.
5. **No `supabase/` / DB involvement** in any candidate.

---

## Section 6 — Classification summary + execution preconditions

| Class | Count | Items |
|---|---:|---|
| **KILL** | ~18 dead exports + data layer | §2a (the ~18 own=1 dead exports) + §2b (`FolderCard`/`FolderMetric`, `CategoryBar`/`FileRow`, dead barrel entries); `MetricTile`/`ValuePill` KILL-pending on the styleguide |
| **MERGE** | 2 clusters | 6× EmptyState → 1; the `data/` trio (Phase 2). **Cards: none.** |
| **KEEP** | 18 files + ~34 exports + 79 types (mostly) | all 18 "unused files" (CLIs/eval/tests); §2c internal-only/registry exports (incl. resolved pattern-detectors + insight-engine); §2d barrel/ambiguous; §5(3) dynamic-import charts; live `*Section`/card components |
| **Cleanup** | 18 + barrels | redundant `default` exports (§2e); chat-signals barrel re-exports |
| **ARCHIVE** | 0–4 (Lewis) | obsolete eval scripts / one-shot backfills, if the eval owner deems them superseded |
| **SPARE** | — | reserved for Lewis's triage veto |

**Execution preconditions (merge-timing rule):**

- The deletion execution must **wait for `session-32/staging-user-hygiene` to merge, or fence around `pattern-detectors.ts` + the two EmptyState files it touches.**
- **Sequence the `data/`-trio deletion with `claude/visual-consistency-audit`** (its styleguide consumes `MetricTile`/`ValuePill`).
- The §2a dead exports that are **not** §5-hazarded (`opusModel`, `estimateCostUSD`, `isRefundRow`, `findAction`, the nudges maps, the onboarding-v2 guards, etc.) are safe to remove now on their own branch.
- Nothing here touches `supabase/` or migrations.

**Drift-proofing follow-up (not this session):** commit a `knip.json` (entries for `scripts/**`+`eval/**`) and graduate `knip` into a CI gate — the third prong alongside the Visual Phase-4 ESLint colour ban and the `/styleguide` regression surface.

---

## Appendix — commands as run (+ corrections for reuse)

```bash
# from cfos-office/ ; zsh: `unsetopt nomatch` + quote --include globs
npx --yes knip --no-progress            # 18 unused files / 88 exports / 79 types / 17 dup-exports
npx --yes ts-prune                      # 467 lines; 218 src "true-unused" (noisier than knip)
npx --yes madge --circular --ts-config tsconfig.json --extensions ts,tsx src   # 3 cycles

# Per-export classification (own-file vs test vs other-module use) — drove §2:
#   for each knip "Unused exports" (name,file): own=$(grep -Ewc name file);
#   hits=$(grep -rEwl name src tests | grep -vxF file); split hits into test vs src.

# Rigorous per-route caller check — drove §3 (0 zero-caller):
find src/app/api -name route.ts | sed 's#src/app/api/##;s#/route.ts##' | while read r; do
  case "$r" in cron/*) continue;; esac
  grep -rlE "/api/$r([^a-zA-Z0-9/_-]|\$)" src --include='*.ts' --include='*.tsx' | grep -vxF "src/app/api/$r/route.ts" | wc -l
done

# Card-cluster consumer counts — drove §4 (no merge candidate):
find src/components src/app \( -name '*Card*.tsx' -o -name '*card*.tsx' \) | while read f; do
  base=$(basename "$f" .tsx); grep -rlEw "$base" src | grep -vxF "$f" | wc -l; done
```

**Corrections for the next agent:**
- **knip needs an entry config** for `scripts/**`+`eval/**` or it false-flags every standalone CLI (all 18 "unused files" here). Commit `knip.json` before trusting the file list; then make knip a CI gate.
- **ts-prune is noisy** (218 vs knip's 88 — counts test-only consumers + unresolved `@/` re-exports); treat knip as authoritative.
- **madge** needs `--ts-config tsconfig.json` to resolve `@/` (3 cycles: `gap-analyser↔pattern-detectors`, `compose-first-read↔prompts/first-read`, `reconcile-fixed-costs↔flag-against-benchmark`).
- **Registry blind spot is real here:** `pattern-detectors` exports read as unused but are live via the in-file `PATTERN_LIBRARY` array. Always grep the *same file* for an aggregator before classifying an analytics export as dead.
- The stale `audit/03-*` snapshot is from a different machine (`/home/user/CFO-v2`), pre-v2.5 — **do not** delete from it.
```
