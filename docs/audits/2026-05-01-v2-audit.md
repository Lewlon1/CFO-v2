# V2 Audit — Branch State Snapshot
> Generated: 2026-05-01 | Branch: `claude/prepare-beta-v2-O1zeV` (HEAD `a866d24`) | Audit run from: `claude/audit-v2-branch-state-UoHld` (same tip, fast-forward equivalent)

**Scope.** Read-only audit of the unified beta-v2 branch. No source code modified. The audit branch (`claude/audit-v2-branch-state-UoHld`) was on an identical commit to `claude/prepare-beta-v2-O1zeV` at the time of the snapshot, so all findings below describe the v2 branch as it stands. Working tree clean.

---

## 1. Branch position vs main

| Metric | Value |
|---|---|
| Commits ahead of `origin/main` | **118** |
| Commits behind `origin/main` | 0 (merge-base = `origin/main` HEAD `3aa3f96`) |
| Files changed vs main | **425** |
| Insertions | +39,068 |
| Deletions | −17,475 |

The merge-base equals `origin/main` HEAD (commit `3aa3f96`, 2026-04-14 — *Vercel Web Analytics*). `origin/main` has not moved since this branch began. Most diff size comes from a structural reorganisation: the active app moved into `cfos-office/` and the orphan root `/src/` MVP archive was deleted (`de74614`).

### Top 10 changed files by line churn

| Lines | +Add | −Del | Path |
|---:|---:|---:|---|
| 3,651 | 3,651 | 0 | `cfos-office/docs/superpowers/plans/2026-04-20-onboarding-test-suite.md` |
| 2,640 | 2,640 | 0 | `cfos-office/src/lib/supabase/types.ts` |
| 1,903 | 1,774 | 129 | `cfos-office/package-lock.json` |
| 1,063 | 1,063 | 0 | `cfos-office/docs/superpowers/plans/2026-04-21-first-insight-grounding-and-actionability.md` |
| 974 | 974 | 0 | `cfos-office/src/lib/analytics/pattern-detectors.ts` |
| 880 | 0 | 880 | `src/components/transactions/csv-upload-wizard.tsx` *(orphan-tree deletion)* |
| 734 | 706 | 28 | `cfos-office/src/lib/ai/context-builder.ts` |
| 550 | 550 | 0 | `cfos-office/docs/superpowers/specs/2026-04-13-value-map-personal-retake-design.md` |
| 542 | 0 | 542 | `src/components/value-map/value-map-flow.tsx` *(orphan-tree deletion)* |
| 541 | 541 | 0 | `cfos-office/scripts/parse-diagnose.ts` |

Generated regenerated `supabase/types.ts` and the new pattern-detection / onboarding-test-suite docs dominate. `context-builder.ts` is the only large *behavioural* hotspot in the active code.

---

## 2. Routes

All authenticated routes have been moved out of the legacy `(app)` group and into `(office)` (`/office/...`). The redirects in `cfos-office/next.config.ts` cover all 12 public-URL surfaces from the v1 layout. The legacy `(app)` route group **does not exist** in this branch.

| Old path | Status | New path | Redirect (next.config.ts) |
|---|---|---|---|
| `/dashboard` | gone | `/office` | ✅ permanent |
| `/chat` | gone | `/office` | ✅ permanent |
| `/chat/:id` | gone | `/office` | ✅ permanent |
| `/bills` | gone | `/office/cash-flow/bills` | ✅ permanent |
| `/transactions` | gone | `/office/cash-flow/transactions` | ✅ permanent |
| `/scenarios` | gone | `/office/scenarios/what-if` | ✅ permanent |
| `/trips` | gone | `/office/scenarios/trips` | ✅ permanent |
| `/profile` | gone | `/office/values/portrait` | ✅ permanent |
| `/goals` | gone | `/office/scenarios/goals` | ✅ permanent |
| `/settings` | gone | `/office/settings` | ✅ permanent |
| `/balance-sheet` | gone | `/office/net-worth/balance-sheet` | ✅ permanent |
| `/upload` | gone | `/office/cash-flow/transactions` | ⚠ `permanent: false` (only one of the 12) |

