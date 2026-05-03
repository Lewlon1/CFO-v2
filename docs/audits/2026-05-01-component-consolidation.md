# Component Consolidation Audit
> Generated: 2026-05-01 | Branch: `claude/prepare-beta-v2-O1zeV` | Tip: `6e3ba6b`

## Summary

- **CFO avatar duplication: VERIFIED CONSOLIDATABLE — but it's not 1 file vs 1 file, it's 2 visually-different artefacts that overlap in role.** Recommend canonicalising on `brand/CFOAvatar` (proper SVG mascot) and migrating all 14 `chat/cfo-avatar` (£ glyph) call sites. ~60 LOC net delete, low risk.
- **Total opportunities identified:** 6 (1 priority, 2 strong adds, 3 deferred).
- **Recommended for C2:** **3** — CFO avatar + office-dashboard `formatCurrency` extraction + office-dashboard inline empty-state primitive.
- **Deferred to post-v2:** 3 — folder-shell wrapper, trend-chart consolidation, wider `formatCurrency` unification across chat/trips.

---

## 1. CFO avatar consolidation (PRIORITY — C2 anchor)

### Files compared

| File | LOC | Importers | Renders |
|---|---:|---:|---|
| `cfos-office/src/components/chat/cfo-avatar.tsx` | 32 | 9 files / 14 call sites | A `£` glyph in a primary-coloured square |
| `cfos-office/src/components/brand/CFOAvatar.tsx` | 47 | 8 files / 9 call sites | A full SVG mascot (face, glasses, suit) on a gold rectangle |

### Diff summary — these are NOT functionally interchangeable today

| Aspect | `chat/cfo-avatar` (`CfoAvatar`) | `brand/CFOAvatar` (`CFOAvatar`) |
|---|---|---|
| Props | `size?: 'sm'\|'md'\|'lg'`, `status?: 'idle'\|'thinking'`, `className?` | `size: number` (required), `withOnlineDot?: boolean`, `className?` |
| Visual | Single `£` character, primary background, square | SVG mascot — face, glasses, smile, suit silhouette, gold background |
| Animation | `animate-pulse` when `status === 'thinking'` | None (paired with separate `CfoThinking` wrapper for animated states) |
| Status indicator | None | Optional online-dot in bottom-right corner |
| Sizes | Tailwind classes (`w-6 h-6`, `w-8 h-8`, `w-12 h-12`) | Numeric pixel size (24, 28, 38, 44, 48 used in the wild) |

The lowercase `CfoAvatar` is a placeholder glyph from the early chat surface; the PascalCase `CFOAvatar` is the brand mascot introduced in the office redesign. Both are alive because the migration to the new mascot was never completed in the value-map and demo flows.

### Importer map (23 call sites total — A0's count of 17 was *files*, not call sites)

#### `CfoAvatar` (£ glyph) — 14 call sites across 9 files

| File | Line | Props passed |
|---|---:|---|
| `src/components/value-map/value-map-flow.tsx` | 576 | `size="lg"` |
| `src/components/value-map/value-map-flow.tsx` | 660 | `size="lg"` |
| `src/components/value-map/value-map-flow.tsx` | 742 | `size="lg"` |
| `src/components/value-map/value-map-card.tsx` | 370 | `size="sm"` |
| `src/components/value-map/value-map-summary.tsx` | 153 | `size="sm"` |
| `src/components/value-map/cut-or-keep.tsx` | 85 | `size="sm"` |
| `src/components/value-map/one-thing.tsx` | 31 | `size="sm"` |
| `src/components/value-map/retake-impact.tsx` | 63 | `size="lg"` |
| `src/components/value-map/retake-impact.tsx` | 84 | `size="lg"` |
| `src/components/value-map/retake-impact.tsx` | 98 | `size="lg"` |
| `src/components/demo/demo-flow.tsx` | 186 | `size="lg"` |
| `src/components/demo/demo-card.tsx` | 343 | `size="sm"` |
| `src/components/demo/demo-reveal.tsx` | 262 | `size="sm" status={done ? 'idle' : 'thinking'} className="mt-0.5 shrink-0"` |
| *(file-only import, used inside JSX above)* | — | — |

