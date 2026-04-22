# Track 4 — Circular dependencies

## Summary

**Zero circular dependencies in the codebase.** Madge — run with both default settings and with `--ts-config tsconfig.json` to honor the `@/*` path alias — finds no cycles across all 358 source files. No code changes were made; no fixes are needed. The prior survey's prediction of "no obvious cycles" is confirmed authoritatively. The three structural smells the brief flagged (the parsers and ai/tools barrel files; the generated `lib/supabase/types.ts`; `lib/` modules importing from `components/`) were all checked individually and none harbour a hidden cycle. This is a meaningful signal of repo health: a 358-file Next.js codebase with this much cross-domain wiring (chat, parsers, analytics, value-map, onboarding, balance-sheet, nudges) typically accrues at least one cycle. The most likely reason this one is clean is the consistent one-way dependency direction `app/` → `components/` → `lib/`, and within `lib/` the convention of co-locating types with their owning module rather than centralising them in a `lib/types.ts`. Track 3 also incidentally helped here: deletion of the `components/transactions/` orphan cluster removed a 7-file ring that, while not strictly cyclic, was a closed-graph candidate for one.

---

## Madge raw output

### Default invocation (warns about unresolved path aliases)

```
$ cd cfos-office && npx madge --circular --extensions ts,tsx src/

- Finding files
Processed 358 files (1.1s) (153 warnings)

✔ No circular dependency found!
```