Active route groups now:

- `(public)` — `/`, `/demo`, `/privacy`, `/terms`, `/value-map`
- `(auth)` — `/login`, `/signup`
- `(office)` — `/office`, `/office/cash-flow/*` (8 pages), `/office/net-worth/*` (5 pages), `/office/values/*` (6 pages), `/office/scenarios/*` (4 pages), `/office/inbox`, `/office/settings`

Total app/route files (pages + layouts + route handlers): **91**. API route handlers: **57**.

---

## 3. Lib & API

### 3.1 Lib orphans (zero importers across `src/`, `tests/`, `scripts/`)

Search method: basename match against any `from '…/<name>'`, `import('…/<name>')`, or `require('…/<name>')` clause across all `.ts`/`.tsx`. Test files and `__tests__` directories excluded from sources but counted as importers.

| File | Notes |
|---|---|
| `src/lib/chat/prompt-buttons.ts` | Defines `PromptConversationType` + suggested-prompt copy for the chat welcome screen. Zero importers anywhere. Likely orphaned by the move from `/chat` to `/office` (welcome screen lives in onboarding now). **Confirmed dead.** |

CLAUDE.md flagged `lib/ai/portfolio-analyzer.ts` and `lib/ai/tool-handlers.ts` for verification — both are **absent from the tree** (already removed). No action needed.

All other lib files (~143) have at least one direct importer or are exercised by tests.

### 3.2 New API routes from the recent merge — wiring confirmed

| Route | Wired by |
|---|---|
| `/api/detect-format` | `src/lib/parsers/format-detect-client.ts`, `src/lib/parsers/fingerprint.ts` |
| `/api/extract-pdf-transactions` | `src/app/api/upload/route.ts`, `src/app/api/detect-format/route.ts`, `src/lib/parsers/format-detect-client.ts`, `src/lib/parsers/universal-pdf.ts` |
| `/api/onboarding/save-experiment` | `src/components/onboarding/OnboardingModal.tsx` |

All three are referenced from the frontend or another route handler. ✅

### 3.3 API routes with no fetch caller (orphan candidates)

| Route | Notes |
|---|---|
| `/api/transactions/recategorise` | Zero callers in the codebase. The only string match is the route file itself (`suggest_value_recategorisation` tool name in `MessageList.tsx` is a separate token). Looks dead. |
| `/api/transactions/low-confidence-count` | Zero `fetch()` callers. The only `lowConfidence` references are unrelated local variables in `retake-trigger.ts` and `archetype-prompt.ts`. Looks dead. |
| `/api/nudges/count` | No client fetches `/api/nudges/count`; the inbox client uses `/api/nudges?status=pending&limit=5`. Looks dead. |
| `/api/value-map/regenerate` | Only referenced by sibling `/api/value-map/personal/route.ts` server-to-server. No client caller. Verify intent — may be reachable via server-side flow only. |
| `/api/cron/nudges-weekly` | **Not registered** in `vercel.json`. No caller in code. |
| `/api/cron/nudges-monthly` | **Not registered** in `vercel.json`. The string appears in `lib/nudges/evaluators/value-map-retake.ts` but only as a comment/identifier — no scheduled invocation. |
| `/api/cron/nudges-daily` | **Not registered** in `vercel.json`. Only `daily-bills` is on a Vercel cron. |

`vercel.json` has exactly one cron registered:

```json
{ "path": "/api/cron/daily-bills", "schedule": "0 8 * * *" }
```

If the nudge cron jobs are intended to run, they need a schedule entry — otherwise the entire `lib/nudges/evaluators/*` tree is wired up but never executed.

---

## 4. Components