Only **one** call site uses `status="thinking"` (`demo-reveal.tsx:262`). All other sites use the default `idle`.

#### `CFOAvatar` (mascot) — 9 call sites across 8 files

| File | Line | Props passed |
|---|---:|---|
| `src/components/brand/CfoThinking.tsx` | 58 | `size={resolvedSize}` (block variant default 48) |
| `src/components/brand/CfoThinking.tsx` | 82 | `size={resolvedSize}` (inline variant default 28) |
| `src/components/chat/ChatSheet.tsx` | 162 | `size={44} withOnlineDot` |
| `src/components/office/InboxRow.tsx` | 57 | `size={28}` |
| `src/components/onboarding/MessageRenderer.tsx` | 39 | `size={28} className="mt-0.5"` |
| `src/components/onboarding/TypingIndicator.tsx` | 8 | `size={28}` |
| `src/components/onboarding/OnboardingModal.tsx` | 37 | `size={28} className="mt-0.5"` |
| `src/components/onboarding/OnboardingModal.tsx` | 390 | `size={28} withOnlineDot` |
| `src/app/(office)/layout.tsx` | 76 | `size={48} withOnlineDot` |
| `src/app/(office)/office/inbox/InboxClient.tsx` | 102 | `size={38}` |

### Recommended canonical: `brand/CFOAvatar.tsx`

Rationale:
- It's the polished brand artefact (proper SVG, online-dot, used in the office redesign and onboarding modal).
- The £ glyph survives only in the not-yet-migrated value-map and demo flows.
- The £ glyph's `status="thinking"` animation is used at exactly *one* site, and even there can be cleanly replaced by wrapping the mascot in the same `animate-pulse` span (or by using `<CfoThinking inline />` which already exists).

### Proposed final API (no API change required to `CFOAvatar`)

```tsx
<CFOAvatar
  size={number}            // pixel size; map sm→24, md→28, lg→48
  withOnlineDot?: boolean  // existing
  className?: string       // existing
/>
```

No new props needed. The only behavioural decision is the `size` mapping for the migrated sites:
- `size="sm"` (Tailwind `w-6 h-6` = 24px) → `size={24}`
- `size="md"` (currently unused at any call site, but defined as `w-8 h-8` = 32px) → `size={32}`
- `size="lg"` (Tailwind `w-12 h-12` = 48px) → `size={48}`

### Migration plan for C2

1. **Replace** the 14 `CfoAvatar` call sites:
   - Update each `import { CfoAvatar } from '@/components/chat/cfo-avatar'` → `import { CFOAvatar } from '@/components/brand/CFOAvatar'`.
   - Rewrite each JSX site: `<CfoAvatar size="sm" />` → `<CFOAvatar size={24} />`, `size="lg"` → `size={48}`.
   - For `demo-reveal.tsx:262` (the lone `status="thinking"` site), wrap with the same `<span className="animate-pulse">…</span>` idiom that `CfoThinking.tsx` already uses, OR replace the avatar with `<CfoThinking variant="inline" showAvatar={true} ... />`.
2. **Delete** `src/components/chat/cfo-avatar.tsx` (32 LOC).
3. **Run typecheck** — expect zero errors. The two prop surfaces don't overlap, so an accidentally-leftover `status` or string `size` prop will trip the compiler.
4. *(Optional polish)* Re-style the brand mascot at small sizes (24px) and confirm legibility — the SVG is detail-heavy and may need a simplified small variant. If it doesn't read at 24px, we keep the `chat/cfo-avatar.tsx` file for the small-size case OR add a `variant="compact"` prop. **Visual QA pass required before C2 ships.**

**Estimated lines changed:** ~60 net delete (32 from the deleted file + ~28 from migrated imports/usages, partly offset by `+ ~10` if a `<CfoThinking>` wrap is added for the single thinking site).

**Risk:** **low → medium**. Functionally low (typecheck catches API mismatches). Visually medium because the £ glyph is conceptually different from the mascot — Lewis must approve the visual change in value-map and demo before merging. Recommend taking a screenshot pass before/after on the value-map flow and the demo-reveal page.