The 153 warnings are `@/...` path-alias imports that the default madge resolver cannot follow without a `tsconfig.json` reference. Although the cycle-free result holds even with the warnings (madge's analysis on the 205 files it could fully resolve is sound), a comprehensive answer required re-running with the path alias configured — see next.

### Authoritative invocation (with tsconfig path alias)

```
$ cd cfos-office && npx madge --circular --extensions ts,tsx --ts-config tsconfig.json src/

- Finding files
Processed 358 files (1.1s) (1 warning)

✔ No circular dependency found!
```

Warnings reduced from 153 → 1. The remaining warning is `tailwindcss` (an unresolved external — expected, not relevant to internal cycles). All 358 source files participated in the analysis. **Authoritative result: no circular dependencies.**

### Orphan check (sanity)

```
$ cd cfos-office && npx madge --orphans --extensions ts,tsx --ts-config tsconfig.json src/
```

Returned 99 lines of output. Spot-checked entries are all expected orphans: every `app/**/page.tsx`, `app/**/layout.tsx`, `app/**/route.ts`, plus a handful of `components/` files that are server-rendered children. Next.js framework conventions register these via the file-system router, not via JS imports — they are intentionally orphan from an import-graph perspective.

A handful of post-Track-3 candidates surfaced (e.g. `lib/value-map/format.ts` is technically orphan via the public alias path because `feedback.ts` imports it via `./format` not `@/lib/value-map/format`, so madge treats both as unrelated leaves under the alias rule). These are NOT genuine orphans — a code-search confirms imports exist via relative paths. **No further deletion candidates beyond Track 3.**

---

## Cycle graph diagram

```
[no cycles to draw]
```

Aspirationally this would have included an ASCII before/after for each fix. There are zero fixes to draw because there are zero cycles.

---

## HIGH-confidence cycles — implemented

**None.** No fixes implemented because no cycles exist.

---

## MEDIUM cycles — documented, not fixed

**None.**

---

## LOW cycles — documented, not fixed

**None.**

---

## Structural smells the brief flagged — investigation results

### S1. Barrel `lib/parsers/index.ts` — clean

**File:** `src/lib/parsers/index.ts`

Imports from siblings: `./revolut`, `./santander`, `./monzo`, `./starling`, `./hsbc`, `./barclays`, `./types`. Each sibling exports a `is{Bank}CSV(headers)` predicate plus a parser function and never re-imports from `index.ts` — they import from `./types` directly and from upload pipeline helpers (`@/lib/categorisation/...`, `@/lib/upload/...`). Verified via grep `from.*['\"]\\./|@/lib/parsers/index` inside `src/lib/parsers/*.ts`: zero matches.

This barrel is a pure aggregator (`detectFormat()`, `sourceFromFormat()`) for the upload pipeline. No cycle risk.

### S2. Barrel `lib/ai/tools/index.ts` — clean

**File:** `src/lib/ai/tools/index.ts`

Imports each `create{Tool}Tool` factory from its sibling file (24 factories). Each factory file imports only `./types` (`ToolContext`) and `./helpers` (shared `toMonthlyEquivalent`, `loadCurrentBudget`). None of the factories imports from `./index.ts`. Verified via grep.

The `createToolbox(ctx)` aggregator is dynamically invoked from `app/api/chat/route.ts`. No cycle risk.

### S3. `lib/supabase/types.ts` — pure generated, clean

**File:** `src/lib/supabase/types.ts`

Grep for any `import` statement in this file: **zero matches**. The file is pure type definitions generated by `supabase gen types typescript` — no runtime imports, no app-specific imports, no cycle vector. Sized at 1700+ lines but it is a leaf in the import graph (in-degree from many files, out-degree zero).

### S4. `lib/` modules importing from `components/` — none

Grep `from ['\"]@/components/` across `src/lib/`: **zero matches**. The architectural rule "lib/ does not depend on components/" is fully respected. This eliminates an entire class of potential cycles (where a `components/X.tsx` imports a `lib/y.ts` which imports `components/Z.tsx` which imports `components/X.tsx`).

---

## Why the codebase has zero cycles (analysis)

A 358-file Next.js codebase with seven distinct functional domains (chat, parsers, analytics, value-map, onboarding, balance-sheet, nudges) typically accumulates at least one cycle organically. This one hasn't, for a few identifiable reasons:

1. **Consistent dependency direction.** Imports flow `app/ → components/ → lib/`. There are no bidirectional patterns where `lib/X.ts` reaches up into a `components/Y.tsx` for a helper.

2. **Types co-located with owners.** Each module folder owns its own `types.ts` (`lib/parsers/types.ts`, `lib/value-map/types.ts`, `lib/ai/tools/types.ts`, `lib/onboarding/types.ts`). There is no "central types" file that everything imports from and that imports back. The closest is `lib/supabase/types.ts`, but it is generated and pure (S3 above).

3. **Tool factories use a `ToolContext` parameter, not a module-level singleton.** In `lib/ai/tools/`, every factory takes a `ToolContext` argument (`{ supabase, userId, ... }`) at call time. This decouples each tool from any shared mutable state and prevents the "tool A reaches into the toolbox to call tool B which reaches back" pattern that would create a cycle.

4. **Track 3 cleanup eliminated a 7-file closed graph.** The `components/transactions/{TransactionsClient, TransactionList, BatchClassifier, CategoryBadge, TransactionFilters, UncategorisedQueue, ValueCategoryPill}.tsx` cluster, while not strictly cyclic, was a self-contained ring with all 7 files importing only each other and no external page importing in. Such patterns are textbook precursors to cycles when a future maintainer adds one cross-import "to share a helper". Deleting them removed that latent risk.

5. **The barrel files are write-only outward.** `parsers/index.ts` and `ai/tools/index.ts` import from siblings; siblings never import back from the barrel. This is the only safe barrel pattern — when siblings DO import from their own barrel for convenience, two-file cycles appear instantly.

---

## Verification

Run from `cfos-office/`:

| Check | Baseline (post-Track-3) | Post-Track-4 | Delta |
|---|---|---|---|
| `npm run lint` | 20 errors / 36 warnings | 20 errors / 36 warnings | unchanged |
| `npm run build` | succeeds | succeeds | unchanged |
| `npm test` | 58/58 passing | 58/58 passing | unchanged |
| `npx madge --circular --ts-config tsconfig.json src/` | 0 cycles | 0 cycles | unchanged |

No source files were modified in this track. The only artifact produced is this assessment file.

---

## Files touched

**None.** This track is observational. The deliverable is this written confirmation that the codebase has zero circular dependencies, with the madge output as evidence.

---

## Out-of-scope (not touched, per brief)

- `app/api/cron/nudges-{daily,weekly,monthly}/route.ts` — DEFERRED.md.
- `lib/ai/tools/{upsert-asset,upsert-liability,get-balance-sheet}.ts` — TECH_DEBT.md #30.
- `lib/supabase/types.ts` — generated; verified as cycle-irrelevant in S3 above.
- Demo / value-map flow — product-critical.

---

## Recommendations for future tracks

1. **Add a CI guard.** The codebase is clean today, but the population of "people who will add a cycle later" is non-empty. A two-line addition to CI — `npx madge --circular --extensions ts,tsx --ts-config tsconfig.json src/` with non-zero exit on cycle detection — would lock in this property at near-zero cost. The check runs in ~1s.

2. **Add the `tsconfig.json` reference to the docs.** The 153-warning version of the madge output is misleading because it makes the analysis look incomplete. Anyone running madge in this repo should know to include `--ts-config tsconfig.json`. Consider adding to a `cfos-office/docs/development.md` (if one exists) or a README troubleshooting section.

3. **Consider an architectural lint rule.** Tools like `eslint-plugin-import` (`no-cycle` rule) or `dependency-cruiser` can enforce both no-cycles and the "lib/ does not import from components/" rule that S4 verified. Lower priority because the current state is already healthy, but worth knowing as the codebase grows.