Component tree is **111 files** under `src/components/`. Search method as in §3.1, but matching against `<Foo` or `from '…/Foo'`.

### 4.1 Orphans

**None detected.** Every component has at least one importer.

The task explicitly noted these as "do NOT flag as dead even if unreferenced (planned future use)": `Breadcrumb`, `TrustTag`, `ConfidenceBadge`, `TrustIndicator`. None of these exist in the tree at all.

### 4.2 BatchSummary (recent merge) — wiring confirmed

`src/components/upload/BatchSummary.tsx` is imported by `UploadWizard.tsx` and `onboarding/beats/UploadBeat.tsx`. ✅

### 4.3 Consolidation candidates

| Pair / group | Notes |
|---|---|
| **`chat/cfo-avatar.tsx` (`CfoAvatar`, 32 LOC) vs `brand/CFOAvatar.tsx` (`CFOAvatar`, 47 LOC)** | Two parallel CFO-avatar components with different casing. `CfoAvatar` is used by 9 files (`value-map/*`, `demo/*`). `CFOAvatar` is used by 8 files (`chat/ChatSheet`, `office/InboxRow`, all `onboarding/*`, `(office)/layout`). Same visual concept, two implementations — pick one. |
| `dashboard/EmptyState.tsx` & `balance-sheet/EmptyState.tsx` | Distinct copy/illustrations per area, but the shell could be a shared primitive. Low priority. |
| `dashboard/TrendChart.tsx`, `dashboard/ValuesTrendChart.tsx`, `balance-sheet/NetWorthTrendChart.tsx` | Three trend charts. Likely diverged for a reason (axes, tooltips), but worth a side-by-side. |
| `office/sections/*Section.tsx` (4) vs `office/dashboards/*Dashboard.tsx` (5 + 2 helpers) | Two parallel layout idioms inside `(office)`. Confirm both are intended. The folder-detail rework (`f96ad12`) introduced the dashboard variant; the section variant predates it. |

No merges urgent for v2 launch — note for backlog.

---

## 5. Tests

There is **no `e2e/` directory**. The audit instructions referenced `e2e/`, but Playwright tests live under `cfos-office/tests/onboarding/` (per the Playwright addendum in `cfos-office/CLAUDE.md`). `.claude/settings.json` deny rules prevent auto-globbing — explicit reads still work.

### 5.1 Specs present

**Persona-driver suite** (`cfos-office/tests/onboarding/personas/`) — 8 personas + 2 helpers:

| Persona | Beats covered |
|---|---|
| `builder-classic` | full onboarding (Builder archetype, investment-heavy) |
| `fortress-saver` | full onboarding (Fortress archetype, foundation-heavy) |
| `truth-teller-balanced` | full onboarding (Truth Teller, balanced) |
| `drifter-expat` | full onboarding (Drifter, EUR, dining/subs) |
| `anchor-debt` | full onboarding (Anchor, debt-burden) |
| `time-saver-expert` | full onboarding (advice-averse high-income) |
| `skip-value-map` | auto-skip path when user skips Value Map |
| `skip-csv-upload` | auto-skip path when user skips CSV upload |

The personas drive the post-signup beats (Welcome → Value Map → Upload → Insight → Archetype → Experiment) via Playwright through `runner/playwright-driver.ts`. Output captures HTML report + screenshots under `tests/onboarding/test-output/`.

**Vitest unit tests** (17 spec files):

- `src/lib/csv/__tests__/transform.test.ts`
- `src/lib/parsers/__tests__/{fingerprint,ofx,qif,universal-csv}.test.ts`
- `src/lib/prediction/__tests__/{confidence,learning-engine,predictor}.test.ts`
- `src/lib/analytics/__tests__/resolve-user-currency.test.ts`
- `src/lib/value-map/__tests__/retake-candidates.test.ts`
- `src/lib/ai/__tests__/context-builder-quotable-facts.test.ts`
- `src/lib/ai/insight-validator.test.ts`
- `src/lib/categorisation/categorisation.test.ts`
- `cfos-office/tests/onboarding/unit/{args,calculate-personality,csv-summariser,preflight}.test.ts`