---

## 2. Folder pages comparison matrix

The four `/office/<folder>/page.tsx` files are thin server components (18–86 LOC) that just fetch data and render `<*Dashboard>` clients. The real UI is in `cfos-office/src/components/office/dashboards/` which already has three shared primitives in active use:

- `Briefing.tsx` — serif "CFO quote" card with accent left-border, signed `— C.`
- `DetailHeader.tsx` — back chevron + title + optional sub-label
- `DrillDownRow.tsx` — clickable row with icon + title + subtitle + chevron

Those three are imported by all four dashboards (`CashFlow`, `NetWorth`, `Values`, `Scenarios`). The shell-level extraction is mostly done.

| Section | CashFlow | NetWorth | Values | Scenarios | Already shared? | Worth extracting? |
|---|:---:|:---:|:---:|:---:|---|---|
| `<DetailHeader title color backHref />` | ✅ | ✅ | ✅ | ✅ | yes | n/a |
| `<Briefing accentColor>{copy}</Briefing>` | ✅ | ✅ | ✅ | ✅ | yes | n/a |
| **Page-specific content section** (different per folder) | inline `MetricsRow + TrendBars + CategoryBreakdown` | inline `HeroTrend + AssetsLiabilitiesRow + Composition` | inline `ArchetypeCard + ValueBreakdown + GapsList` | inline `ActiveScenarioCard + GoalsSection + TripsSection` | naturally divergent | no — domain-specific |
| List of `<DrillDownRow>` items | ✅ (5 rows) | ✅ (4 rows) | ✅ (5 rows) | ✅ (3 rows) | yes | n/a |
| Empty state (no-data path) | inline `EmptyCashFlow` | inline `EmptyNetWorth` | partly inline (archetype null path) | none | **no — both inline, near-duplicate** | **YES — see Extraction B** |
| `formatCurrency` helper | inline copy | inline copy | inline copy | inline copy | **no — 4 identical copies** | **YES — see Extraction A** |
| `formatMonthShort` helper | inline copy | inline copy | n/a | n/a | **no — 2 identical copies** | YES (small) |
| `buildBriefing` helper | per-page | per-page | per-page | per-page | naturally divergent (writes per-domain copy) | no — domain-specific |
| `ACCENT` colour const | per-page | per-page | per-page | per-page | naturally divergent | no — semantic per folder |

**Verdict:** the dashboard shell (header + briefing + drill rows + outer container) is already deduplicated. The two remaining shared patterns are the `formatCurrency` helper and the inline empty state — both addressed below.

A `<FolderShell>` wrapper that further deduplicates the outer `<div className="px-3.5 pt-2 pb-24">` + isLoading skeleton + DetailHeader + Briefing + outer try/catch flow would save ~30 LOC but force every dashboard's data flow into the wrapper's shape. **Medium effort, medium risk for marginal LOC.** Defer.

---

## 3. Top 2 additional v2 extractions

### Extraction A: shared `formatCurrency` helper for office dashboards

**What it replaces:** Eight identical 7-line copies of:

```ts
function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}
```

found at:

| File | Line |
|---|---:|
| `src/components/office/dashboards/CashFlowDashboard.tsx` | 16 |
| `src/components/office/dashboards/NetWorthDashboard.tsx` | 15 |
| `src/components/office/dashboards/ValuesDashboard.tsx` | 21 |
| `src/components/office/dashboards/ScenariosDashboard.tsx` | 12 |
| `src/components/office/sections/CashFlowSection.tsx` | 7 |
| `src/components/office/sections/NetWorthSection.tsx` | 5 |
| `src/components/office/sections/ScenariosSection.tsx` | 18 |
| `src/components/office/OfficeMonthlyOverview.tsx` | 24 |
| `src/components/office/OfficeValuesBreakdown.tsx` | 16 |

