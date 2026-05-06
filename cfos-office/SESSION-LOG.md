# Session Log

Running log of session-bounded work for the CFO's Office project. Each
entry captures: branch, scope, what was observed, what was changed,
and follow-ups — so the next session can pick up cold.

Sessions A0–C2b are summarised below as pointers; the long-form per-session
lessons live in `docs/audits/2026-04-29-lessons-learned.md`.

---

## Session 27 — Documentation cleanup — 2026-05-03

**Branch:** `claude/prepare-beta-v2-O1zeV`
**Scope:** Tidy non-code docs across the repo. Read-only on source; only `.md` files touched (plus three orphan code files in repo root deleted).

**Phase 1 (commit `905cbf3`):** Structural cleanup. Deleted 3 orphan code files in root (`capability-assessment.jsx`, `Database Schema v0.sql`, `003_category_system.sql` — the live migration of the same name lives in `cfos-office/supabase/migrations/`). Archived 3 Apr 3 pre-implementation specs to `docs/archive/2026-04-pre-implementation/`. Archived superseded `AUDIT-REPORT.md` (Apr 13) to `docs/archive/audits/2026-04-13-pre-v2-audit.md`. Archived root `docs/superpowers/` (CSV engine spec, superseded by Apr 24 parser refactor) to `docs/archive/superpowers/`. Moved Session 25 cleanup tracks to `docs/archive/cleanup-session25/` (Session 25 work landed in `e6f5a3c`, so the tracks are historical now). Reorganised current docs into `docs/audits/` (May 1 trio + Apr 29 lessons, dated filenames) and `docs/decisions/` (`wasted-data-points.md`). Added a brief `README.md` at repo root.

**Phase 2 (commit `fe19f46`):** Reconciled the two diverged `CLAUDE.md` files into one canonical version at the repo root. Merged five additive sections (Repo layout, Package manager, Model Routing, Prompt Caching, Mobile-First Design) and refreshed two (Environment Variables, CFO Persona). Deleted `cfos-office/CLAUDE.md`.

