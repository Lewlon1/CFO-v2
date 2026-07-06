# M1 — Models feature (property decision modeller): handoff

**Branch:** `worktree-models-feature-m1` (isolated git worktree at `.claude/worktrees/models-feature-m1`)
**Plan:** [`cfos-office/docs/superpowers/plans/2026-07-02-models-property-decision.md`](../superpowers/plans/2026-07-02-models-property-decision.md)
**Status:** All 21 required tasks (stop-line and above) complete, reviewed, and committed. Not yet merged to `main`.

## What shipped

- **Migration** (`supabase/migrations/076_models_feature.sql`) — `user_financial_profile` + `model_runs` tables, RLS enabled, applied to Supabase staging (`qlbhvlssksnrhsleadzn`) and independently RLS-verified twice with two different real user pairs. Production (`iccelmjenljanqrhhzdv`) was never contacted this session. (Renumbered from `073_` on the v2.9 merge to avoid a filename collision with `073_secure_export_user_data.sql`.)
- **Deterministic engine** (`lib/models/engine/property.ts`) — `resolveValues`, `saleNet`, `runModel` (rent / invest / cash / redeploy scenarios), `flipPoint` bisection. 17 tests, all pinned against a hand-verified golden fixture and independently re-derived by reviewers from scratch (not just re-run).
- **Registry + resolver** — `lib/models/registry.ts` (23-slot closed variable set, relevance predicates), `lib/models/marketDefaults.ts`, `lib/models/resolve.ts` (three-tier `run > profile > market` precedence, 4 tests).
- **API routes** — `POST /api/models/runs` (create), `PATCH /api/models/runs/[id]` (ledger edit), `POST /api/models/interviewer` (Bedrock-backed LLM extraction, zod-validated, closed-world slot-id filtering, retry-once-then-apologise on unparseable output).
- **UI** — `/office/models` (list + "New model"), `/office/models/[runId]` (three-panel Interview / Ledger / Verdict, mobile tabs / desktop grid), `AssumptionsLedger`, `InterviewPanel`, `VerdictPanel` + `FlipPoints`. Wired into the office home page as a non-accented `ModelsRow` (the four `folderColors` cards are untouched) and into `NavigationBar`'s breadcrumb labels.
- **Verification:** `npm run test` — 1175/1175 passing (up from a 1154 baseline). `npm run typecheck` / `tsc --noEmit` — clean project-wide. `npm run build` — succeeds, `/office/models` and `/office/models/[runId]` correctly listed alongside every sibling office route.

## What's NOT done (below the plan's stop line — parking lot, not started)

- Task 22 — escape hatch ("anything unusual about your situation" → caveat, not a new variable).
- Task 23 — profile settings surface (`/office/models/profile` or similar, to view/edit `user_financial_profile`).
- Everything in the brief's original "parking lot": `market_defaults` DB table + refresh workflow, a second decision type, multi-currency display, PDF export, side-by-side run comparison.

## One open verification gap — please read before assuming this "just works" in the browser

Every automated check is green (tests, typecheck, production build). What I could **not** complete in this session is an actual interactive click-through: `next dev` (Turbopack) in this sandboxed `.claude` worktree 404s specifically on `/office/models` — every other `(office)/office/<slug>` route serves fine on the same dev server, and `next build` correctly compiles and lists the models routes identically to its siblings. I diagnosed this at length (cleared `.next`, restarted the dev server twice, confirmed via production build, confirmed no sibling route shares the "static `page.tsx` + `[dynamicSegment]` sibling folder" shape that `/office/models` + `/office/models/[runId]` is the first to use in this app) and I'm confident it's a dev-tooling/sandbox artifact, not a defect in the shipped code — but I have not personally watched the feature work end-to-end in a browser. **Please run `npm run dev` locally (outside this worktree's sandbox) and walk the checklist below before trusting this is fully done.**

## Manual testing checklist

1. Sign in, go to Office home → confirm a "Models" row appears below the four folder cards (no accent colour, matches the Inbox row's visual style).
2. Tap it → `/office/models` (empty state if no runs yet) → tap "New model" → redirected to `/office/models/[id]`.
3. Answer the interview questions in order (property value, purchase price, mortgage, ownership share, rent, service costs, horizon) — the ledger should fill in live with "you" provenance chips.
4. Say "use the default" for one question → confirm it lands with a "market" chip.
5. Tap a ledger row, edit a number, press Enter → confirm it commits once (not twice) and shows "edited". Try Escape on another row → confirm it discards without saving.
6. Once required fields are filled, check the Verdict panel: ranked scenarios (rent/invest/cash), sale-today figure + CGT, year-1 rent cash flow, a flip point card, and the caveats/disclaimer box. Scan for any "you should…" language — there should be none.
7. Answer "yes" to "Would selling fund another property purchase?", give a new property price and current rent paid → confirm a 4th "Sell & redeploy into a new home" option appears in the ranking.
8. Refresh mid-interview and after completion → confirm ledger, chat history, and verdict all survive.
9. Sign in as a second account → confirm you cannot see or reach the first account's run (try navigating directly to its `/office/models/[id]` URL — should 404, not show data).

## Proposed M2 scope

- Escape hatch (Task 22) and profile settings surface (Task 23), promoted from parking lot to real tasks once M1 is confirmed working end-to-end.
- The origin-stats query to start validating the baseline-criteria hypothesis (locked design decision #5): a SQL query over `model_runs.assumptions` grouping by slot id + origin, to see which of the 5 profile-tier candidate fields actually get stated/edited often enough at run-level to justify promotion, versus staying market-default-only.
- Investigate the dev-server 404 properly (file an internal note / retest once this worktree's changes land on `main` and a normal `npm run dev` is run outside the sandbox) — if it turns out to be a genuine Turbopack bug with this route shape, worth a minimal repro to file upstream or work around.
- `market_defaults` DB table + refresh workflow (currently versioned in code only, as designed for M1).
- Second decision type — only after the origin-stats query above gives real signal on which fields are genuinely profile-stable.
