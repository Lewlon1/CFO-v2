# Track 3 — Dead code removal

## Summary

Twelve files (~1,400 LOC) deleted with HIGH confidence — all internally-referenced orphan clusters or standalone dead modules with zero external import sites. The largest finding was the `components/transactions/` legacy cluster (7 files: `TransactionList`, `TransactionsClient`, `BatchClassifier`, `CategoryBadge`, `TransactionFilters`, `UncategorisedQueue`, `ValueCategoryPill`) — Track 2 flagged 3 of those as orphans (M1) and grep verification revealed the entire 7-file ring imports only itself; the live transactions page uses `OfficeTransactionsClient` from a different folder. Two-file `components/notifications/` cluster (`NotificationPanel` + its sole consumer-target `NudgeCard`) is wholly orphan — no page renders it. Single-file orphans: `components/trust/ProvenanceLine.tsx` (a name-collision dupe of the `data/DataComponents.tsx:ProvenanceLine` actually used by TheGapClient), `lib/analytics/first-insight.ts` (defined `computeFirstInsight` but the live consumers import from `insight-engine.ts` instead), `lib/value-map/selection.ts` (`selectTransactions` defined but never imported — the value-map flow inlines its own selection logic). All earlier-survey LOW-confidence flags (`screenshot.ts`, `balance-sheet-screenshot.ts`, `bill-extractor.ts`, `pdf-transactions.ts`) verified ALIVE — left untouched. Knip's "unused exports" list (30 entries) yielded MEDIUM-confidence trim candidates (`NUDGE_LABELS`, `PRIORITY_ORDER`, `CSV_POLL_*`, etc) — not implemented to honor the HIGH-only constraint. Build succeeds, tests 58/58 passing, lint improved from 20/38 to 20/36 (the 2 warnings dropped were inside files we deleted).

---

## Knip raw output highlights

Run from `cfos-office/`: `npx knip --no-progress --reporter compact 2>&1 | head -200`.

```
Unused files (22)
apply-migration.ts                                    [ROOT util script — DEFERRED]
check-staging.ts / check-staging2.ts / check-staging3.ts  [ROOT util scripts — DEFERRED]
scripts/_stub-next-headers.ts                         [DEFERRED — explicit testing stub per brief]
scripts/backfill-categories.ts                        [DEFERRED — scripts/ excluded from build]
scripts/verify-first-insight.ts                       [DEFERRED — scripts/ excluded from build]
src/components/notifications/NotificationPanel.tsx    [DELETED — orphan cluster]
src/components/notifications/NudgeCard.tsx            [DELETED — orphan cluster]
src/components/transactions/BatchClassifier.tsx       [DELETED — orphan cluster (7 files)]
src/components/transactions/CategoryBadge.tsx         [DELETED — orphan cluster]
src/components/transactions/TransactionFilters.tsx    [DELETED — orphan cluster]
src/components/transactions/TransactionList.tsx       [DELETED — orphan cluster (Track 2 M1)]
src/components/transactions/TransactionsClient.tsx    [DELETED — orphan cluster]
src/components/transactions/UncategorisedQueue.tsx    [DELETED — orphan cluster]
src/components/transactions/ValueCategoryPill.tsx     [DELETED — orphan cluster]
src/components/trust/ProvenanceLine.tsx               [DELETED — name-collision orphan]
src/lib/analytics/first-insight.ts                    [DELETED — superseded by insight-engine.ts]
src/lib/chat/persist-messages.ts                      [MEDIUM — see M1 below]
src/lib/value-map/selection.ts                        [DELETED — never imported]
test-normalise.ts / test-rules.ts                     [ROOT util scripts — DEFERRED]
```

`src/lib/supabase/types.ts` "unused exports" (`Tables`, `TablesInsert`, `TablesUpdate`, `Enums`, `CompositeTypes`, `Constants`) — generated file, never edit. **No action.**

---

## HIGH-confidence — DELETED

### 1. `components/transactions/` orphan cluster (7 files, ~600 LOC)

**Files deleted:**
- `/Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office/src/components/transactions/TransactionList.tsx`
- `/Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office/src/components/transactions/TransactionsClient.tsx`
- `/Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office/src/components/transactions/BatchClassifier.tsx`
- `/Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office/src/components/transactions/CategoryBadge.tsx`
- `/Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office/src/components/transactions/ValueCategoryPill.tsx`
- `/Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office/src/components/transactions/UncategorisedQueue.tsx`
- `/Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office/src/components/transactions/TransactionFilters.tsx`