**Phase 3 (this commit):** Refreshed living registries — `TECH_DEBT.md` (4 items moved to Resolved: #17, #20, #28, #34; #31 line-count updated 1316→2012), `DEFERRED.md` (multi-doc upload + cron registration marked resolved), `docs/decisions/wasted-data-points.md` (3 of 4 monthly-snapshot fields wired). This SESSION-LOG entry added.

**Follow-ups:**
- Set up CI (build + Vitest) per Lessons Learned 2026-04-29 — still flagged.
- Migration debt `031`–`036` on production Supabase — Lewis-applied on Friday per Lessons Learned.

---

## Sessions C1 / C1.5 / C2a / C2b — V2 cleanup execution — 2026-05-01

Pointer entries — full lesson notes in `docs/audits/2026-04-29-lessons-learned.md`.

**C1 — A1 cleanup PR.** 4 commits, ~−145 LOC net. Deleted `prompt-buttons.ts` and 3 orphan API routes (`/api/transactions/recategorise`, `/api/transactions/low-confidence-count`, `/api/nudges/count`). Registered the 3 nudge cron routes in `vercel.json` and stripped the TODO headers (commit `4b32367`). Documented 6 previously-undocumented env vars in `CLAUDE.md`. Surprise: repo is npm-only, `pnpm install` fails on `pdfjs-dist` resolution.

**C1.5 — Package manager hygiene.** Pinned `pdfjs-dist@5.4.296` as an explicit direct dep (was transitive-only via `pdf-parse`). Codified npm-as-canonical in `CLAUDE.md` so future sessions don't stumble on the pnpm trap.

**C2a — A3 zero-risk extractions.** Two helpers: `formatCurrencyRounded` + `formatMonthShort` at `src/lib/utils/format-currency-rounded.ts` (replacing 9 `formatCurrency` copies + 2 `formatMonthShort` copies in office dashboards); `DashboardEmptyState` primitive replacing inline `EmptyCashFlow` / `EmptyNetWorth`. Net −64 LOC, byte-identical UI.

**C2b — CFO avatar consolidation.** All call sites migrated from `chat/cfo-avatar` (£ glyph) to `brand/CFOAvatar` (mascot SVG). 13 JSX call sites across 9 files; orphan deleted. Net −26 LOC. Visual change in value-map and demo flows — Lewis declined a pre-merge design pass; Friday smoke test should eyeball the mascot at 24px.

---

## Session 26 — V2 audit (A0 / A1 / A3) — 2026-05-01

Pointer entries — full audit reports in `docs/audits/2026-05-01-{v2-audit,dead-code,component-consolidation}.md`; per-session lessons in `docs/audits/2026-04-29-lessons-learned.md`.

**A0 — Branch state snapshot.** 118 commits ahead of `origin/main`, 425 files changed. Active code is healthy (1 lib orphan, 0 component orphans, 0 unused runtime deps). Most visible inconsistency: CFO-avatar duplication. Three nudge cron routes exist but were not registered in `vercel.json` (resolved by C1). Six env vars read by code but undocumented (resolved by C1). Output: `docs/audits/2026-05-01-v2-audit.md`.

**A1 — Dead-code verification + cron plan.** Tier 1 dead: 1 (`prompt-buttons.ts`). Orphan API routes: 3 DEAD, 1 FLAG-FOR-LEWIS (`/api/value-map/regenerate` — kept as a "Regenerate my archetype" seam per Lewis). Cron schedules proposed (07:00 daily, 08:00 Mon weekly, 08:00 first-of-month). All four cron handlers already enforce `CRON_SECRET`. Output: `docs/audits/2026-05-01-dead-code.md`.

**A3 — Component consolidation.** CFO avatar duplication is *visual* (£ glyph vs mascot SVG), not code dedupe — needs Lewis sign-off. 17 separate `formatCurrency` definitions across 3 implementation idioms; the 9 office-tree copies are mechanical zero-risk dedup territory. Shell-level extractions (`Briefing`, `DetailHeader`, `DrillDownRow`) already done. Recommended C2 scope: 3 commits totalling ~−65 net LOC. Output: `docs/audits/2026-05-01-component-consolidation.md`.

---

## Session 25 — Codebase cleanup (7-track low-risk pass) — 2026-04-22

**Branch:** `claude/condescending-brown-a20148` (merged in `b06d5f7`)
**Outcome commit:** `e6f5a3c refactor(cleanup): 7-track codebase cleanup (low-risk pass)`

7 tracks ran in parallel against the v2 working tree. Detail in `docs/archive/cleanup-session25/SUMMARY.md` (and per-track files alongside). Headline: 369 → 357 source files (−12), ~50.6k → ~49.2k LOC (~−1,400). Lint warnings 38 → 35. Build/tests still passing. Root `/src/` orphan tree (65 files / 556 KB) had been deleted in `77c8a1d` on 2026-04-03.

- **T1 dedup:** 3 consolidations (`toMonthlyEquivalent`, `formatCurrency` in feedback, `formatDate`/`getGreeting` in `(office)/layout`).
- **T2 type consolidation:** `ArchetypeData`, deprecated `ValueMapResult` alias, `Goal`, `Transaction` (surfaced + fixed a latent nullability bug).
- **T3 dead code:** 12 files deleted (transactions cluster, notifications cluster, 3 standalone orphans).
- **T4 circular deps:** `madge --circular` → zero cycles. Recommendation to wire into CI still open.
- **T5 type strengthening:** 8 files, 7 `eslint-disable` directives removed; surfaced + fixed `mimeType` → `mediaType` bug in `bill-extractor.ts` (AI SDK v6 contract).
- **T6 error handling:** 11 silent-swallow catches now log via `console.error` + context.
- **T7 deprecated/AI slop:** Codebase already clean. 1 stub deleted (`persist-messages.ts`), 1 scar-tissue comment removed.

---

## Session: Parser Refactor — Universal Pipeline, 99% Accuracy Target — 2026-04-24

**Branch:** `session-25/folder-detail-views-routing-redirects`
**Purpose:** Fix the three issues the earlier diagnostic CLI surfaced (garbage-PDF output, per-bank parsers still running, XLSX out-of-scope) with a single minimal pipeline. Plan lives at `~/.claude/plans/how-do-we-fix-vivid-pond.md`.

### What changed

**PDF path — killed Strategy A entirely.** `universal-pdf.ts` dropped from 290 lines to 119 lines. No more `extractPdfText`, `runStrategyA`, `resolveColumnIndices`, or column-name substring matching. Every PDF now renders pages client-side and POSTs to `/api/extract-pdf-transactions` for Haiku vision.

**PDF endpoint — richer output.** `/api/extract-pdf-transactions` now returns `{ transactions, metadata, warnings }` where `metadata` includes `openingBalance`, `closingBalance`, `statementPeriodStart`, `statementPeriodEnd`, `accountCurrency`. Server-side balance reconciliation attaches `warning: "balance_mismatch"` when `opening + Σ amounts ≠ closing` within 0.01. Page cap raised from 5 to 20. Prompt tightened with explicit "skip opening/closing rows" and "use account-header currency, not per-transaction wallet currency".

**CSV/XLSX path — universal everywhere.** XLSX files now parse client-side: `src/lib/parsers/xlsx-to-csv.ts` flattens the workbook, auto-detects the real header row (Spanish bank exports prefix 3-5 metadata rows), drops leading/trailing empty columns, dedupes duplicate names (e.g. BBVA's two "Currency" columns), and funnels into the same `parseUniversalCSV` path as CSV. Per-bank parsers deleted: `revolut.ts`, `monzo.ts`, `starling.ts`, `hsbc.ts`, `barclays.ts`, `generic.ts`, `santander.ts`, `uk-date.ts`, and `parsers/index.ts` — nine files, ~660 LOC gone.

**`/api/upload` narrowed.** Multipart branch now handles only: holdings CSVs (kept — different pipeline), transaction screenshots (kept — vision parser), and balance-sheet PDFs/screenshots (kept — separate schema extraction). Raw CSV/XLSX multipart uploads return 422 with a `legacy_multipart_upload` alert; that path is dead after the client uploader moved everything to client-side + JSON `action: 'preview'`.

**Haiku template repair.** `repairTemplate()` in `universal-csv.ts` cross-checks the detected `amountCol` against sample values — if the chosen column isn't numeric (Haiku sometimes picks BBVA's "Movement" narrative column), it scans the other columns for one that is and swaps. Excludes date/description/balance columns, rejects values containing `/` (date-like), requires a money-shaped regex. Prompt also tightened in both `/api/detect-format` and the diagnostic CLI to require numeric evidence.

**parseAmount now handles Unicode minus.** Santander ES XLSX uses `−` (U+2212) instead of `-`; `universal-csv.ts:parseAmount` normalises U+2212 / U+2013 / U+2014 to ASCII hyphen before cleaning.

**Diagnostic CLI updated for the new flow.** PDFs now go through `pdf-parse` text extraction + Haiku (observational — production uses vision, but @napi-rs/canvas + pdfjs-dist fonts don't cooperate in Node). XLSX goes through `xlsxBufferToCSV`. `scripts/parse-diagnose.ts` is the regression suite for now.

### Verification

| Fixture | Before | After |
|---|---|---|
| `revolut_2026-03.csv` | 107 txns, GBP (wrong) | 107 txns, EUR ✓ |
| `revolut_2026-03.pdf` | garbage (€20M credits) | 105 txns, EUR, matches CSV within 2 txns ✓ |
| `BBVA_24-04-2026.pdf` | garbage (€593M credits) | 38 txns, debit/credit split correct ✓ |
| `BBVA_24-04-2026.xlsx` | out-of-scope | 40 txns ✓ |
| `santander_es.pdf` | garbage (€7M credits) | 38 txns ✓ |
| `santander_es.xlsx` | out-of-scope | 40 txns ✓ |
| `nationwide_2023-06.pdf` | `document is not defined` | 3 txns, balance reconciles exactly ✓ |
| `natwest_2026-01.pdf` | `document is not defined` | 15 txns, `balance_mismatch` warning raised (legit — Δ £400) ✓ |

- `npm test` → 17 test files, 163 tests, all green.
- `npx tsc --noEmit` clean.
- `git diff --stat` → +471 insertions, -1084 deletions (net -613 LOC).

### Follow-ups (not blocking the refactor)

1. **`UploadWizard.tsx` has dead `needsColumnMapping` branches** — the manual column-mapping UI is now unreachable (format-detect-client + repairTemplate handle everything). Safe to delete in a UI cleanup pass.
2. **Haiku currency detection is still inconsistent** — same Revolut CSV has come back as EUR, GBP, and USD across runs. Improving this requires either a stronger prompt with locale cues or caching the first successful detection per `header_hash` (already done in production via `bank_format_templates`, but staging's table is missing — see #4).
3. **Bank name detection is "Unknown Bank" for most statements.** Cosmetic; doesn't affect transaction accuracy.
4. **Staging Supabase missing `bank_format_templates`** — `/api/detect-format` can't insert into the cache, so every CSV upload pays Haiku tokens. The table clearly exists in prod; staging needs a migration applied. Unrelated to the refactor but would block the staging UI smoke test.
5. **`.env.local` doesn't have `AWS_REGION`** set explicitly for the CLI — Bedrock provider logs "region: undefined" but calls succeed because the SDK falls back to default profile. Non-blocking.
6. **PDF extraction in the diagnostic CLI uses text, not vision.** Production still uses vision. The signal gap is small (~98% overlap on Revolut) but not identical. Verify the production path via `npm run dev` + manual upload once the `bank_format_templates` table is present in staging.

### Previous session

See entry below (Parser Diagnostic CLI build — 2026-04-24) for the earlier observational diagnostic CLI and audit findings.

---

## Session: Parser Diagnostic CLI — 2026-04-24

**Branch:** `session-25/folder-detail-views-routing-redirects`
**Purpose:** Validate the universal parser refactor (commits `9a03c92`, `02b7f88`, `4878e6d`) by running real bank-statement fixtures through it and printing a diagnostic report.
**Scope:** Observation only — no parser code changes, no Supabase writes, no migrations.

### Phase 0 audit findings

- **Universal parser entry point (browser):** `src/lib/parsers/format-detect-client.ts` → `parseFileOnClient(file: File)`. Takes a browser `File`, POSTs to `/api/detect-format` for the `FormatTemplate`, then delegates to `parseUniversalCSV` / `parseUniversalPDF`.
- **Core parsers (Node-safe):**
  - `src/lib/parsers/universal-csv.ts` → `parseUniversalCSV(text, template)`
  - `src/lib/parsers/universal-pdf.ts` → `parseUniversalPDF(file, template)` (browser-targeted — uses `pdfjs-dist` ES build; Node requires polyfills to run it)
  - `src/lib/parsers/ofx.ts`, `src/lib/parsers/qif.ts`
- **PDF parsing status:** Present. Two strategies:
  - Strategy A — text extraction via `pdfjs-dist`, then column alignment using the `FormatTemplate`.
  - Strategy B — renders pages to PNG and POSTs to `/api/extract-pdf-transactions` for vision extraction (Haiku). Cannot run from a Node CLI (needs canvas + a live server).
- **Formats the universal parser claims to handle:** CSV, PDF, OFX, QIF. **XLSX and images explicitly fall through to the "server path" and are not touched by the universal parser** ([`format-detect-client.ts:57`](src/lib/parsers/format-detect-client.ts)).
- **Transaction type:** `ParsedTransaction` at [`src/lib/parsers/types.ts:17`](src/lib/parsers/types.ts).
- **Branch state at session start:** clean, no uncommitted changes. Last 3 commits: `445fe96`, `4878e6d`, `9a03c92`.

### Implementation

- `scripts/parse-diagnose.ts` — CLI entry point. Reads a file (or all files in a dir), runs it through the universal parser, prints a per-file diagnostic and optional summary table.
- `scripts/parse-diagnose-report.ts` — pure formatter for diagnostic output + invariants.
- `package.json` — added `"parse:diagnose": "tsx scripts/parse-diagnose.ts"`.
- `.gitignore` — added `tests/fixtures/` (fixtures contain real statement PII).
- `tests/fixtures/` — populated with 8 real statements copied from `~/Downloads/` (gitignored).

To let the CLI exercise the real parser without a running dev server, it inlines the same Haiku detection prompt as `/api/detect-format` (bypassing auth and caching — this is a dev tool). For PDFs, the CLI installs minimal `DOMMatrix` / `Path2D` / `ImageData` polyfills and locks `pdfjs.GlobalWorkerOptions.workerSrc` to the installed worker file so `pdfjs-dist` runs in Node.

### Diagnostic CLI results

Ran `npm run parse:diagnose -- --all` against 8 fixtures:

```
FIXTURE                 FORMAT             TXNS   INVARIANTS  RECONCILES
----------------------  -----------------  -----  ----------  ----------
BBVA_24-04-2026.pdf     pdf_universal      ✓ 36   ⚠ 1 warn    —
BBVA_24-04-2026.xlsx    xlsx_out_of_scope  ✗ —    ✗ FAIL      —
nationwide_2023-06.pdf  pdf_universal      ✗ —    ✗ FAIL      —
natwest_2026-01.pdf     pdf_universal      ✗ —    ✗ FAIL      —
revolut_2026-03.csv     csv_universal      ✓ 107  ⚠ 1 warn    —
revolut_2026-03.pdf     pdf_universal      ✓ 108  ⚠ 1 warn    —
santander_es.pdf        pdf_universal      ✓ 49   ⚠ 1 warn    —
santander_es.xlsx       xlsx_out_of_scope  ✗ —    ✗ FAIL      —
```

The `✓` on PDFs is misleading — invariants pass, but the *content* is wrong (see issues below). The CLI invariants prove shape, not accuracy.

### Issues identified (for follow-up sessions — NOT fixed this session)

**1. [CRITICAL] PDF parsing produces garbage output.** BBVA, Revolut, and Santander PDFs all "succeed" but with amounts that are the date encoded as a number and descriptions that are just the raw date string:
- Revolut PDF: all 108 "transactions" credit, amounts like `12,026.00 EUR`, `20,314,796.00 EUR` total, one entry with year `8014-01-01` (postcode parsed as year).
- BBVA PDF: all 36 credit, `592,952,936.00 EUR` total, descriptions = `"19/04/2026"`.
- Santander PDF: all 49 credit, `7,329,274.00 EUR` total.

Root cause: `resolveColumnIndices` in [`src/lib/parsers/universal-pdf.ts:136`](src/lib/parsers/universal-pdf.ts) aligns on the *template*'s column names (`"Date"`, `"Description"`, `"Amount"`), but Haiku describes PDF layouts in the abstract, so the matcher collapses onto the wrong column. The date column ends up in both the date slot AND the amount slot, and the description slot is empty so it falls back to the date string.

**2. [HIGH] Strategy B (vision) is the only path for many PDFs but cannot be reached from Node.** Nationwide and NatWest PDFs fail Strategy A entirely (`document is not defined` — pdfjs rendering path needs more DOM than the Node polyfill provides) and fall back to Strategy B, which requires canvas rendering + a live server. No runtime signal available for these banks without a browser or a legacy-build rework.

**3. [HIGH] XLSX bypasses the universal parser entirely.** [`src/app/api/upload/route.ts`](src/app/api/upload/route.ts) still branches to `parseSantanderXLSX` for `.xlsx` files, and `format-detect-client.ts:57` explicitly marks XLSX as `server_fallback`. Both real user uploads in EU (BBVA and Santander Spain) produce XLSX — so the "universal" path doesn't cover the two most common Spanish formats.

**4. [HIGH] Per-bank parsers still live in `/api/upload` despite the refactor's intent.** Contradicts the stated goal of "no individual parsers after these commits". Still imported and called in [`src/app/api/upload/route.ts:6-12`](src/app/api/upload/route.ts):
- `parseRevolutCSV`, `parseMonzoCSV`, `parseStarlingCSV`, `parseHsbcCSV`, `parseBarclaysCSV`, `parseGenericCSV`

Client path (`format-detect-client.ts`) uses the universal parser; server path (`/api/upload`) uses per-bank. Two parallel ingestion pipelines — the one the user sees depends on which path their upload took.

**5. [MEDIUM] `src/lib/parsers/index.ts` (`detectFormat`) is dead code.** Still imports `isRevolutCSV`, `isSantanderFile`, `isMonzoCSV`, etc., but no caller in the canonical flow invokes it. Safe to delete in a cleanup pass.

**6. [MEDIUM] Haiku format-detection quality is uneven.**
- Revolut CSV: `bankName="Unknown Bank"`, `currencyDefault=GBP` (fixture is an EUR-denominated Revolut export with GBP sub-wallet, but the dominant currency is EUR — detection picked the balance column currency).
- Revolut PDF: `signConvention=split_in_out` (wrong — Revolut has a single signed column).
- Santander PDF: `bankName="Spanish Bank (BBVA or similar)"`.

No caching in the diagnostic path means every run costs Haiku tokens; the real `/api/detect-format` caches by header hash so production only pays once per format.

**7. [LOW] No opening/closing balance metadata surfaced.** `ParseResult` has no place for statement-period bounds or opening/closing balance, so the invariants CLI can't run balance reconciliation on any fixture — even Revolut CSV, which clearly carries a running `Balance` column.

**8. [LOW] One false-positive duplicate in Revolut CSV.** Two `Hotel Màgic Pas` card payments on 2026-03-23 at `-5.00` EUR. Could be a genuine double-tap at a hotel or two distinct transactions — the CSV's Started Date differs but Completed Date collapses them. Flagging here because the deduper in the app may discard a real second transaction.

### Next session recommendation

Two strong candidates, in priority order:

1. **Fix the PDF column-alignment bug** (Issue #1). Every PDF-sourced transaction currently ingested via the universal path is wrong. This is the highest-stakes correctness bug on the branch. Either: (a) have Haiku return column *positions* (x-coordinates) alongside semantic names so `resolveColumnIndices` has something to align on; or (b) skip the template-driven approach for PDFs and parse with a simpler heuristic (date anchors, amount anchors, description = everything between).

2. **Remove per-bank parsers** (Issues #3, #4, #5). The branch removed `parsePdfTransactions` in `4878e6d` but left the CSV per-bank path wired up. The intended end state is one pipeline; today there are two. An audit-and-remove pass on `src/app/api/upload/route.ts` plus `src/lib/parsers/index.ts` closes the refactor.

Don't touch either until (1) and (2) are planned — they interact (removing the server CSV path means every Revolut/Monzo/Starling upload starts hitting the universal pipeline, whose accuracy under Haiku detection needs its own validation first).

---

## v2.0 — Post-Merge Baseline + Versioning Convention (2026-05-06)

**Type:** Architectural milestone + housekeeping
**Files touched:** CLAUDE.md, BUILD-STATUS.md, package.json, SESSION-LOG.md
**Code changes:** none

### What landed
- UI rebuild (session-25/folder-detail-views-routing-redirects) merged to main
- Onboarding flow (O1/O2) merged to main
- Versioning convention established and documented in CLAUDE.md
- BUILD-STATUS.md updated to reflect v2.0 baseline
- package.json bumped to 2.0.0
- main tagged v2.0

### Lessons learned
- **Two unmerged branches inflated token costs on every Claude Code session.** Going forward: no more than one in-flight branch at a time. If a feature spans multiple sessions, keep it on a single branch and ship in chunks behind a flag rather than forking child branches.
- **Versioning deferred too long.** Sessions 1–25 lacked version tags, which made retros harder. v2.0 is the right inflection point — old work stays session-numbered, new work is version-tagged.
- **Documentation drift compounds quietly.** BUILD-STATUS, CLAUDE.md, and main had all diverged before this session. Going forward: any session that changes branch topology or roadmap status updates BUILD-STATUS in the same commit.

### Unblocks
- Session v2.1 (Phase A) can now be run against a clean main
