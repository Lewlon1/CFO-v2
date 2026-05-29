# Audit Zero — Codebase + Database Consolidation (v2.6)

**Branch:** `session-33/audit-zero` · **Date:** 2026-05-29
Foundation audit before any rebuild/rewrap. Phases 0–4 were **read-only**; Phase 5 (removals + doc fixes) ran gated on approval. Full decision record + three-search evidence: [`audit/audit-zero-killlist.md`](audit-zero-killlist.md).

## Headline
The codebase is **sound — rewrap, don't rebuild.** Build/tsc/tests green; **0 orphan API routes**; tools + detectors cleanly dispatched; schema disciplined and near-identical across envs. Every automated "dead code" flag was a false positive or an intentionally-retained path. Net production-code change this session: **−389 LOC (deletions only; zero new code)**.

## Phase 0 — Ground truth + baseline
- Branched off the **real** main tip `2875904` (the session-start `8d309ee` snapshot was stale — #55 layered-Read-default + #56 docs landed after).
- **Green baseline:** build ✅ · `tsc --noEmit` ✅ · vitest **877 passing / 74 files** ✅ · eslint **33 errors / 45 warnings** (pre-existing; not a regression target). No `typecheck` script — `tsc` is invoked directly.
- **Advisors (staging):** security 9 WARN · performance 27 WARN / 47 INFO — **0 critical/high**.
- Real tree: 42 pages · 59 API routes · 222 `lib` · 122 components. Live IA is `/office/**` (not CLAUDE.md's v1 `(app)/` tree).

## Ground-truth corrections (the brief's premises were stale)
| Assumed | Verified reality |
|---|---|
| max migration 047 | **069** (new prod-backfill is 070) |
| prod 37 / staging 35–36; staging ~10 ahead | **prod 45 / staging 44 — near-identical** (diff = 3 tables) |
| 4 dead tables to drop | 2 already dropped both envs; 2 seed tables linger prod-only |
| top-level `prod-backfill/` dir | convention is `prod-backfill-0XX_*.sql` in `migrations/` |
| package.json mid-v2.x | **2.5.2** → bumped to **2.6.0** |
| CLAUDE.md wholesale v1 | partially current; specific stale sections + a flag self-contradiction |

## Phase 1 — Code dead-code sweep (knip + depcheck; ts-prune hung, scope subsumed by knip)
- **DEAD-HIGH auto-deletable: none.** Removed (gate-approved): 6 zero-ref root debug scripts (`apply-migration.ts`, `check-staging{,2,3}.ts`, `test-normalise.ts`, `test-rules.ts`) + `ScenariosClient.tsx` (orphan from the v2.5-dropped Scenarios folder).
- **False positives — DO NOT re-flag:** `PATTERN_LIBRARY` ×12 detectors (registry dispatch, `insight-engine.ts:142`); ~43 tool modules (string-keyed `createToolbox()`, `chat/route.ts:382`); `EmptyState` ×3 + `GoalsEmptyState` (sibling imports — the class that broke a prior build); 17 default+named export pairs; generated `lib/supabase/types.ts`; chat-signals (default-ON, 0 rows ≠ dead); `scripts/**`+`eval/**` manual tooling.
- depcheck's 3 hits (`tailwindcss`, `@tailwindcss/postcss`, `@types/react-dom`) = config/peer false positives.

## Phase 2 — Route & API surface
- **59/59 API routes live** (54 code-called incl. route-type-imports like `/api/dashboard/summary/route` ×11; 8 crons all in `vercel.json`). **0 orphans** → resolves the 2026-05-01 "unscheduled nudge crons" concern.
- Legacy paths (`/chat`, `/transactions`, `/bills`, `/scenarios`, …) are **permanent redirects in `next.config.ts`** → `/office/**`. CODE-MAP's *"no route should hit these in production"* line is **disproven**.
- Middleware = **`src/proxy.ts`** (Next 15 `proxy` convention). Real auth gate = `app/(office)/layout.tsx`. `proxy.ts` `protectedPaths` is vestigial (legacy names, omits `/office`).

## Phase 3 — Database (both envs, READ-ONLY SELECT)
- staging 44 / prod 45 public tables; whole diff = `user_hypotheses` (staging-only scaffold) + `savings_tips`/`third_party_data_flows` (prod-only dead seed).
- **Dead (report-only, prod):** `savings_tips` (18) + `third_party_data_flows` (3) — 0 code refs, 0 FK deps → guarded prod-backfill SQL.
- **`merchant_category_map`:** 0 rows both envs, **no writer** (its one ref is a `.select()` read inside a dead path), 0 FK deps → droppable once the dead path is removed.
- **Code-vs-schema drift:** `value-map-flow.tsx` has a dead transaction-insert path writing to the non-existent `bank_accounts` table + reading dead `merchant_category_map` (superseded by `/api/upload`); `value-map/reveal/route.ts:16` queries a non-existent `agents` table (tolerated via `?? 'unknown'`). Both in protected files → follow-up.
- **Dormant FK-linked (DO NOT DROP):** `accounts` (hub), `investment_holdings`, `nudges`, `correction_signals`, `chat_signals`, `persona_sanitiser_log`, `profile_extraction_candidates`, `wow_*`.
- `messages.tool_results` = **phantom column** (never existed; no code refs). The 4 real audit columns exist (forward-only population, per CLAUDE.md).
- **Rows:** prod = 8 real beta users (April, pre-step-machine) + 2 completed + **2 `@test.com` test users** (`lewis@`, `gsbs@` — the only cleanup; in the prod-backfill SQL).
- Migration registry: **86 applied each env vs 069 files** — known tracking drift.

## Phase 4 — Docs reconciled (applied this session)
- **CLAUDE.md:** flag self-contradiction (:192 vs :276), 4-folder palette + Values `#E8A84C`→`#7C4D9E`, roadmap → v2.6, removed `/api/onboarding/complete`.
- **BUILD-STATUS.md:** header/version/topology/counts. **CODE-MAP.md:** supersession note + disproven orphan-route line. **BACKLOG.md:** `merchant_category_map` correction + Audit Zero follow-ups. **package.json → 2.6.0.**
- **Recurring-debt ritual (proposed):** end every schema/route-touching session by refreshing BUILD-STATUS counts + the SESSION-LOG entry; deeper fix — make CODE-MAP a *generated* snapshot so it can't drift.

## Decisions & follow-ups
Full DEAD-HIGH / NEEDS-LEWIS / FALSE-POSITIVE record + the prod cleanup plan: [`audit/audit-zero-killlist.md`](audit-zero-killlist.md). Production cleanup (Lewis runs manually, never applied here): [`cfos-office/supabase/migrations/prod-backfill-070_audit_zero_cleanup.sql`](../cfos-office/supabase/migrations/prod-backfill-070_audit_zero_cleanup.sql).