**Grep evidence:**
- `TransactionsClient` only appears in `TransactionsClient.tsx:22` (definition). Live transactions page (`src/app/(office)/office/cash-flow/transactions/page.tsx:46`) renders `OfficeTransactionsClient`, NOT `TransactionsClient`.
- `TransactionList`, `BatchClassifier`, `UncategorisedQueue`, `TransactionFilters` are imported only by `TransactionsClient.tsx`.
- `CategoryBadge`, `ValueCategoryPill` are imported only by `TransactionList.tsx` (and `ValueCategoryPill` also by `UncategorisedQueue.tsx`).
- The whole 7-file ring forms a closed-cycle, no external entry point.

**Framework convention check:** None of these files are page/layout/loading/error/route/middleware/template — they live under `components/`, not `app/`. Safe.

**Track 2 cross-reference:** Track 2 M1 and M3 documented this cluster (3 files: `TransactionList`, `TransactionsClient`, `BatchClassifier`) as orphan and explicitly recommended Track 3 delete. Track 3 confirmed the cluster is actually 7 files (the other 4 are siblings imported only via `TransactionsClient`).

### 2. `components/notifications/` orphan cluster (2 files)

**Files deleted:**
- `/Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office/src/components/notifications/NotificationPanel.tsx`
- `/Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office/src/components/notifications/NudgeCard.tsx`

**Grep evidence:**
- `NotificationPanel`: only appears in its own definition file. Zero imports anywhere in `src/` (or `app/`, `lib/`, `components/`).
- `NudgeCard`: imported only by `NotificationPanel.tsx:5`. The dependent `NUDGE_ICONS` import from `lib/nudges/rules.ts` only goes through this dead chain.

**Framework convention check:** N/A (under `components/`, not `app/`).

**Note:** The `app/api/cron/nudges-{daily,weekly,monthly}/route.ts` files are intentionally retained per brief (DEFERRED.md). The notifications UI (panel + card) was never wired up to a live page — the cron writes to a `nudges` table that no current UI surface reads. When the nudge UI is built, these components would be re-implemented from scratch against the current design system anyway (the deleted versions used legacy classnames like `text-text-soft` from a previous iteration).

### 3. `components/trust/ProvenanceLine.tsx`

**File deleted:**
- `/Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office/src/components/trust/ProvenanceLine.tsx`

**Grep evidence:**
- `import.*from.*components/trust` returns zero matches across the entire codebase.
- `ProvenanceLine` is also defined in `src/components/data/DataComponents.tsx:164` (`export function ProvenanceLine({ text }: { text: string })`) — DIFFERENT API: `text: string` vs `transactionCount/source/uploadDate`.
- The live consumer `src/app/(office)/office/values/the-gap/TheGapClient.tsx:3` imports `ProvenanceLine` from `@/components/data` (the canonical one), passes `text="..."`. Confirmed via line:`<ProvenanceLine text={`Based on Value Map + ${transactionCount} transactions`} />`.

**Framework convention check:** N/A.

This is a textbook name-collision artifact: two same-named components with different prop signatures, one alive, one orphan. Deleting the orphan eliminates the collision risk at the IDE-autoimport level.

### 4. `src/lib/analytics/first-insight.ts`

**File deleted:**
- `/Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office/src/lib/analytics/first-insight.ts`

**Grep evidence:**
- `from.*lib/analytics/first-insight` returns zero matches.
- `from '@/lib/analytics/first-insight'` returns zero matches.
- The `first-insight` string in `app/api/insights/post-upload/route.ts:17,37` is a **comment / log message**, not an import (`// Compute the full first-insight payload` and `console.error('Failed to create first-insight conversation:', error)`).
- The two live API routes that reference `computeFirstInsight` import it from `@/lib/analytics/insight-engine`:
  - `src/app/api/insights/post-upload/route.ts:2`
  - `src/app/api/onboarding/generate-insight/route.ts:4`
- Sister exports (`RecurringCard`, `LeakCard`, `ValueBreakdownCard`) on this file have zero external import sites.

**Framework convention check:** N/A (lib file, not a route).

This file is a stale alternative implementation that was superseded by `insight-engine.ts`. The function names overlap (both files exported a `computeFirstInsight`), which would be ambiguous to developers — deletion eliminates the parallel-implementation hazard.

### 5. `src/lib/value-map/selection.ts`

**File deleted:**
- `/Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office/src/lib/value-map/selection.ts`

**Grep evidence:**
- `from.*value-map/selection` returns zero matches.
- The string `selectTransactions` appears in `src/components/value-map/value-map-flow.tsx:267` ONLY in a code comment: `// Pass SAMPLE_TRANSACTIONS directly — selectTransactions() sorts by ...`. No actual import.
- Other matches for "selection" word in the value-map area are unrelated comments / JSX section headers.

