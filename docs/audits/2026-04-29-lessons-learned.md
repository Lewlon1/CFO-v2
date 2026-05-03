# Lessons Learned

## 2026-04-29 — Beta v2 branch unification

**Build:** PASS (`npm run build` on `claude/fix-upload-cashflow-bug-lsMII`, EXIT=0, 66/66 static pages generated).

**CI test signal:** None. The GitHub Actions tab shows no runs for this repository, so the branch was merged on the strength of the local build alone. The Playwright onboarding smoke harness (`tests/onboarding/`) refused to run in this environment — preflight requires staging Supabase + AWS Bedrock credentials and there is no `.env.local` checked in. **Flag for post-v2:** stand up CI (build + unit tests at minimum, ideally the onboarding smoke harness against staging on push) so future merges have an automated signal.

**Fast-forward:** `claude/prepare-beta-v2-O1zeV` advanced from `f96ad12` → `b5826cc` via `git merge --ff-only claude/fix-upload-cashflow-bug-lsMII`. 15 commits brought in (universal parser refactor, onboarding deck-aligned copy, sign-convention fix, XLSX client-side route, multi-file upload error surfacing, geo/MoM analytics gating, First Meeting narrative guard, parser diagnostic CLI). Pushed to `origin/claude/prepare-beta-v2-O1zeV`; local matches remote (0/0). Note: the original task description named `64ec063` as the expected tip — that hash is 5 commits below the actual tip of D and was not used.

**PR #33:** Closed with comment "Superseded by unified beta-v2 branch (claude/prepare-beta-v2-O1zeV). New release PR will open Friday after smoke test." (https://github.com/Lewlon1/CFO-v2/pull/33).

**Migration debt:** Production Supabase is at migration `030`. Repo contains migrations `031`–`036` pending manual apply on Friday by Lewis:
- `031_correction_signals.sql`
- `032_prediction_metrics_rpc.sql`
- `033_value_map_personal_retake.sql`
- `034_transfers_category.sql`
- `035_dedupe_hash_unique.sql`
- `036_bank_format_templates.sql` — required by the new universal parser's `detect-format` route; route already degrades gracefully if the table is unhealthy (`fcc3937`), but full functionality needs this migration applied.

No migrations applied this session. No new release PR opened — that is Friday's task.

### Addendum — `48ef24f` cherry-pick

After the fast-forward, `claude/fix-onboarding-issues-ifwJV` still held one commit not on `prepare-beta-v2-O1zeV` — `48ef24f` (final beat CTA clarification + Unsure button surfaced earlier, 4 files: `OnboardingModal.tsx`, `WelcomeBeat.tsx`, `value-map-card.tsx`, `playwright-driver.ts`). Branches had diverged (cashflow chain on prepare-beta-v2 vs fix-onboarding-issues-ifwJV both branched from `32f2492`), so fast-forward wasn't possible. Cherry-picked cleanly — auto-merged `OnboardingModal.tsx` with no manual resolution. New commit on `prepare-beta-v2-O1zeV`: `ba1d6f2`.

## Session A0 — 2026-05-01

**Goal:** Branch state snapshot for v2 cleanup planning, against unified branch `claude/prepare-beta-v2-O1zeV`. Read-only — no source code modified.

**Outcome:** Branch is **118 commits ahead** of `origin/main` (425 files changed, +39,068/−17,475). The big diff is structural — `cfos-office/` reorganisation plus the orphan-`/src/` cleanup — not behaviour. The active code is healthy: only **one** lib orphan (`src/lib/chat/prompt-buttons.ts`, leftover from the `/chat` → `/office` move), zero component orphans, and zero unused runtime dependencies. The CFO-avatar duplication (`chat/cfo-avatar.tsx` vs `brand/CFOAvatar.tsx`) is the most visible inconsistency. `BatchSummary`, `/api/detect-format`, `/api/extract-pdf-transactions`, `/api/onboarding/save-experiment` (recent-merge additions) are all wired up. Migrations 031–036 are present in the repo as expected; production still at 030. Full report: `docs/V2-AUDIT.md`.

