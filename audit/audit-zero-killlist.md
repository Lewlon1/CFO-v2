# Audit Zero — Consolidated Kill List

**Branch:** `session-33/audit-zero` · **Date:** 2026-05-29
**Headline:** the codebase is **sound**. After three-search verification of every candidate, there is **no large pile of provably-dead code**. The two build-safe deletion candidates are held as Lewis-decisions (prior-audit / product nuance). The session's real value is the verified map (Phases 0–4) + the doc reconciliation + this decision list.

---

## A. Build-safe deletions — awaiting go/no-go (the only this-session-deletable code)

| Item | Three-search evidence | Prior-audit | Verdict |
|---|---|---|---|
| **6 root debug scripts** — `apply-migration.ts`, `check-staging{,2,3}.ts`, `test-normalise.ts`, `test-rules.ts` | Zero refs (alias/sibling/dynamic); not in `package.json` scripts; not in CI; standalone `tsx` entrypoints | CODE-MAP: "safe deletions"; Track-3: *deferred* (manual-ops, ambiguous) | **DELETE if Lewis confirms** he doesn't run them by hand. Build/test-safe. |
| **`src/components/scenarios/ScenariosClient.tsx`** | Only self-def line in all `src/`; no `/office/scenarios` route; sole file in dir | Not in a prior dead-code list, but `next.config.ts:61` documents the **v2.5 "Scenarios folder dropped"** IA change | **DELETE if Lewis confirms** Scenarios isn't coming back. (Then also retire `folderColors.scenarios`.) |

## B. Documentation reconciliation + v2.6 (Phase 4 diffs — apply on approval)
- **CLAUDE.md** (surgical): feature-flag contradiction (:192 vs :276), File Structure tree, tool list (→43/createToolbox), 4-folder palette, roadmap (v2.6→Audit Zero), removed `/api/onboarding/complete`, Session 1–13 as historical.
- **BUILD-STATUS.md**: header/version (→v2.6), topology (real unmerged branches), counts (877 tests / 069 migs / 44·45 tables); keep the derived-field reference.
- **CODE-MAP.md**: mark the disproven "orphan routes (none should hit production)" line; `/chat` resolved (redirects); tools 23→43; tables 37→44/45; `scenarios/` no longer fully live; add 2026-05-29 supersession note.
- **BACKLOG.md**: correct the `merchant_category_map` entry (read site is a dead path, not live signup); fold in §D items.
- **Version mechanics**: `package.json` 2.5.2→**2.6.0**; `SESSION-LOG.md` entry `## v2.6 — Audit Zero — 2026-05-29`; `git tag v2.6` = Lewis's post-merge step.

## C. Production — REPORT-ONLY (guarded SQL written for Lewis; never applied by this session)
| Target | State | Action for Lewis |
|---|---|---|
| `savings_tips` | prod-only, 18 rows, 0 code refs, 0 FK deps | `TRUNCATE` then `DROP` (or keep as seed) — guarded prod-backfill SQL provided |
| `third_party_data_flows` | prod-only, 3 rows, 0 code refs, 0 FK deps | same |
| `lewis@test.com`, `gsbs@test.com` | `goal_chat_started`, never returned, `@test.com` | cascade-delete the 2 test users + children — guarded prod-backfill SQL provided |

(Staging needs no row migration — `active_experiments`/`dsar_requests` already dropped; the 2 seed tables never existed there; `scripts/reset-my-staging-data.ts` handles staging users.)

## D. NEEDS-LEWIS — follow-ups (NOT this session; protected files / deeper work)
- **`merchant_category_map` drop** — blocked on removing the dead transaction-insert path in `value-map-flow.tsx` (~L352–390), which is a **protected file** (`components/value-map/**`). Needs explicit double sign-off.
- **Dead `value-map-flow.tsx` insert path** — writes to non-existent `bank_accounts`, reads dead `merchant_category_map`; superseded by `/api/upload`. Protected file → dedicated follow-up.
- **`agents` phantom** — `value-map/reveal/route.ts:16` queries a non-existent table (tolerated via `?? 'unknown'`); retire the dead `getAgentId` scaffold.
- **`user_hypotheses`** — staging-only scaffold, 0 refs/0 rows; drop or wire the feature.
- **`benchmarks` vs `benchmark_reference`** — possible redundancy; confirm which is canonical.
- **`@types/pdf-parse`** — knip-unused devDep; verify `tsc` without it before removing.
- **`proxy.ts` `protectedPaths`** — uses legacy route names, omits `/office` (vestigial; office gated by layout).
- **Layered-read legacy path** — `!isLayeredReadEnabled()` branches + `computeFirstInsight`; retained kill-switch rollback, remove "once proven in prod" (per the flag docstring).
- **~10–15 genuinely-uncalled exports** (`predictValueCategory`, `estimateCostUSD`, `templatesForPattern`, `findAction`, …) — un-export or remove (feature scaffolding).
- **Migration registry/file drift** — 86 applied vs 069 files; staging ahead of prod.
- **Audit remaining `SECURITY DEFINER` functions** (`fn_import_batches`, `get_import_history`, `prediction_metrics_txn`) for references to dropped tables — the same class of bug that broke `delete_user_account` + `export_user_data` (both referenced the dropped `public.trips`; fixed in migration `070_fix_gdpr_functions_drop_trips.sql`). The code sweep only scanned TS `.from()` calls, not SQL function bodies.

## E. FALSE-POSITIVE / KEEP — verified alive (the audit's hardening asset)
Things that *looked* dead to tooling but are live — do **not** re-flag next audit:
- **`PATTERN_LIBRARY` ×12 detectors** — registry-dispatched (`insight-engine.ts:142`). knip flags 8 as "unused export" → false positive.
- **~43 tool modules** — string-keyed `createToolbox()` dispatch (`chat/route.ts:382`).
- **`EmptyState` ×3 + `GoalsEmptyState`** — live sibling-relative imports (the class that broke a prior build).
- **17 default+named export pairs** — default import used by routes; named export redundant only.
- **Generated `lib/supabase/types.ts`** exports — CLI typegen.
- **All 59 API routes** — 54 code-called + 8 crons in `vercel.json`; 0 orphans (the prior "14 orphan / none should hit production" was wrong).
- **chat-signals / Layer-4** — wired & default-ON, 0 rows ≠ dead.
- **`scripts/**` + `eval/**` dev tooling** (incl. `reextract-portrait.ts` = documented `manual_reextraction` path) — entrypoints, not dead.
- **Dormant FK-linked tables** — `accounts` (hub), `investment_holdings`, `nudges`, `correction_signals`, `chat_signals`, `persona_sanitiser_log`, `profile_extraction_candidates`, `wow_*`.

## Rebuild posture (one honest line)
**Rewrap, don't rebuild.** Build/tsc/tests green; 0 orphan routes; tools+detectors cleanly dispatched; schema disciplined and near-identical across envs. The only real debris is localised: one dead path in `value-map-flow.tsx`, a couple of phantom-table queries, and the retained layered-read rollback (intentional). The bones are sound.
