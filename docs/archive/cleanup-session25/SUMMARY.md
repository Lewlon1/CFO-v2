# Session 25 cleanup — final summary

All 7 tracks complete. All changes staged in working tree, **no commits** (per user policy). User reviews and commits manually.

## Headline

| Metric | Before | After | Delta |
|---|---|---|---|
| cfos-office source files | 369 | 357 | −12 (+1 deleted in Track 7 = 356) |
| cfos-office source LOC | ~50.6 k | ~49.2 k | ≈ −1,400 |
| Lint (errors / warnings) | 20 / 38 | 20 / 35 | 0 / −3 |
| Build | passes | passes | unchanged |
| Tests | 58/58 | 58/58 | unchanged |
| Root `/src/` orphan tree | 65 files / 556 KB | deleted | −65 files |

Quality is up, volume is down, nothing regressed.

## What changed, by track

### Phase 0 — Root `/src/` orphan tree
Confirmed orphan (HIGH), committed in `77c8a1d` on 2026-04-03, zero cross-tree references. Deleted 69 entries (65 .ts/.tsx + 4 `.DS_Store`). Details in [track-0-phase0-orphan-tree.md](track-0-phase0-orphan-tree.md).

### Track 1 — Deduplication
3 consolidations:
- `calculate-monthly-budget.ts` — local `toMonthlyEquivalent` replaced with import from `./helpers`.
- `value-map/feedback.ts` — local `formatCurrency` + inline currency-symbol map replaced with imports from `./format`.
- `(office)/layout.tsx` — local `formatDate` + `getGreeting` replaced with imports from `@/lib/utils`.

Preserved-by-design: the three "currency formatter" variants have deliberately different digit/locale behaviour (UI cards vs integer breakdowns vs LLM narrative prompts) — documented, not merged.

Details in [track-1-deduplication.md](track-1-deduplication.md).

### Track 2 — Type consolidation
4 consolidations:
- `ArchetypeData`/`ArchetypeResult` collapsed into a single type in `lib/onboarding/`.
- Deprecated `ValueMapResult` alias removed from `lib/analytics/insight-types.ts` (the "compat" comment was false — zero external imports, name-collided with a different-shape `ValueMapResult`).
- `Goal` in `scenarios/goals/page.tsx` now uses `Database['public']['Tables']['goals']['Row']`.
- `Transaction` in `OfficeTransactionsClient.tsx` now uses `Pick<>` of canonical Row; surfaced and fixed a latent nullability bug at `merchant={tx.description}`.

Details in [track-2-type-consolidation.md](track-2-type-consolidation.md).

### Track 3 — Dead code removal
12 files deleted (~1,400 LOC):
- Transactions orphan cluster (7 files under `components/transactions/`).
- Notifications orphan cluster (2 files under `components/notifications/`).
- 3 standalone orphans: `components/trust/ProvenanceLine.tsx` (name-collision dupe), `lib/analytics/first-insight.ts` (superseded), `lib/value-map/selection.ts` (never imported).

Earlier-survey LOW-confidence flags (`screenshot.ts`, `balance-sheet-screenshot.ts`, `bill-extractor.ts`, `pdf-transactions.ts`) all verified ALIVE — not deleted.

Details in [track-3-dead-code.md](track-3-dead-code.md).

### Track 4 — Circular dependencies
`npx madge --circular --ts-config tsconfig.json src/` → **zero cycles**. Clean import graph. No source changes. Recommendations: wire this into CI + consider `eslint-plugin-import`'s `no-cycle` rule.

Details in [track-4-circular-deps.md](track-4-circular-deps.md).

### Track 5 — Type strengthening
8 files strengthened, 7 `eslint-disable-next-line @typescript-eslint/no-explicit-any` directives removed. `any` / `as any` → proper types (`unknown`, `SupabaseClient`, `UserContent`, `LucideIcon`, local boundary interfaces).

Surfaced and fixed a latent bug: `mimeType` → `mediaType` in `bill-extractor.ts` (AI SDK v6 contract). The `as any` cast had been hiding it.

Details in [track-5-type-strengthening.md](track-5-type-strengthening.md).

### Track 6 — Error handling
11 silent-swallow catch blocks now log via `console.error` + context. Fire-and-forget patterns that are legitimately silent (analytics posts, alert sends) kept, but with explanatory comments added so a new reader understands the intent.

Details in [track-6-error-handling.md](track-6-error-handling.md).

### Track 7 — Deprecated and AI slop
Codebase is already clean here. 1 stub file deleted (`lib/chat/persist-messages.ts`), 1 scar-tissue comment removed from `demo-card.tsx`. Zero `@deprecated` markers, zero `if(false)` toggles, zero `.bak`/`.old` files. All 6 TODO markers confirmed legitimate per DEFERRED.md / TECH_DEBT.md.

Details in [track-7-deprecated-ai-slop.md](track-7-deprecated-ai-slop.md).

## Files touched (cfos-office only)

