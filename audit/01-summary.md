# Phase 1 — Dead Code Summary

Run from `cfos-office/`. Tools: `knip`, `ts-prune`, `depcheck` (via npx, no install).

## Headline counts

| Metric | Knip | ts-prune |
|---|---:|---:|
| Unused exports | 79 | ~280 (incl. internal re-exports) |
| Unused exported types | 49 | (folded into above) |
| Unused files | 30 | n/a |
| Duplicate exports (named + default) | 17 | n/a |
| Unused dependencies | 1 | n/a |
| Unused devDependencies | 2 | n/a |
| Unlisted binaries | 4 | n/a |

`depcheck` reported 1 dep + 5 devDeps unused; cross-checked below for false positives.

## False positives to ignore

These items appear "unused" but are required and should not be deleted:

- **`react-dom`** (depcheck + knip): Next.js peer dep, required at runtime by react.
- **`@tailwindcss/postcss`, `tailwindcss`** (depcheck only): consumed by `postcss.config.mjs`, not by an `import`.
- **`@types/react-dom`** (depcheck + knip): types used implicitly by TS/Next.
- **`typescript`** (depcheck): obvious — build tool.
- **`tsx`** (depcheck + knip): used by `package.json` scripts via npm.
- **Test files under `src/**/__tests__/*.test.ts` and `tests/onboarding/unit/*.test.ts`** (~14 entries in knip's "unused files" list): false positive. `knip` couldn't load `vitest.config.ts` because `vitest` is referenced as `devDependency` but the install state didn't satisfy the import path; vitest's test discovery is invisible to knip.
- **Default-vs-named pairs in `office/dashboards/*` and `office/sections/*`** (17 "duplicate exports"): these files do `export default function X` *and* `export function X` simultaneously. Not dead — but the duplication is a real low-grade smell (pick one export style).

## Top 10 deletion candidates (high confidence, no judgement call)

These are root-level one-off debugging scripts that have no callers and don't belong in the build. Safe to delete in the cleanup session.

1. `cfos-office/apply-migration.ts`
2. `cfos-office/check-staging.ts`
3. `cfos-office/check-staging2.ts`
4. `cfos-office/check-staging3.ts`
5. `cfos-office/test-normalise.ts`
6. `cfos-office/test-rules.ts`
7. `cfos-office/src/lib/analytics/onboarding-events.ts` (the entire file — `useTrackOnboarding` and types unused; no inbound refs)
8. `cfos-office/src/lib/csv/transform.ts` (knip flags whole file unused)
9. `cfos-office/scripts/_stub-next-headers.ts` (one stubbed export, `cookies`; no callers)
10. `cfos-office/scripts/verify-first-insight.ts` and `cfos-office/scripts/backfill-categories.ts` (verify against `package.json` scripts before deletion — but neither is wired to a script entry)

## Manual review required

Cannot be auto-deleted without human judgement; flag for the cleanup session:

- **`scripts/reextract-portrait.ts`** — *intentionally* an ad-hoc manual tool per `CLAUDE.md` "Failure handling" section. Keep, don't delete.
- **`src/proxy.ts`** (exports `proxy`, `config`) — looks like a Next.js middleware fragment. Verify whether it's referenced via convention (Next.js auto-loads `middleware.ts` not `proxy.ts`, so this may genuinely be dead).
- **`src/lib/analytics/pattern-detectors.ts`** — 12 exported pattern detectors are flagged unused (`merchantFragmentation`, `transactionSizeDistribution`, `categoryConcentration`, `spendingVelocity`, `recurringExpenseTotal`, `dayOfWeekSkew`, `convenienceVsPlanned`, `incomeDetected`, `valueMapGap`, `geographicSpendingModes`, `monthOverMonthTrend`, `balanceTrajectory`). May be called dynamically (string lookup) inside `insight-engine.ts`. Verify before deleting.
- **`src/lib/analytics/insight-engine.ts`** — `computeStatCards`, `computeDisciplineScore`, `assignToLayers`, `determineHook`, `resolveUserCurrency` all flagged. Possibly used cross-file via re-export.
- **`src/components/data/*`** — `MetricTile`, `ValuePill`, `FolderCard`, `FolderMetric`, `MonthSelector`, `CategoryBar`, `TransactionRow`, `FilterPills`, `ProvenanceLine`, `FileRow`, `GapCard`, `SectionTitle` all re-exported from `index.ts` but not imported externally. Either: (a) consumed via barrel import from elsewhere ts-prune didn't catch, or (b) genuinely dead. Phase 3 component audit will resolve.
- **`src/lib/ai/insight-validator.ts`** (`validateNarrative`, `extractMerchants`) — verify whether the chat or review route calls these dynamically.
- **`src/lib/onboarding-v2/intro-headlines.ts` `INTRO_HEADLINES`** — consumed by client component or string lookup? Verify.
- **`src/lib/onboarding-v2/labels.ts` `STRUGGLE_LABELS`** — same.
- **`src/lib/categorisation/normalise-merchant.ts` `getMerchantKey`** — knip flags as duplicate of `normaliseMerchant`. Confirm they're not both needed.
- **`src/lib/ai/provider.ts` `chatModelId`, `opusModelId`, `opusModel`** — exported but ts-prune says "used in module". Maybe exported defensively for future. Low risk to keep.

## Unlisted binaries (knip)

`eslint`, `vitest`, `next`, `tsx` are run from npm scripts but not declared as direct deps (resolved transitively or via npm). Not an issue for the build, but worth tightening in a future hygiene pass.

## Headline interpretation

The codebase has **moderate, not severe**, dead code. The biggest concentrations are:

1. **Root-level one-off debugging scripts** (6 files) — trivially deletable.
2. **Analytics pattern detector functions** — looks like an over-engineered detector framework where many detectors were built but few wired up. Could be a real ~150–300 LOC reduction.
3. **Components in `src/components/data/`** — barrel index re-exports things nothing imports. Phase 3 will confirm whether these were "primitives expansion" (planned for v2.4) that never landed in consumers yet, or stale.

No surprise dependencies. No vendored libraries. Schema/build pipeline looks clean.