**Framework convention check:** N/A.

The function is a transaction-curation algorithm that would have been used to pick 12 diverse transactions from a user's CSV before showing them in the Value Map. The current Value Map flow uses pre-baked `SAMPLE_TRANSACTIONS` (lib/demo/transactions.ts) instead, making this function obsolete.

---

## MEDIUM-confidence — documented, not deleted

### M1. `src/lib/chat/persist-messages.ts`

**Status:** Defunct stub from Session 2 plan, no current consumers.

**File body:**
```typescript
// Stub — message persistence will be implemented in Session 2
export async function persistMessages(_params: { ... }): Promise<void> {
  // no-op
}
```

**Why MEDIUM, not HIGH:**
- The comment explicitly says "Session 2" and chat IS implemented now (`app/api/chat/route.ts` is 652 lines), so the stub is technically redundant.
- BUT: there's a sibling `src/lib/chat/rate-limit.ts` with the same stub-y signature pattern (`_userId` / `_action` unused, returns void) — knip flagged warnings on both for unused params, suggesting an intentional family of "stubs we may revive". 
- Deleting `persist-messages.ts` while leaving `rate-limit.ts` is asymmetric. A focused pass on `lib/chat/` stubs (treating both consistently — either both go or both stay) is the right approach.

**Recommendation:** Either delete BOTH `persist-messages.ts` and `rate-limit.ts` together as part of a "remove placeholder stubs" pass, OR replace both with real implementations. Don't delete one without the other.

### M2. Knip "unused exports" — surgical micro-deletions deferred

Knip flagged 30 unused exports across 23 files. After grep-verification, ~12 are genuinely unused (e.g. `NUDGE_LABELS`, `PRIORITY_ORDER` in `lib/nudges/rules.ts`; `CSV_POLL_INTERVAL_MS`, `CSV_POLL_TIMEOUT_MS` in `lib/onboarding/constants.ts`; `NEW_USER_PROMPTS` in `lib/chat/prompt-buttons.ts`; `getMerchantKey` in `lib/categorisation/normalise-merchant.ts`; `parseLooseNumber` in `lib/parsers/holdings-csv.ts`; `sourceFromFormat` in `lib/parsers/index.ts`; `predictValueCategory` in `lib/prediction/predictor.ts`; `makeKey` in `lib/upload/duplicate-detector.ts`; `chatModelId` in `lib/ai/provider.ts`; `colors`/`fonts` in `lib/tokens.ts`).

**Why MEDIUM:** Each is a 1–4 line removal, but the file remains alive. The question of "is this export retained for an external consumer (e.g. a planned API surface, a documented utility) or genuinely dead?" requires file-by-file judgement. Several look like deliberate API-surface hygiene (e.g. `NUDGE_LABELS` parallels `NUDGE_ICONS` which IS used — symmetric design choice).

**Recommendation:** A separate "unused exports trim" pass with each file individually justified. Easy mechanical wins but don't fit the HIGH-confidence-only ratchet of this track. Suggested order: start with constants files (`onboarding/constants.ts`, `chat/prompt-buttons.ts`) where the dead vs. alive question is binary.

### M3. Knip "duplicate exports" — `default` + `named` redundancy (10 files)

Knip flagged 10 files with `MyComponent, default` duplicate exports — same identifier exported both as the default and as a named export:
- `src/app/(office)/office/OfficeHomeClient.tsx`
- `src/components/brand/CFOAvatar.tsx`
- `src/components/navigation/NavigationBar.tsx`
- `src/components/office/FolderSection.tsx`
- `src/components/office/UserAvatarMenu.tsx`
- `src/components/office/sections/{CashFlow,NetWorth,Scenarios,Values}Section.tsx`
- `src/lib/categorisation/normalise-merchant.ts` (different — `normaliseMerchant, getMerchantKey` are distinct exports, knip false positive here)

**Why MEDIUM:** The `default` export pattern is standard for Next.js `'use client'` components historically — many import sites might use `import Component from '...'` syntax. Removing the default export risks breaking call sites. Verifying each call-site individually is mechanical but bulky.

**Recommendation:** Defer to a "module-export style" cleanup. If the codebase convention is "named only", do it as one PR with codemod; otherwise leave alone.

### M4. Root-level utility scripts (`apply-migration.ts`, `check-staging{,2,3}.ts`, `test-{normalise,rules}.ts`)

