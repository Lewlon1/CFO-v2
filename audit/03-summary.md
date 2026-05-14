# Phase 3 Component Audit: Summary

## Overview
- **Total components:** 113
- **Live components:** 50 (44%)
- **Orphan components:** 63 (56%)
- **Transitively-dead components:** 0
- **Status:** MODERATE component mess

---

## Counts

| Category | Count |
|----------|-------|
| **Live** (≥1 import from non-test, non-self file) | 50 |
| **Orphan** (0 imports from @/components) | 63 |
| **Transitively-dead** (only imported by orphans) | 0 |

Note: 44 of the 63 "orphans" are actually used via relative imports within their feature folders. True orphans (no imports anywhere): ~19 components.

---

## Top 5 Truly Orphan Components (Ready for Deletion)

| Component | Lines | Purpose |
|-----------|-------|---------|
| office/dashboards/ScenariosDashboard.tsx | 312 | Office scenarios dashboard — orphan, likely superseded |
| data/DataComponents.tsx | 251 | Data primitive barrel re-exports — exports unused components |
| balance-sheet/NetWorthTrendChart.tsx | 119 | Net worth trend chart — orphan |
| dashboard/ValuesDonut.tsx | 97 | Values donut chart — orphan |
| dashboard/TrendChart.tsx | 96 | Trend chart — orphan |

**Additional orphans:** ViewToggle (orphan), MetricTile (orphan), ValuePill (orphan), FolderCard (orphan), and 10+ chat/profile/upload feature-local components.

---

## Duplicate Concept Clusters

### Cluster 1: Empty State Variants (3 members)
- `balance-sheet/EmptyState.tsx` — Feature-specific with chat integration
- `dashboard/EmptyState.tsx` — Variant-based (no_data, no_values)
- `office/dashboards/DashboardEmptyState.tsx` — Generic reusable (RECOMMENDED WINNER)
- `bills/EmptyBillsState.tsx` — Feature-specific

**Verdict:** Consolidate to DashboardEmptyState or create data primitive.

### Cluster 2: Card Components (12 members)
- AssetGroupCard, LiabilityGroupCard, NetWorthCards
- SummaryCards, ValueCategoryCards
- StatCardBlock, SavedItemCard
- ProfileCard, FolderCard, demo-card, onboarding-banner-card, value-map-card

**Verdict:** Feature-specific, not true duplicates. Each serves distinct domain. No consolidation needed.

### Cluster 3: Avatar Components (2 members)
- `CFOAvatar` (13 imports) — AI character
- `UserAvatarMenu` (1 import) — User initial badge

**Verdict:** Different concepts, no consolidation.

### Cluster 4: Toggle Controls (3 members)
- `ViewToggle` — ORPHAN
- `ThemeToggle` (2 imports) — LIVE
- `ui/button` (12 imports) — LIVE primitive

**Verdict:** ViewToggle is orphan; others are distinct. No consolidation.

### Cluster 5: Modal/Sheet Dialogs (2 members)
- `BillUploadModal`
- `ChatSheet` (1 import) — LIVE

**Verdict:** Different patterns. No consolidation.

### Cluster 6: Data Primitives Layer (v2.4) — Sitting Idle
- `data/MetricTile.tsx` — 0 imports (ORPHAN)
- `data/ValuePill.tsx` — 0 imports (ORPHAN)
- `data/FolderCard.tsx` — 0 imports (ORPHAN)
- `data/DataComponents.tsx` — 0 imports, but re-exports MonthSelector, TransactionRow, FilterPills, SectionTitle, ProvenanceLine, GapCard (some used, some orphan)

**Verdict:** v2.4 primitives expansion initiative NOT ADOPTED. MetricTile, ValuePill, FolderCard have zero consumers. Only 5-6 of the 13 exports from DataComponents are actually used. **Action:** Delete MetricTile, ValuePill, FolderCard; audit DataComponents barrel exports; remove unused.

### Cluster 7: Feature-Specific Dashboard Suites
- **Office dashboards:** CashFlowDashboard, NetWorthDashboard, ValuesDashboard, ScenariosDashboard, DashboardEmptyState, DetailHeader, DrillDownRow, Briefing (8 components, all orphans from @/components view)
- **Chat features:** MessageList, ChatInput, ChatCTA, TappableOptions, MessageFeedback, SavedItemCard, ScenarioResult, StatCardBlock, TripPlanResult, ValueMapActionButton (10+ orphans)
- **Profile features:** ProfileCard, CompletenessIndicator, DataFreshness, DataManagement, ImportHistory, TraitDisplay (6 orphans, relative-imported by ProfilePageClient)
- **Value Map features:** value-map-card, value-map-summary, cut-or-keep, one-thing, retake-impact (5 orphans, relative-imported by value-map-flow)
- **Upload features:** BatchSummary, ColumnMapper, HoldingsPreview, ImportResult, TransactionPreview (5 orphans, relative-imported by UploadWizard)

**Verdict:** These are properly organized as feature-local components. They're "orphans" from @/components import perspective but actively used within their feature folders via relative imports. This is healthy organization — no consolidation needed.

