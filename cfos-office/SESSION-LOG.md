# Session Log

Running log of session-bounded work for the CFO's Office project. Each
entry captures: branch, scope, what was observed, what was changed,
and follow-ups — so the next session can pick up cold.

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