**Surprises:**
- Three nudge cron routes exist (`/api/cron/nudges-daily`, `nudges-weekly`, `nudges-monthly`) but **none** are registered in `vercel.json` — only `daily-bills` is. Either the nudge engine is dormant in production or schedules need adding before launch.
- Four API routes have **no client caller** anywhere in the codebase: `/api/transactions/recategorise`, `/api/transactions/low-confidence-count`, `/api/nudges/count`, and `/api/value-map/regenerate` (the last is server-to-server only).
- Six env vars (`BEDROCK_OPUS_MODEL`, `BRAVE_SEARCH_API_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, `ALERT_EMAIL`, `ALERT_WEBHOOK_URL`) are read by the code but undocumented in `cfos-office/CLAUDE.md`.
- Audit was performed on `claude/audit-v2-branch-state-UoHld` (per session branch policy), which sat at the same commit (`a866d24`) as `claude/prepare-beta-v2-O1zeV`. Findings apply to the v2 branch unchanged.

**For A1/A3:**
- **A1** (cleanup): delete `src/lib/chat/prompt-buttons.ts`; decide on the four orphan API routes (delete or wire); pick one CFO-avatar implementation and remove the other; document the six missing env vars; consider consolidating `office/sections/*` and `office/dashboards/*` (post-launch).
- **A3** (cron + ops): decide whether the nudge engine is shipping in v2 — if yes, register the three cron schedules in `vercel.json` and verify `CRON_SECRET` in Vercel; if no, gate the evaluator wiring behind a feature flag or remove. Also: add CI (build + Vitest at minimum, ideally the persona-driver suite against staging) so the next merge has automated signal — currently zero CI runs configured for the repo.

## Session A1 — 2026-05-01

**Goal:** Dead-code verification, orphan API check, cron registration plan. Read-only on source. Output: `docs/DEAD-CODE-AUDIT.md` with C1 PR scope.

**Outcome:**
- **Tier 1 dead:** 1 (`src/lib/chat/prompt-buttons.ts`, 130 LOC, residue of `/chat` → `/office`).
- **Orphan API verdicts:** 3 DEAD / 0 WIRED / 1 FLAG-FOR-LEWIS.
  - DEAD: `/api/transactions/recategorise` (UI uses `/api/corrections/signal` instead), `/api/transactions/low-confidence-count` (no consumer), `/api/nudges/count` (inbox derives count from list).
  - FLAG: `/api/value-map/regenerate` — orphan today but the `'manual'` reason argument and the `pendingRegen` polling UI suggest it's a deliberate seam for a planned "Regenerate my archetype" button. Lewis to decide delete vs hold.
- **Cron plan:** 3 nudge routes proposed for `vercel.json` at `0 7 * * *` (daily), `0 8 * * 1` (Mon weekly), `0 8 1 * *` (1st-of-month). All four cron handlers (incl. existing `daily-bills`) already validate `CRON_SECRET` correctly.
- **CRON_SECRET gaps:** **0**.
- **Phase 0 fold-back:** A0 docs (`df90c91`) fast-forwarded into `claude/prepare-beta-v2-O1zeV` and pushed; tip is now `df90c91`.

**Surprises:**
- `/api/transactions/recategorise` is a *substantial* endpoint (rule creation, both category dimensions) but every transaction-edit UI in the office layout writes to `/api/corrections/signal` instead. Either an architecture pivot left it stranded, or the planned bulk/admin recategorise UI was never built.
- All four cron route handlers already enforce `CRON_SECRET` cleanly — registering the three nudge routes is purely a `vercel.json` change with no security implications.
- The existing `cfos-office/docs/cleanup/track-3-dead-code.md` already independently flagged `prompt-buttons.ts` as a "binary dead vs. alive" candidate via Knip — the A0 finding aligns.

**For C1:**
- **Commit ordering:** (1) delete `prompt-buttons.ts`; (2) delete the 3 confirmed-DEAD API routes (+ optional 4th if Lewis confirms `value-map/regenerate`); (3) register the 3 nudge cron entries in `vercel.json` and strip the `// TODO: Not registered` comment headers in each handler; (4) document the 6 undocumented env vars in `cfos-office/CLAUDE.md`. ~165 LOC removed, ~12 LOC added — well under 500.
- **Needs Lewis input:** verdict on `/api/value-map/regenerate`; sanity-check on UTC schedule choices; Vercel cron vs Supabase pg_cron architectural call (`DEFERRED.md` flagged this as open).

## Session A3 — 2026-05-01

**Goal:** Component consolidation audit. CFO avatar verification + broader pattern hunt for C2 extractions. Read-only on source. Output: `docs/COMPONENT-CONSOLIDATION.md`.

**Outcome:**
- **CFO avatar consolidation:** **VERIFIED** — but with a wrinkle. The two files are not "two copies of the same component"; they're **two visually-different artefacts** that overlap in role. `chat/cfo-avatar.tsx` (`CfoAvatar`) renders a £ glyph in a coloured square; `brand/CFOAvatar.tsx` (`CFOAvatar`) renders a full SVG mascot. Both are alive because the office redesign migrated the new mascot into office/onboarding/inbox surfaces but left the value-map and demo flows on the old £ glyph. The consolidation is real and worthwhile, but it's a *visual* migration (placeholder → polished), not a *code* dedupe — Lewis must approve the visual change in value-map/demo before merge, and the mascot SVG may need a simplified small variant (24px) check.
- **Recommended C2 extractions:** **3** total commits:
  1. CFO avatar consolidation (anchor) — ~60 LOC removed.
  2. Shared `formatCurrency` helper for the office dashboards (9 identical copies → 1 helper) — ~45 LOC removed, zero behaviour change.
  3. *(Optional)* `DashboardEmptyState` primitive replacing inline `EmptyCashFlow`/`EmptyNetWorth` — ~10 LOC removed, consistency win.
- **Estimated impact:** ~115 LOC removed, ~50 added — ~−65 net, well under 500.
- **Deferred:** folder-shell wrapper, trend-chart consolidation, wider currency-format unification across chat/trips, full EmptyState consolidation across surfaces.

**Surprises:**
- **Avatar count was 23 call sites, not 17.** A0 counted importer files (9 + 8 = 17) but several files have multiple usages (`value-map-flow.tsx` × 3, `retake-impact.tsx` × 3, `OnboardingModal.tsx` × 2, `CfoThinking.tsx` × 2). Total call sites: 14 (`CfoAvatar`) + 9 (`CFOAvatar`) = 23.
- **`formatCurrency` is a much bigger duplication than expected.** Found **17** separate definitions across the codebase, falling into 3 distinct implementation idioms with **different visible output** (2-decimal Intl, 0-decimal Intl, manual symbol+toLocaleString). The 2-decimal vs 0-decimal split is intentional (legacy dashboard surface vs new office surface), so the right C2 scope is just deduping the 9 office-tree copies — pure mechanical zero-risk extraction.
- **The shell-level extractions are already done.** `Briefing`, `DetailHeader`, `DrillDownRow` are all shared primitives in active use across all four office dashboards. The folder-page comparison matrix turned up far less untapped duplication than expected — the codebase is in better shape than the pure import counts suggested.
- **Only one `status="thinking"` site** exists across the 14 `CfoAvatar` calls (in `demo-reveal.tsx`). Migration is straightforward — wrap in `<span className="animate-pulse">` or use the existing `CfoThinking` wrapper.

**For C2:**
- **Sequence:** start with the zero-risk Commits 2+3 (formatCurrency dedupe, DashboardEmptyState). They're pure extraction with no visual change. Land them first.
- **Avatar commit goes last** because it requires a visual QA pass (mascot at 24px in value-map cards). If the small-size SVG doesn't read well, hold the avatar commit and add a `variant="compact"` prop or keep the `CfoAvatar` file for that one size class.
- **Lewis decisions before merge:**
  - Visual sign-off on the mascot replacing the £ glyph in value-map and demo flows.
  - Whether the mascot SVG needs a simplified compact variant for `size={24}`.
  - Whether to bundle `formatMonthShort` (2-copy duplicate) into the same C2 helper file as `formatCurrency`.
- **No Lewis input needed** for Commits 2 and 3 — both produce byte-identical UI.

## Session C1 — 2026-05-01
**Goal:** Execute v2 cleanup PR per A1 recommendations.
**Outcome:** 4 commits landed on `claude/prepare-beta-v2-O1zeV`. ~−145 LOC net (266 deletions, 12 additions, 12 doc lines). `prompt-buttons.ts` deleted, 3 orphan API routes deleted (`recategorise`, `low-confidence-count`, `nudges/count`), 3 nudge cron routes registered in `vercel.json` with TODO headers stripped, 6 env vars documented in `cfos-office/CLAUDE.md`. `npm run build` passes (63 routes, compiled in 24.2s). `/api/value-map/regenerate` preserved per Lewis (Session 30 seam).
**Surprises:**
- Repo uses **npm**, not pnpm — `package-lock.json` is the canonical lockfile and there is no `pnpm-lock.yaml` or `packageManager` field. A `pnpm install` builds an incorrect dep tree (pdfjs-dist resolves transitively under npm but is not in `package.json`), so the build fails. Use `npm ci && npm run build` for verification.
- The TODO headers on the three nudge cron handlers were 2-line comment blocks (TODO line + Edge Function/DEFERRED.md continuation), not single lines. Removed the full block in each file.
**For Friday smoke test:**
- Cron routes won't fire until next scheduled UTC tick — `nudges-daily` 07:00, `nudges-weekly` 08:00 Mon, `nudges-monthly` 08:00 day 1. Worth confirming on Vercel dashboard that the schedules registered after deploy.
- Env-var doc commit is doc-only — no runtime impact, but Lewis should confirm the six values are set in Vercel project envs before any production deploy.
- `pdfjs-dist` is imported by `cfos-office/src/lib/parsers/universal-pdf.ts` but not declared in `cfos-office/package.json`. Pre-existing on v2 tip; only npm tolerates it (transitive resolution). Worth adding as an explicit dep for hygiene.

## Session C2a — 2026-05-01

**Goal:** Zero-risk component extractions per A3 (formatCurrencyRounded helper, DashboardEmptyState primitive).

**Outcome:** 2 commits landed on `claude/extract-office-utils-WFpBD` (which is in sync with `claude/prepare-beta-v2-O1zeV` at C1's tip). Net `-64` LOC across the two commits (10 files modified + 2 created in C1; 3 files modified + 1 created in C2). `formatCurrencyRounded` + `formatMonthShort` now live at `cfos-office/src/lib/utils/format-currency-rounded.ts` (replaces 9 `formatCurrency` copies and 2 `formatMonthShort` copies). `DashboardEmptyState` now lives at `cfos-office/src/components/office/dashboards/DashboardEmptyState.tsx` (replaces `EmptyCashFlow` and `EmptyNetWorth`). `npm run build` passes (63 routes, 15.9s). Zero visual change.

**Surprises:**
- **Branch designation conflict.** Harness asked for `claude/extract-office-utils-WFpBD`; task spec said `claude/prepare-beta-v2-O1zeV`. The two branches were already at the same commit (e617173) at session start, so the work landed on the harness branch with no functional difference — but Lewis will need to merge `claude/extract-office-utils-WFpBD` into `claude/prepare-beta-v2-O1zeV` (or fast-forward, since the former is strictly ahead) before the Friday release PR.
- **`formatMonthShort` semantics in the spec draft would have changed output.** The task draft used `new Date(string).toLocaleString(...)`, but the existing inline implementation manually parses `YYYY-MM` with `new Date(y, m-1, 1)` (local timezone). The two diverge in non-UK timezones because the ISO string parser interprets bare `YYYY-MM` as UTC. Preserved the existing semantics in the helper to honour the "byte-identical output" guarantee. Updated the helper signature to `(month: string)` rather than `(date: Date | string)`.
- **JSX entities don't decode in string props.** Initial migration of `EmptyCashFlow` passed `body="...what&apos;s..."` and `actionLabel="Upload &rarr;"` as string props — these would render the literal entity strings, not `'` and `→`. Fixed by passing actual unicode characters. Worth flagging in any future "extract inline JSX" sessions.
- **Confirmed C1's `pnpm`-vs-`npm` finding.** First build attempt with `pnpm build` failed on the same `pdfjs-dist/build/pdf.worker.mjs` resolution error C1 documented. Switched to `npm ci && npm run build` and it passed cleanly. Worth resurfacing this in `cfos-office/CLAUDE.md` if it bites a third session.
- **`Link` import in `NetWorthDashboard.tsx` became unused** after extracting `EmptyNetWorth` (the only `<Link>` was in the empty-state CTA). Removed it; tsc would have flagged the unused import otherwise.

**For C2b:**
- Avatar migration is the next move. Visual change involved — Lewis declined a design pass; trusts mascot at 24px.
- Recommend keeping the same branch (`claude/extract-office-utils-WFpBD`) so Lewis can pick up all C2 work in a single fast-forward.

## Session C1.5 — 2026-05-01

**Goal:** Declare `pdfjs-dist` as explicit direct dep + codify npm as canonical package manager.

**Outcome:** `pdfjs-dist@5.4.296` pinned exact in `cfos-office/package.json`. `cfos-office/CLAUDE.md` gains a "Package manager" subsection at the top of "Tech Stack Details" stating npm-only. `npm ci` reproducible; `npm run build` clean (63 routes, 23.7s). Stayed on `claude/extract-office-utils-WFpBD` (the C2a branch); folds into v2 alongside C2a's three commits.

**Surprises:**
- **Single transitive resolution.** `npm ls pdfjs-dist` returned exactly one version (`5.4.296` via `pdf-parse@2.4.5`), so no Lewis decision needed. Pinned to that exact version with `--save-exact`.
- **Lockfile diff was minimal.** Adding the direct dep added one line to `package-lock.json` and one to `package.json`. npm did not restructure the tree because `pdfjs-dist` was already at the top of resolution under transitive parenting.
- **`npm install` flagged 3 vulnerabilities (1 moderate, 2 high)** in transitive deps — pre-existing, unrelated to this change. Did not run `npm audit fix --force`; that's a separate concern.

**For Friday:**
- Release PR will pick this up alongside C1 and C2a in the same v2 fast-forward.
- The npm-vs-pnpm constraint is now codified in `cfos-office/CLAUDE.md`. Two prior sessions stumbled on it; a third shouldn't.

## Session C2b — 2026-05-01

**Goal:** Migrate `CfoAvatar` (£ glyph) call sites to brand `CFOAvatar` (mascot). Delete orphan.

**Outcome:** All call sites migrated. `cfos-office/src/components/chat/cfo-avatar.tsx` deleted. Typecheck and build pass (63 routes, 17.5s). Net `-26 LOC` across 10 files (1 deletion, 9 modifications). Stayed on `claude/extract-office-utils-WFpBD` — branch now carries C2a + C1.5 + C2b for Friday's v2 fast-forward.

**Surprises:**
- **13 JSX call sites, not 14.** A3's audit said 14 (per `LESSONS-LEARNED.md` Session A3). Re-counted via grep at this session's tip and got 13: value-map-flow ×3, retake-impact ×3, plus 7 other single-site files. Possibly a single site was removed in a recent commit between A3 and now, or A3 was off-by-one. The migration completed cleanly either way; the typecheck would have caught a missed site.
- **Sweep 2 returned two false positives.** The `size="sm"` grep across `value-map/` and `demo/` flagged two `Button size="sm"` instances (`value-map-card.tsx:512`, `demo-card.tsx:451`) that have nothing to do with the avatar. Worth noting for future spec authors: a `size=` sweep needs to scope to JSX tag context, not just the prop string.
- **No `status="thinking"` collateral.** Only one site used `status="thinking"` (in `demo-reveal.tsx`) and it was already explicitly flagged. Confirmed via post-migration sweep.

**Visual note:** Lewis declined a pre-merge design pass; trusts mascot at 24px. Watch the value-map cards (small avatar in `value-map-card`, `value-map-summary`, `cut-or-keep`, `one-thing`, `demo-card`, `demo-reveal`) and demo-reveal's pulse-wrapped variant during Friday smoke test.

**For C2c (if any):**
- `CfoThinking` already exists at `components/brand/` and is the correct destination if `demo-reveal`'s pulse-wrap pattern needs to consolidate further. A3 deferred that — out of scope for v2.
- The brand directory's casing convention (`CFOAvatar`, `CfoThinking`) is inconsistent. Worth flagging for a separate cleanup pass if anyone wants stylistic uniformity.