**Files (NOT deleted):**
- `cfos-office/apply-migration.ts`
- `cfos-office/check-staging.ts`
- `cfos-office/check-staging2.ts`
- `cfos-office/check-staging3.ts`
- `cfos-office/test-normalise.ts`
- `cfos-office/test-rules.ts`

**Why MEDIUM:** These are at the cfos-office root (NOT in `cfos-office/scripts/`). Only `check-staging*.ts` are formally excluded from tsconfig (per commit `d9be878`); the others are utility scripts that follow the same intent pattern. The brief explicitly preserves `cfos-office/scripts/` but is silent on these root-level siblings.

**Recommendation:** A focused pass should either (a) move them all into `scripts/` and update tsconfig, OR (b) delete the ones that have served their one-time purpose and are no longer needed. Each script reads like a one-off (e.g. `test-normalise.ts` runs hardcoded test cases through the merchant normaliser). Not safe to delete without owner sign-off.

### M5. `lib/parsers/balance-sheet-screenshot.ts:BalanceSheetScreenshotResult` exported type unused

Knip flagged the type export as unused. The function `parseBalanceSheetScreenshot` is alive (used in `app/api/upload/route.ts:16`), but the return-type alias `BalanceSheetScreenshotResult` has no external consumer — every caller infers from the function signature.

**Why MEDIUM:** Removing the export is safe but the type name is part of a documented contract (mentioned in `balance-sheet-schema.ts` comments). May break external tooling that reflects on the type.

**Recommendation:** Keep for now. If a follow-up pass on `lib/parsers/` consolidates types, do this then.

### M6. `lib/parsers/balance-sheet-pdf.ts:BalanceSheetPdfResult` exported type unused (sister of M5)

Same family as M5. Same recommendation.

### M7. `lib/parsers/bill-extractor.ts:BillExtraction, BillExtractionResult` exported types unused

Same pattern. The function `extractBillData` IS used (`app/api/bills/upload/route.ts:3`), but the type aliases for its inputs/outputs have no external consumers.

**Recommendation:** Defer. Same reasoning as M5/M6.

### M8. `lib/value-map/copy.ts:IntroBullet, GapSketchCopy` exported types unused

Likely safe to remove (verified zero external consumers via grep) but inside a copy/content file that's brittle to edit. Defer to whoever owns the value-map UI copy.

### M9. `lib/value-map/regenerate-archetype.ts:RegenerationTrigger, RegenerationResult` types unused

Same pattern. Defer to a parsers/value-map type cleanup pass.

---

## LOW-confidence — documented, not deleted

### L1. Earlier-survey false positives — VERIFIED ALIVE (do not touch)

The brief flagged these as needing verification. Grep results show all are in active use:

- `lib/parsers/screenshot.ts` → imported by `app/api/upload/route.ts:13` (`parseScreenshot`).
- `lib/parsers/balance-sheet-screenshot.ts` → imported by `app/api/upload/route.ts:16` (`parseBalanceSheetScreenshot`).
- `lib/parsers/balance-sheet-pdf.ts` → imported by `app/api/upload/route.ts:17` (`parseBalanceSheetPDF`).
- `lib/parsers/pdf-transactions.ts` → imported by `app/api/upload/route.ts:18` (`parsePdfTransactions`).
- `lib/parsers/bill-extractor.ts` → imported by `app/api/bills/upload/route.ts:3` (`extractBillData`).

**Status:** All verified live. Do NOT delete. Brief was correct to mark them LOW.

### L2. `lib/supabase/types.ts` exports flagged by knip

Knip flagged `Constants`, `Tables`, `TablesInsert`, `TablesUpdate`, `Enums`, `CompositeTypes` as "unused exports". This file is **generated** by Supabase CLI — never edit by hand. The exports are part of the standard supabase-typegen output API.

**Status:** Ignore knip. Generated file. Untouched.

### L3. Cron `nudges-{daily,weekly,monthly}/route.ts` and tools/ TODO(session-14) files

Per brief, intentionally retained. Untouched.

### L4. Demo / value-map flow under `app/(public)/demo/`, `lib/demo/`, `lib/value-map/`, `components/demo/`, `components/value-map/`

Per brief, product-critical. Untouched.

Note: `lib/value-map/selection.ts` was deleted (HIGH-5 above) because it is a within-`lib/value-map/` orphan that the live value-map flow doesn't import — the pre-signup demo uses pre-baked sample transactions from `lib/demo/transactions.ts`, not this selector. The remaining `lib/value-map/*` files (formats, types, feedback, retake-candidates, copy, etc.) ARE all wired up.

### L5. `app/(office)/office/OfficeHomeClient.tsx` — knip "unused default export"

