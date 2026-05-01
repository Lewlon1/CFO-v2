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