### 5.2 Critical paths with NO test

- **The redirects** (`next.config.ts` legacy paths → `/office/...`). No test asserts that `/dashboard`, `/chat`, etc. resolve. A regression that breaks one redirect would be silent.
- **The active cron `/api/cron/daily-bills`**. No unit test, no smoke test, no scheduled-job assertion.
- **The dashboard data routes** (`/api/dashboard/summary`, `/api/dashboard/trends`) — heavily called (10 + 4 importers respectively) but no API-level test.
- **`/api/chat`** — the core conversational route, no test coverage.
- **The post-merge orphan-suspect routes** (`/api/transactions/recategorise`, `/api/nudges/count`) — no test, no caller. Either build a caller or delete.

The persona suite gates onboarding only. Anything post-onboarding (chat, dashboard, bills, scenarios, balance-sheet) has no E2E coverage. CI test signal: none — `LESSONS-LEARNED` notes GitHub Actions has no runs configured.

---

## 6. Supabase

- **Latest migration in repo:** `036_bank_format_templates.sql`
- **Migrations 031–036 present:** **yes**, all six (`031_correction_signals.sql`, `032_prediction_metrics_rpc.sql`, `033_value_map_personal_retake.sql`, `034_transfers_category.sql`, `035_dedupe_hash_unique.sql`, `036_bank_format_templates.sql`).
- **Drift vs prod (known):** prod is at `030`. Repo has `031`–`036` queued. Apply manually Friday per the LESSONS-LEARNED entry.
- **Uncommitted migration drafts:** none (`git status` is clean).
- This session did **not** push, apply, or write any migration.

The `/api/detect-format` route degrades gracefully when `bank_format_templates` is unhealthy (`fcc3937`), so detection still works pre-`036`. Full functionality of the universal parser requires `036` applied.

---

## 7. Dependencies

`package.json` runtime dependencies (22 packages). Static + dynamic-import grep:

| Status | Package |
|---|---|
| Used (static + dynamic) | `@ai-sdk/amazon-bedrock`, `@ai-sdk/react`, `@supabase/ssr`, `@supabase/supabase-js`, `@vercel/analytics`, `ai`, `clsx`, `html2canvas` *(dynamic)*, `lucide-react`, `next`, `papaparse`, `pdf-parse`, `react`, `react-markdown`, `recharts`, `remark-gfm`, `swr`, `tailwind-merge`, `xlsx`, `zod` |
| Type-only | `@types/papaparse` (provides types for `papaparse`) |
| Peer / framework-implicit | `react-dom` (no direct import; required by Next.js / React renderer) |

### Zero-import packages

**None to remove.** `react-dom` is a framework peer; `@types/papaparse` is consumed via TS resolution, not import. No truly orphan runtime dependency.

DevDeps not audited per task scope; `playwright`, `vitest`, `tsx`, `eslint`, `tailwindcss` are all clearly in use via scripts.

---

## 8. Env vars

### Referenced in code

| Env var | Used in |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | supabase clients, proxy |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | supabase clients, proxy |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side service client |
| `AWS_REGION` | `lib/ai/provider.ts` |
| `AWS_ACCESS_KEY_ID` | `lib/ai/provider.ts` |
| `AWS_SECRET_ACCESS_KEY` | `lib/ai/provider.ts` |
| `NEXT_PUBLIC_APP_URL` | various (cookies, redirects) |
| `BEDROCK_CLAUDE_MODEL` | `lib/ai/provider.ts` (Sonnet routing) |
| `BEDROCK_CLAUDE_UTILITY_MODEL` | `lib/ai/provider.ts` (Haiku routing) |
| `BEDROCK_OPUS_MODEL` | `app/api/value-map/reveal/route.ts` |
| `BRAVE_SEARCH_API_KEY` | `lib/bills/brave-search.ts` |
| `CRON_SECRET` | all four `app/api/cron/*` routes (auth gate) |
| `RESEND_API_KEY` | `lib/alerts/notify.ts` |
| `ALERT_EMAIL` | `lib/alerts/notify.ts` |
| `ALERT_WEBHOOK_URL` | `lib/alerts/notify.ts` |

