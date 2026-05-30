# Visual Consistency — Phase 3 manifest (P3.0 reconciliation)

**Status:** P3.0 (reconciliation) done. P3.1+ (the surface-by-surface bracket sweep) **deferred** — see the constraint below. Built on Phase 1 + Phase 2 (committed).

## Drift battery — re-run post-Phase-1/2 (occurrences across `src`)

| Class | Count | Migrates to |
|---|---:|---|
| raw hex (`#rrggbb`) | 240 | token utility / `var()` |
| `rgba()/rgb()` | 105 | token utility / `var()` |
| colour-bracket (`bg-[#…]`, `text-[#…]`) | 53 | `bg-*` / `text-*` token utility |
| type-bracket (`text-[Npx]`) | 313 | the named `text-*` scale (Phase 2a) |
| radius-bracket (`rounded-[…]`) | 52 | `rounded-control/card/pill` (Phase 2a) |

(Phase-0 baseline was ~280 colour literals / ~640 spacing+type brackets; numbers are close — Phase 1/2 moved the *source* layer and a few consumers, not the inline brackets.)

## What Phase 1 + 2 already migrated (so it's NOT in the remaining sweep)

- **All JS consumers of `colors` / `folderColors` / `valueCategories`** now receive theme-aware `var()` strings (the tokens.ts demotion). That includes the **charts** (`ValuesDonut`, `ValuesTrendChart` read `valueCategories.*.color` = `var(--value-*)` — render via CSS vars, both themes) and the office Values dashboards/breakdown. P3.3's "charts → var accessors" is effectively satisfied; an optional cosmetic pass can swap `valueCategories.x.color` → `valueColors.x`.
- **`VALUE_COLORS` (dashboard) + `QUADRANTS` (value-map)** repointed onto the canonical `bg-value-*` utilities / `valueColors` var strings; the Foundation/Investment inversion is resolved at the token layer.
- **Primitives + scales exist** to migrate *onto*: `Card`/`Badge`/`Input`/`Textarea`/`Button`, `rounded-control/card/pill`, `text-display…text-nano`, `bg-value-*`/`bg-folder-*`.

## Remaining (the P3.1+ sweep) — surface order

1. **Prove-the-loop** — smallest surface exercising a colour token + a primitive + a scale; land clean first.
2. **Critical path:** onboarding → value-map → the 4 office folders (Cash Flow, Net Worth, Values, Goals).
3. **Secondary:** settings, export, admin, demo.

Top offender files (Phase-0 spacing/type counts): `HoldingsPreview` (27), `OfficeMonthlyOverview` (15), `DataComponents`/`StructuredInput`/`BillUploadModal` (11 each), `DataManagement` (10), `ChatSheet` (9), `NetWorthDashboard`/`GoalCard` (8). Also the `dark:text-{emerald|red|amber}-*` palette usages (bills/upload, ~19) → semantic tokens (`text-positive/negative`), which also closes the inert-`dark:` issue (Phase 1c).

## Special cases (P3.3) — decisions

- **Charts:** already on `var()` strings (Phase 1). Verify each series renders in both themes when the sweep reaches them; optional accessor tidy.
- **`api/balance-sheet/route.ts`** emits folder/value hexes in its payload (a server route doing presentation). Preferred: stop emitting colour, resolve the token client-side by category id. That implies a client change → **own sub-phase or deferred**, not smuggled into a styling pass.
- **`CATEGORY_COLORS`** (dashboard.ts) mirrors the DB `categories.color` column — **out of scope** (DB-coupled; a staging migration + manual prod, not a styling change).

## ⚠️ Constraint blocking P3.1+ here

Phase 3 §P3.4 **mandates per-surface visual verification in both themes** (and as Dorcas where data-driven). A Next **dev server will not stay up in this git worktree under the harness tooling** (`next dev` exits 1 with no output; `next build` is fine). Migrating ~640 visual brackets **blind** risks regressions build+grep cannot catch — line-height shifts (the `--text-*` tokens carry paired line-heights), light-mode colour-context flips (raw white-`rgba` borders are invisible in light; the tokens are not), and hover/active states.

**Recommendation:** run the P3.1+ sweep with a working preview — either after Phase 1+2 merge (a normal checkout previews fine) or in a local `npm run dev`. Each surface: migrate → build + grep (zero raw hex/bracket, scales applied, scope clean) → eyeball both themes → commit.