The `default` export is unused (knip), but the **named** `OfficeHomeClient` export is used by `src/app/(office)/office/page.tsx`. Removing only the default export is the M3 question. Untouched.

### L6. Various `.tsx` files with `export default` knip-flagged

Same as L5 — Next.js `'use client'` components historically use the `export default` convention. Tracking which call sites use named vs default is the M3 question. Untouched.

---

## Verification

Run from `cfos-office/`:

| Check | Baseline (post-Track-2) | Post-Track-3 | Delta |
|---|---|---|---|
| `npm run build` | succeeds | succeeds | unchanged |
| `npm run lint` | 20 errors / 38 warnings | 20 errors / 36 warnings | **–2 warnings** (unused-vars in deleted files) |
| `npm test` | 58/58 passing | 58/58 passing | unchanged |
| File count (`find src -type f \( -name "*.ts" -o -name "*.tsx" \)`) | 369 | 357 | **–12 files** |

No build regressions. No test regressions. Lint improved by 2 (no new errors introduced; 2 fewer unused-var warnings because the offending files are gone).

Commands run after each deletion batch (transactions cluster, then notifications cluster, then standalone files):

```bash
cd /Users/lewislonsdale/Documents/CFO-V2/.claude/worktrees/condescending-brown-a20148/cfos-office && npm run build 2>&1 | tail -10
```

All three runs: `Compiled successfully` and full route listing produced.

## Files touched

**Deleted (12):**
- `src/components/transactions/TransactionList.tsx`
- `src/components/transactions/TransactionsClient.tsx`
- `src/components/transactions/BatchClassifier.tsx`
- `src/components/transactions/CategoryBadge.tsx`
- `src/components/transactions/TransactionFilters.tsx`
- `src/components/transactions/UncategorisedQueue.tsx`
- `src/components/transactions/ValueCategoryPill.tsx`
- `src/components/notifications/NotificationPanel.tsx`
- `src/components/notifications/NudgeCard.tsx`
- `src/components/trust/ProvenanceLine.tsx`
- `src/lib/analytics/first-insight.ts`
- `src/lib/value-map/selection.ts`

Two empty directories were also pruned automatically by git: `src/components/notifications/`, and (likely) `src/components/transactions/` becomes empty as well.

12 file deletions, no content modifications, staged in working tree. No commit (per brief).

## Out-of-scope (not touched, per brief)

- `app/api/cron/nudges-{daily,weekly,monthly}/route.ts` — DEFERRED.md.
- `lib/ai/tools/{upsert-asset,upsert-liability,get-balance-sheet}.ts` — TECH_DEBT.md #30, intentional Session-14 markers.
- Demo / value-map flow files under `app/(public)/demo/`, `lib/demo/`, `components/demo/`, `components/value-map/` — product-critical pre-signup feature.
- Tools registered in `lib/ai/tools/index.ts` — invoked dynamically by name via `createToolbox()`.
- `cfos-office/scripts/` — utility scripts, intentionally excluded from build.
- `cfos-office/supabase/migrations/` — never delete migrations.
- `scripts/_stub-next-headers.ts` — explicit stub for testing.
- `cfos-office/src/lib/supabase/types.ts` — generated; never edit manually.

## Surprises / notes for next track

1. **The orphan transactions cluster was 7 files, not 3.** Track 2 M1 named the 3 most-coupled files (`TransactionList`, `TransactionsClient`, `BatchClassifier`). The other 4 (`CategoryBadge`, `TransactionFilters`, `UncategorisedQueue`, `ValueCategoryPill`) are dead-by-association — only used by the dead 3. Worth highlighting that "find the obvious orphan" often misses the supporting cast.

2. **Two `ProvenanceLine` components with different APIs co-existed.** A grep for `ProvenanceLine` finds both; only the one in `data/DataComponents.tsx` is reachable from any page. The `trust/` orphan was a dead earlier prototype. Future work: consider standardising naming so renaming-search-and-replace doesn't accidentally hit dead code.

3. **`first-insight.ts` looked alive because of comment text.** A code-search for "first-insight" hits comments and log strings in `post-upload/route.ts`, but no `import` line. Future agents should grep specifically for `from.*<modulename>` patterns, not bare module name.

4. **Knip's "unused exports" flagged the generated supabase types file.** Easy false-positive trap. Don't trust knip for any file under `supabase/` or in a `types.ts` that has a code-gen comment header.

5. **`persist-messages.ts` and `rate-limit.ts` are paired stubs.** Track 4+ should treat them as a pair — either remove both or implement both.