### Documented in `cfos-office/CLAUDE.md`

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `NEXT_PUBLIC_APP_URL`, `BEDROCK_CLAUDE_MODEL`, `BEDROCK_CLAUDE_UTILITY_MODEL`.

### Drift (referenced but undocumented)

| Env var | Risk |
|---|---|
| `BEDROCK_OPUS_MODEL` | Drives Opus selection on the Value Map reveal route. If unset, behaviour depends on the fallback in that route — verify Vercel env. |
| `BRAVE_SEARCH_API_KEY` | Bill-alternatives search will silently fail without this. |
| `CRON_SECRET` | Cron auth header. If unset in Vercel, all cron routes 401. |
| `RESEND_API_KEY`, `ALERT_EMAIL`, `ALERT_WEBHOOK_URL` | Alerting pipeline is silent on missing config. Need confirmation that production has these (or that `lib/alerts/notify.ts` no-ops cleanly). |

Recommendation: add the six undocumented vars to `cfos-office/CLAUDE.md` before launch, and verify each in Vercel.

---

## 9. Top 5 risks for v2 launch

1. **Production Supabase migration debt.** Prod is at `030`; repo ships `031`–`036`. Anything depending on `correction_signals`, `prediction_metrics_rpc`, the personal-retake tables, or `bank_format_templates` will silently misbehave until Lewis applies them on Friday. The `detect-format` route already has a graceful degrade (`fcc3937`); other routes may not.
2. **Three nudge cron jobs are wired but never scheduled.** `/api/cron/nudges-daily`, `/api/cron/nudges-weekly`, `/api/cron/nudges-monthly` exist with full evaluator chains but are absent from `vercel.json`. Either the entire nudge engine is dormant, or someone forgot to register the schedules. **Decide before launch** — silent dormancy of a "smart prompts" feature is worse than no feature.
3. **Zero CI signal.** The 8-persona Playwright suite + 17 unit specs only run on demand on a developer's laptop with staging Supabase + Bedrock creds. Branch was merged on local `npm run build` alone (per LESSONS-LEARNED 2026-04-29). A regression in chat, dashboard summary, or cron auth ships with no automated tripwire.
4. **Orphan API routes risk policy/security drift.** `/api/transactions/recategorise`, `/api/transactions/low-confidence-count`, `/api/nudges/count`, and possibly `/api/value-map/regenerate` are reachable but have no caller. They still run RLS and tool-execution code paths; if a prior auth assumption changed they could leak. **Either delete or write a caller and a test.**
5. **Undocumented env vars.** Six vars (`BEDROCK_OPUS_MODEL`, `BRAVE_SEARCH_API_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, `ALERT_EMAIL`, `ALERT_WEBHOOK_URL`) are read by the code but absent from `cfos-office/CLAUDE.md`. If any are missing in Vercel production, failures will be silent (Brave search returns empty, alerts get swallowed, crons 401). Audit Vercel env before Friday.

---

## Appendix — counts at a glance

- Routes/pages/handlers under `cfos-office/src/app/`: **91** (57 API)
- Lib files under `cfos-office/src/lib/`: **143**
- Components under `cfos-office/src/components/`: **111**
- Vitest specs: **17**
- Persona-driver onboarding tests: **8 personas**
- Supabase migrations in repo: **036** (latest)
- Runtime dependencies: **22**
- Distinct env vars referenced: **15**