### Modified (24)
- `src/app/(office)/layout.tsx`
- `src/app/(office)/office/cash-flow/transactions/OfficeTransactionsClient.tsx`
- `src/app/(office)/office/inbox/InboxClient.tsx`
- `src/app/(office)/office/scenarios/goals/page.tsx`
- `src/app/api/chat/route.ts`
- `src/app/api/chat/undo/route.ts`
- `src/app/api/upload/route.ts`
- `src/components/chat/ChatProvider.tsx`
- `src/components/chat/ChatSheet.tsx`
- `src/components/chat/MessageFeedback.tsx`
- `src/components/chat/MessageList.tsx`
- `src/components/dashboard/CategoryBreakdown.tsx`
- `src/components/demo/demo-card.tsx`
- `src/components/office/InboxRow.tsx`
- `src/hooks/useOnboarding.ts`
- `src/lib/ai/review-context.ts`
- `src/lib/ai/tools/calculate-monthly-budget.ts`
- `src/lib/analytics/insight-types.ts`
- `src/lib/bills/brave-search.ts`
- `src/lib/onboarding/archetype-prompt.ts`
- `src/lib/parsers/balance-sheet-pdf.ts`
- `src/lib/parsers/bill-extractor.ts`
- `src/lib/parsers/generic.ts`
- `src/lib/value-map/feedback.ts`

### Deleted (13)
- `src/components/notifications/NotificationPanel.tsx`
- `src/components/notifications/NudgeCard.tsx`
- `src/components/transactions/BatchClassifier.tsx`
- `src/components/transactions/CategoryBadge.tsx`
- `src/components/transactions/TransactionFilters.tsx`
- `src/components/transactions/TransactionList.tsx`
- `src/components/transactions/TransactionsClient.tsx`
- `src/components/transactions/UncategorisedQueue.tsx`
- `src/components/transactions/ValueCategoryPill.tsx`
- `src/components/trust/ProvenanceLine.tsx`
- `src/lib/analytics/first-insight.ts`
- `src/lib/chat/persist-messages.ts`
- `src/lib/value-map/selection.ts`

### Added (8 assessment docs under `docs/cleanup/`)
- `track-0-phase0-orphan-tree.md`
- `track-1-deduplication.md`
- `track-2-type-consolidation.md`
- `track-3-dead-code.md`
- `track-4-circular-deps.md`
- `track-5-type-strengthening.md`
- `track-6-error-handling.md`
- `track-7-deprecated-ai-slop.md`
- `SUMMARY.md` (this file)

## Deferred recommendations worth revisiting

Collated from per-track assessments, ranked by likely payoff:

1. **Centralise `safeContextBlock` helper** for the 6 identical try/catches in `lib/ai/context-builder.ts` (Track 6 MED-1) — would consolidate boilerplate in the largest file in the repo.
2. **Extract auth-check pattern** from ~49 API routes into `lib/auth/require-user.ts` (Track 1 MED) — idiomatic but repeated verbatim; low-risk small extraction.
3. **Strengthen `Record<string, any>` in `lib/alerts/notify.ts` metadata** (Track 5 MED) — legitimate free-form boundary today, but would benefit from a discriminated-union once alert channels stabilise.
4. **Remove the remaining transactions `Transaction` local redefinition** if/when that flow is brought back (Track 2 MED → subsumed by Track 3 deletion but worth noting if re-added).
5. **Add `madge --circular --ts-config` to CI** (Track 4) — cheap way to keep the current zero-cycle property as the codebase grows.
6. **`eslint-plugin-import` `no-cycle` rule** (Track 4) — belt-and-braces for the above.
7. **Dedicated error-handling pass for value-map / demo flow** (Track 6 MED-5/6) — intentionally skipped this pass as product-critical.
8. **Tidy up 6 root-level utility scripts** (Track 3 MED) — `apply-migration.ts`, `check-staging{,2,3}.ts`, `test-{normalise,rules}.ts`. Tsconfig already excludes them from the build but they clutter the worktree root.

## Known preserved intent (NOT touched)

- `api/cron/nudges-{daily,weekly,monthly}` — DEFERRED.md "Cron route registration", TECH_DEBT.md #20.
- `TODO(session-14)` markers in `lib/ai/tools/{upsert-asset,upsert-liability,get-balance-sheet}.ts` — TECH_DEBT.md #30.
- Large-file refactor candidates (`lib/ai/context-builder.ts` 1316 lines, `app/api/chat/route.ts`, `app/api/upload/route.ts`) — TECH_DEBT.md #31/#32.
- DEFERRED.md items (multi-upload, bill extraction pipeline, large-purchase tool, screenshot reliability, Android QA).
- Demo / value-map flow — product-critical.

## Incident note

A first attempt at root `/src/` deletion staged 375 deletions in `cfos-office/src/` due to a Bash cwd drift. Caught immediately via `git status` and reverted with `git restore --staged --worktree cfos-office/src/`. All subsequent tracks were briefed to use absolute paths or explicit `cd` in every Bash call. No files lost. See [track-0-phase0-orphan-tree.md](track-0-phase0-orphan-tree.md) for full incident note.