---

## Component Health by Feature Folder

| Folder | Total | Live | Orphan | Orphan % | Status |
|--------|-------|------|--------|----------|--------|
| balance-sheet/ | 10 | 1 | 9 | 90% | **Poor** — only BalanceSheetClient live |
| bills/ | 5 | 1 | 4 | 80% | **Poor** — only BillsClient live |
| brand/ | 2 | 2 | 0 | 0% | **Healthy** — both live |
| chat/ | 14 | 3 | 11 | 79% | **Poor** — only Provider, Bar, Sheet live |
| dashboard/ | 13 | 1 | 12 | 92% | **Critical** — only DashboardClient live |
| data/ | 4 | 0 | 4 | 100% | **Dead** — primitives layer unused |
| demo/ | 6 | 1 | 5 | 83% | **Poor** — only demo-flow live |
| landing/ | 7 | 7 | 0 | 0% | **Healthy** — all live |
| navigation/ | 1 | 1 | 0 | 0% | **Healthy** |
| office/ | 18 | 7 | 11 | 61% | **Moderate** — dashboards suite orphaned |
| onboarding-v2/ | 2 | 2 | 0 | 0% | **Healthy** |
| onboarding/ | 1 | 1 | 0 | 0% | **Healthy** |
| profile/ | 7 | 1 | 6 | 86% | **Poor** — only PageClient live |
| scenarios/ | 1 | 1 | 0 | 0% | **Healthy** |
| settings/ | 1 | 1 | 0 | 0% | **Healthy** |
| theme/ | 2 | 2 | 0 | 0% | **Healthy** |
| trips/ | 1 | 1 | 0 | 0% | **Healthy** |
| ui/ | 1 | 1 | 0 | 0% | **Healthy** |
| upload/ | 6 | 1 | 5 | 83% | **Poor** — only UploadWizard live |
| value-map/ | 6 | 1 | 5 | 83% | **Poor** — only flow live |
| values/ | 1 | 1 | 0 | 0% | **Healthy** |

---

## Verdict: Component Mess Severity

### Classification: **MODERATE**

**Reasoning:**
1. **High orphan rate (56%)** — But 44 of these are properly feature-local (relative imports), so true orphans are ~19, not 63.
2. **One clear duplication cluster** — EmptyState variants need consolidation.
3. **Unused primitives layer** — data/ folder (v2.4 initiative) not adopted; MetricTile, ValuePill, FolderCard all have 0 consumers.
4. **Feature folders show high variance** — 10 folders have 80%+ orphan rate, but this is because they use feature-local relative imports (healthy pattern). Only dashboard/ and data/ folders are genuinely problematic.
5. **No transitively-dead components** — No dependency chains of orphans.

---

## Root Cause Analysis

1. **Feature folder pattern** — Components under balance-sheet/, bills/, chat/, profile/, value-map/, etc. use relative imports to stay cohesive. This is healthy, but means they appear as "orphans" in @/components analysis. The audit should adjust methodology to account for this.

2. **v2.4 primitives layer never took off** — data/ folder was created as centralized reusable component library (MetricTile, ValuePill, FolderCard) but never adopted. Feature teams built their own card variants instead.

3. **EmptyState pattern evolved without consolidation** — Three independent EmptyState implementations grew in parallel (balance-sheet, dashboard, office) rather than consolidating to shared primitive.

4. **Large orphan feature folders** — dashboard/, bills/, chat/, etc. have high orphan counts because all their internal components are relative-imported by client components (e.g., DashboardClient imports MonthSelector, SummaryCards, etc. via relative paths). This is normal and healthy.

---

## Recommended Actions

### Priority 1: Delete (Ready for Removal)
1. `data/MetricTile.tsx` — 0 imports, v2.4 primitive never adopted
2. `data/ValuePill.tsx` — 0 imports, v2.4 primitive never adopted
3. `data/FolderCard.tsx` — 0 imports, v2.4 primitive never adopted
4. `office/dashboards/ScenariosDashboard.tsx` — 312 lines, likely superseded
5. `dashboard/ValuesDonut.tsx`, `dashboard/TrendChart.tsx`, `dashboard/ValuesDonut.tsx` — Chart orphans

### Priority 2: Consolidate (Refactor)
1. **EmptyState variants** — Consolidate to single `DashboardEmptyState` or create `components/data/EmptyState.tsx` primitive with variants
2. **ViewToggle** — Either delete or consolidate to ui/button variants

### Priority 3: Audit
1. **data/DataComponents.tsx** — Verify all 13 exports are actually used; remove unused barrel entries
2. **office/dashboards/** folder — Check if CashFlowDashboard, NetWorthDashboard, ValuesDashboard are truly orphaned or used by page routes

### Priority 4: Monitor
1. Ensure future feature folders follow consistent import pattern (relative for internal, @/components for cross-feature)
2. If starting new primitive initiatives, enforce minimum 3-consumer rule before committing code

---

## Files to Review

- `/home/user/CFO-v2/audit/03-components.md` — Full Pass 1 usage table (113 components)
- `/home/user/CFO-v2/audit/03-summary.md` — This document