(That's 9 sites — Extraction A also catches `OfficeMonthlyOverview` and `OfficeValuesBreakdown` which sit outside `dashboards/` but use the same idiom.)

**Important constraint.** A second `formatCurrency` already exists at `src/lib/constants/dashboard.ts:60` — but it uses **manual symbol mapping with 2 decimals** (`€1,234.56`), while these 9 office copies use **Intl with 0 decimals** (`€1,235`). The two outputs differ. The legacy `dashboard/*` and `balance-sheet/*` components import the 2-decimal variant; the office redesign uses the 0-decimal Intl variant. **Do not unify these two — they're intentionally different conventions.**

**Impact:** ~9 × 7 = **63 lines removed**, replaced by 1 shared helper (~10 LOC) + 9 import lines. Net **~−45 LOC**, and the implementations stay literally identical because they already are.

**Effort:** **low** — pure mechanical extraction. No semantic change.

**Risk:** **low** — output bytes are byte-identical to today.

**Sketch API:**

```ts
// src/lib/utils/format-currency-rounded.ts (proposed name)
export function formatCurrencyRounded(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}
```

(File name kept distinct from `lib/constants/dashboard.ts:formatCurrency` to make the convention difference explicit at import time.)

**Lives at:** `cfos-office/src/lib/utils/format-currency-rounded.ts` (proposed). Could also live at `src/components/office/dashboards/_format.ts` if Lewis prefers co-location with the office tree.

---

### Extraction B: `<DashboardEmptyState>` for the office dashboards

**What it replaces:** Two near-identical inline `Empty*` helper functions inside the dashboards, plus reduces conceptual duplication with the existing `dashboard/EmptyState.tsx` and `balance-sheet/EmptyState.tsx`.

**Sites:**

- `src/components/office/dashboards/CashFlowDashboard.tsx:328–346` — `EmptyCashFlow()`: icon-in-circle + body copy + CTA `Link`.
- `src/components/office/dashboards/NetWorthDashboard.tsx:355–372` — `EmptyNetWorth()`: same shape, no icon, body copy + CTA `Link`.
- (Optional further migration in C2b: `src/components/dashboard/EmptyState.tsx`, `src/components/balance-sheet/EmptyState.tsx` — these are larger components with multi-CTA variants and live on a different design surface; better to leave them for a later pass.)

**Impact:** ~30 LOC removed in the two office dashboards, replaced by ~25-LOC primitive + 2 short call sites. Net **~−10 LOC**, but the consistency win is the bigger payoff (a single empty-state visual idiom across all four office folders going forward).

**Effort:** **low** — both inline functions are <20 LOC; pure mechanical extract.

**Risk:** **low** — visual change is imperceptible if the primitive matches `EmptyCashFlow`'s shape.

**Sketch API:**

```tsx
// src/components/office/dashboards/DashboardEmptyState.tsx (proposed)
interface DashboardEmptyStateProps {
  icon?: ReactNode      // optional icon-in-circle
  body: string          // single-paragraph CFO-voice copy
  actionLabel: string   // CTA text
  actionHref: string    // CTA destination
  accent: string        // accent colour for CTA
}
```

**Lives at:** `cfos-office/src/components/office/dashboards/DashboardEmptyState.tsx` (proposed) — co-located with the other shared dashboard primitives (`Briefing`, `DetailHeader`, `DrillDownRow`).

---

## 4. Deferred to post-v2

| Pattern | Why deferred | Re-evaluate when |
|---|---|---|
| `<FolderShell>` wrapper around dashboards | Would dedupe the outer container + isLoading skeleton, but forces every dashboard's data flow into the wrapper's shape. Medium effort + medium risk for ~30 LOC. | When a 5th folder is added or a global skeleton-pattern change is needed. |
| Trend-chart consolidation across `dashboard/TrendChart`, `dashboard/ValuesTrendChart`, `balance-sheet/NetWorthTrendChart` | All three are 50–100 LOC, render different Recharts shapes (Line/Area/Line), have different domain types. Real refactor with prop-drilling and config-object work. The new office dashboards use inline `TrendBars` instead — there are now *two* trend-chart idioms to reconcile (Recharts vs hand-rolled bars). | Post-v2, when the design language for "trend over time" is finalised across surfaces. |
| Wider `formatCurrency` unification across chat / trips / scenarios result cards | 8 more copies live outside the office tree (in `chat/`, `trips/`, `chat/savedCardBuilders.ts`, `app/(office)/.../patterns/PatternsClient.tsx`). They use a *third* implementation idiom (manual symbol + `toLocaleString('en')`). Different output conventions (some use 0 decimals, one uses 2). Lewis must pick canonical formatting before this can be unified. | When/if Lewis standardises currency display rules globally. |
| `<EmptyState>` unification across `dashboard/`, `balance-sheet/`, `bills/`, `office/dashboards/` | The existing `dashboard/EmptyState` and `balance-sheet/EmptyState` are fully-featured components with chat-context hooks and multi-CTA variants — different surface from the lightweight office-dashboard inline empty states. Trying to unify all four is a high-effort design exercise. Extract only the office-dashboard variant in C2 (Extraction B). | When the legacy `dashboard/*` page is retired or merged into office. |
| CFO-avatar `status="thinking"` consolidation with `CfoThinking` | Currently the £ glyph supports inline pulse-animation as a prop, while `brand/CFOAvatar` requires wrapping in `CfoThinking` for the same effect. After Extraction 1, the migrated `demo-reveal.tsx:262` site can either keep a `<span className="animate-pulse">` wrap or switch to `<CfoThinking variant="inline" />`. Decide during C2 review. | C2 review window. |
| `formatMonthShort` 2-copy duplication (`CashFlowDashboard`, `NetWorthDashboard`) | Trivially small. Best folded into Extraction A's helper file as a sibling export. | Roll into C2. |

---

## 5. Recommended C2 PR scope

Default proposal: ONE PR doing the avatar consolidation plus two small extractions, sequentially. Each commit independently revertable.

- **Commit 1 — `refactor(brand): consolidate CFO avatar onto brand/CFOAvatar`** *(C2 anchor — Lewis-approved)*
  - Migrate 14 `CfoAvatar` call sites to `CFOAvatar`.
  - Delete `src/components/chat/cfo-avatar.tsx`.
  - Wrap `demo-reveal.tsx:262` in `<span className="animate-pulse">` to preserve the thinking-state animation.
  - Visual QA pass on value-map and demo screens before merge.
  - Net: **~−60 LOC**.

- **Commit 2 — `refactor(office): extract shared formatCurrency helper for dashboards`**
  - Add `src/lib/utils/format-currency-rounded.ts` exporting `formatCurrencyRounded` (and optionally `formatMonthShort`).
  - Replace 9 inline copies in `office/dashboards/*`, `office/sections/*`, `OfficeMonthlyOverview`, `OfficeValuesBreakdown` with the import.
  - Leave `lib/constants/dashboard.formatCurrency` (2-decimal variant) untouched.
  - Net: **~−45 LOC**, **zero output change**.

- **Commit 3 — `refactor(office): extract DashboardEmptyState primitive`** *(optional)*
  - Add `src/components/office/dashboards/DashboardEmptyState.tsx`.
  - Replace inline `EmptyCashFlow` and `EmptyNetWorth` helpers in the two dashboards.
  - Net: **~−10 LOC**, consistency win.

If Commit 1's visual QA flags issues with the SVG mascot at `size={24}` (small variant in value-map cards), split into:
- **C2a** — Commits 2 + 3 (zero-risk extractions, ship immediately)
- **C2b** — Commit 1 (avatar consolidation, after design pass on small-size variant)

**Estimated total diff:** ~115 LOC removed, ~50 LOC added → ~−65 net. Comfortably under 500.

---

## What this audit did NOT cover

- Backend / API consolidation (out of scope — v2 is UI cleanup; A1 covered API orphans).
- Hooks consolidation (`useDashboardData`, `useTrends`, `useBalanceSheet`, `useOnboarding` — defer post-v2).
- Style token consolidation (CSS-in-style attributes vs Tailwind classes — defer post-v2).
- Inter-page navigation pattern consolidation (`back` href conventions — defer).
- Knip's wider unused-export findings (already tracked in `cfos-office/docs/cleanup/track-3-dead-code.md`).
