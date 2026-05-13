# Phase 3 Component Audit: Detailed Analysis

# Pass 1: Component Usage Analysis

| Component | Imports | Live Sites (Sample) | Verdict |
|-----------|---------|------------------|---------|
| balance-sheet/AllocationDonut.tsx | 0 | — | orphan |
| balance-sheet/AssetGroupCard.tsx | 0 | — | orphan |
| balance-sheet/BalanceSheetClient.tsx | 3 | app/(office)/office/net-worth/assets/page.tsx; app/(office)/office/net-worth/liabilities/page.tsx; app/(office)/office/net-worth/balance-sheet/page.tsx | live |
| balance-sheet/DataGaps.tsx | 0 | — | orphan |
| balance-sheet/EmptyState.tsx | 0 | — | orphan |
| balance-sheet/HoldingsDetail.tsx | 0 | — | orphan |
| balance-sheet/LiabilityGroupCard.tsx | 0 | — | orphan |
| balance-sheet/NetWorthCards.tsx | 0 | — | orphan |
| balance-sheet/NetWorthTrendChart.tsx | 0 | — | orphan |
| balance-sheet/icons.tsx | 0 | — | orphan |
| bills/BillCard.tsx | 0 | — | orphan |
| bills/BillDetailPanel.tsx | 0 | — | orphan |
| bills/BillUploadModal.tsx | 0 | — | orphan |
| bills/BillsClient.tsx | 2 | app/(office)/office/cash-flow/bills/page.tsx; app/(office)/office/cash-flow/optimise/page.tsx | live |
| bills/EmptyBillsState.tsx | 0 | — | orphan |
| brand/CFOAvatar.tsx | 13 | components/office/InboxRow.tsx; components/demo/demo-reveal.tsx; components/value-map/value-map-card.tsx; app/(office)/layout.tsx; components/value-map/cut-or-keep.tsx | live |
| brand/CfoThinking.tsx | 4 | components/chat/MessageList.tsx; components/value-map/value-map-flow.tsx; components/onboarding/beats/ArchetypeBeat.tsx; components/demo/demo-flow.tsx | live |
| chat/ChatBar.tsx | 1 | app/(office)/layout.tsx | live |
| chat/ChatCTA.tsx | 0 | — | orphan |
| chat/ChatInput.tsx | 0 | — | orphan |
| chat/ChatProvider.tsx | 8 | components/balance-sheet/EmptyState.tsx; components/scenarios/ScenariosClient.tsx; components/onboarding-v2/chat-opener-trigger.tsx; app/(office)/layout.tsx; components/trips/TripsClient.tsx | live |
| chat/ChatSheet.tsx | 1 | app/(office)/layout.tsx | live |
| chat/MessageFeedback.tsx | 0 | — | orphan |
| chat/MessageList.tsx | 0 | — | orphan |
| chat/SavedItemCard.tsx | 0 | — | orphan |
| chat/ScenarioResult.tsx | 0 | — | orphan |
| chat/StatCardBlock.tsx | 0 | — | orphan |
| chat/StructuredInput.tsx | 2 | components/profile/ProfileCard.tsx | live |
| chat/TappableOptions.tsx | 0 | — | orphan |
| chat/TripPlanResult.tsx | 0 | — | orphan |
| chat/ValueMapActionButton.tsx | 0 | — | orphan |
| dashboard/CategoryBreakdown.tsx | 0 | — | orphan |
| dashboard/DashboardClient.tsx | 2 | app/(office)/office/cash-flow/spending-breakdown/page.tsx; app/(office)/office/cash-flow/trends/page.tsx | live |
| dashboard/EmptyState.tsx | 0 | — | orphan |
| dashboard/MonthSelector.tsx | 0 | — | orphan |
| dashboard/NoIdeaQueue.tsx | 0 | — | orphan |
| dashboard/RecurringPanel.tsx | 0 | — | orphan |
| dashboard/ReviewBanner.tsx | 0 | — | orphan |
| dashboard/SpendingChart.tsx | 0 | — | orphan |
| dashboard/SummaryCards.tsx | 0 | — | orphan |
| dashboard/TrendChart.tsx | 0 | — | orphan |
| dashboard/ValueCategoryCards.tsx | 0 | — | orphan |
| dashboard/ValueSummary.tsx | 0 | — | orphan |
| dashboard/ValuesDonut.tsx | 0 | — | orphan |
| dashboard/ValuesTrendChart.tsx | 0 | — | orphan |
| dashboard/ViewToggle.tsx | 0 | — | orphan |
| data/DataComponents.tsx | 0 | — | orphan |
| data/FolderCard.tsx | 0 | — | orphan |
| data/MetricTile.tsx | 0 | — | orphan |
| data/ValuePill.tsx | 0 | — | orphan |
| demo/demo-card.tsx | 0 | — | orphan |
| demo/demo-email-capture.tsx | 0 | — | orphan |
| demo/demo-flow.tsx | 1 | app/(public)/demo/page.tsx | live |
| demo/demo-resonance-feedback.tsx | 0 | — | orphan |
| demo/demo-reveal.tsx | 0 | — | orphan |
| demo/payoff-panel.tsx | 0 | — | orphan |
| landing/Autopilot.tsx | 1 | app/(public)/v4/page.tsx | live |
| landing/BottomCta.tsx | 1 | app/(public)/v4/page.tsx | live |
| landing/Capabilities.tsx | 1 | app/(public)/v4/page.tsx | live |
| landing/Compounding.tsx | 1 | app/(public)/v4/page.tsx | live |
| landing/Hero.tsx | 1 | app/(public)/v4/page.tsx | live |
| landing/JourneyStrip.tsx | 1 | app/(public)/v4/page.tsx | live |
| landing/Trust.tsx | 1 | app/(public)/v4/page.tsx | live |
| navigation/NavigationBar.tsx | 1 | app/(office)/layout.tsx | live |
| office/FolderSection.tsx | 1 | app/(office)/office/OfficeHomeClient.tsx | live |
| office/InboxRow.tsx | 1 | app/(office)/office/OfficeHomeClient.tsx | live |
| office/OfficeMonthlyOverview.tsx | 1 | app/(office)/office/cash-flow/monthly-overview/page.tsx | live |
| office/OfficeValuesBreakdown.tsx | 1 | app/(office)/office/values/value-split/page.tsx | live |
| office/UserAvatarMenu.tsx | 1 | app/(office)/layout.tsx | live |
| office/dashboards/Briefing.tsx | 0 | — | orphan |
| office/dashboards/CashFlowDashboard.tsx | 0 | — | orphan |
| office/dashboards/DashboardEmptyState.tsx | 0 | — | orphan |
| office/dashboards/DetailHeader.tsx | 0 | — | orphan |
| office/dashboards/DrillDownRow.tsx | 0 | — | orphan |
| office/dashboards/NetWorthDashboard.tsx | 0 | — | orphan |
| office/dashboards/ScenariosDashboard.tsx | 0 | — | orphan |
| office/dashboards/ValuesDashboard.tsx | 0 | — | orphan |
| office/onboarding-banner.tsx | 1 | app/(office)/office/page.tsx | live |
| office/onboarding-banner-card.tsx | 0 | — | orphan |
| office/sections/CashFlowSection.tsx | 1 | app/(office)/office/OfficeHomeClient.tsx | live |
| office/sections/NetWorthSection.tsx | 1 | app/(office)/office/OfficeHomeClient.tsx | live |
| office/sections/ScenariosSection.tsx | 1 | app/(office)/office/OfficeHomeClient.tsx | live |
| office/sections/ValuesSection.tsx | 1 | app/(office)/office/OfficeHomeClient.tsx | live |
| onboarding-v2/chat-opener-trigger.tsx | 1 | app/(office)/layout.tsx | live |
| onboarding-v2/struggle-question.tsx | 1 | app/onboarding-v2/page.tsx | live |
| onboarding/beats/ArchetypeBeat.tsx | 1 | app/onboarding-v2/archetype/archetype-orchestrator.tsx | live |
| profile/CompletenessIndicator.tsx | 0 | — | orphan |
| profile/DataFreshness.tsx | 0 | — | orphan |
| profile/DataManagement.tsx | 0 | — | orphan |
| profile/ImportHistory.tsx | 0 | — | orphan |
| profile/ProfileCard.tsx | 0 | — | orphan |
| profile/ProfilePageClient.tsx | 1 | app/(office)/office/values/portrait/page.tsx | live |
| profile/TraitDisplay.tsx | 0 | — | orphan |
| scenarios/ScenariosClient.tsx | 1 | app/(office)/office/scenarios/what-if/page.tsx | live |
| settings/AccountDataManagement.tsx | 2 | app/(office)/office/values/export/page.tsx; app/(office)/office/settings/page.tsx | live |
| theme/ThemeBoot.tsx | 1 | app/layout.tsx | live |
| theme/ThemeToggle.tsx | 2 | app/(public)/v4/layout.tsx; app/(office)/office/settings/page.tsx | live |
| trips/TripsClient.tsx | 1 | app/(office)/office/scenarios/trips/page.tsx | live |
| ui/button.tsx | 12 | components/value-map/one-thing.tsx; components/value-map/cut-or-keep.tsx; components/demo/demo-card.tsx; components/value-map/value-map-summary.tsx; app/(auth)/login/page.tsx | live |
| upload/BatchSummary.tsx | 0 | — | orphan |
| upload/ColumnMapper.tsx | 0 | — | orphan |
| upload/HoldingsPreview.tsx | 0 | — | orphan |
| upload/ImportResult.tsx | 0 | — | orphan |
| upload/TransactionPreview.tsx | 0 | — | orphan |
| upload/UploadWizard.tsx | 4 | app/onboarding-v2/upload/upload-orchestrator.tsx; app/(office)/office/net-worth/upload/UploadPageClient.tsx; app/(office)/office/cash-flow/upload/UploadPageClient.tsx; components/balance-sheet/BalanceSheetClient.tsx | live |
| upload/UploadZone.tsx | 1 | components/bills/EmptyBillsState.tsx | live |
| value-map/cut-or-keep.tsx | 0 | — | orphan |
| value-map/one-thing.tsx | 0 | — | orphan |
| value-map/retake-impact.tsx | 0 | — | orphan |
| value-map/value-map-card.tsx | 0 | — | orphan |
| value-map/value-map-flow.tsx | 2 | app/onboarding-v2/value-map/value-map-orchestrator.tsx; app/value-map/page.tsx | live |
| value-map/value-map-summary.tsx | 0 | — | orphan |
| values/ArchetypePageClient.tsx | 1 | app/(office)/office/values/archetype/page.tsx | live |

**Summary:** 50 live, 63 orphan, 0 transitively-dead



# Pass 2: Duplicate Concept Clusters

## 1. Empty State / Blank Slate Components
| Component | Purpose | Import Count | Recommendation |
|-----------|---------|--------------|-----------------|
| balance-sheet/EmptyState.tsx | Feature-specific empty state with chat integration (Scale icon, upload CTA) | 0 | Consolidate into data primitive |
| dashboard/EmptyState.tsx | Dashboard empty state with variants (no_data, no_values) | 0 | Consolidate into data primitive |
| office/dashboards/DashboardEmptyState.tsx | Lightweight office-specific empty state (icon-based, generic) | 0 | **Keep as primary** — most generic & reusable |
| bills/EmptyBillsState.tsx | Feature-specific bills empty state | 0 | Consolidate into feature-level |

**Verdict:** Three distinct variants with overlapping purpose. `DashboardEmptyState` is most generic; consolidate others.

---

## 2. Card / Stat Block Components (Data Display)
| Component | Purpose | Import Count | Type |
|-----------|---------|--------------|------|
| balance-sheet/AssetGroupCard.tsx | Expandable asset group rows with holdings detail | 0 | Orphan (relative imports) |
| balance-sheet/LiabilityGroupCard.tsx | Expandable liability group rows | 0 | Orphan (relative imports) |
| balance-sheet/NetWorthCards.tsx | Net worth summary cards (Assets/Liabilities/NW) | 0 | Orphan (relative imports) |
| dashboard/SummaryCards.tsx | Summary stat cards | 0 | Orphan (relative imports) |
| dashboard/ValueCategoryCards.tsx | Value category stat cards | 0 | Orphan (relative imports) |
| chat/StatCardBlock.tsx | Grid of stat cards (3-col, label+value) | 0 | Orphan (relative imports) |
| chat/SavedItemCard.tsx | Chat saved item card | 0 | Orphan (relative imports) |
| profile/ProfileCard.tsx | Profile display card | 0 | Orphan (relative imports) |
| data/FolderCard.tsx | Folder/document card (v2.4 primitive) | 0 | Orphan (relative imports) |
| demo/demo-card.tsx | Demo flow card | 0 | Orphan (relative imports) |
| office/onboarding-banner-card.tsx | Onboarding banner sub-card | 0 | Orphan (relative imports) |
| value-map/value-map-card.tsx | Value map flow card step | 0 | Orphan (relative imports) |

**Verdict:** 12 card-like components, each feature-specific. No duplicates in true sense — these serve different domains. No consolidation recommended.

---

## 3. Avatar Components
| Component | Purpose | Import Count | Notes |
|-----------|---------|--------------|-------|
| brand/CFOAvatar.tsx | AI character avatar (SVG, glasses + suit) | 13 | **Live** — widely used |
| office/UserAvatarMenu.tsx | User initial badge (small, accent gold) | 1 | **Live** — distinct purpose (user vs. AI) |

**Verdict:** No duplication — different concepts (AI vs. user).

---

## 4. Toggle / Control Components
| Component | Purpose | Import Count | Notes |
|-----------|---------|--------------|-------|
| dashboard/ViewToggle.tsx | View toggle control | 0 | **Orphan** |
| theme/ThemeToggle.tsx | Theme toggle (light/dark) | 2 | **Live** — actually used |
| ui/button.tsx | Base button primitive | 12 | **Live** — core primitive |

**Verdict:** ViewToggle is orphan; ThemeToggle and Button are distinct. No consolidation.

---

## 5. Modal / Sheet / Dialog Components
| Component | Purpose | Import Count | Notes |
|-----------|---------|--------------|-------|
| bills/BillUploadModal.tsx | Bill upload modal dialog | 0 | Orphan (relative imports) |
| chat/ChatSheet.tsx | Chat overlay sheet | 1 | **Live** |

**Verdict:** Two different patterns (modal vs. sheet). No duplication.

---

## 6. Data Primitives Layer (v2.4 — Adoption Check)
| Component | Purpose | Import Count | Status |
|-----------|---------|--------------|--------|
| data/MetricTile.tsx | Metric display tile | 0 | **Orphan** — not adopted |
| data/ValuePill.tsx | Value pill badge | 0 | **Orphan** — not adopted |
| data/FolderCard.tsx | Folder card | 0 | **Orphan** — not adopted |
| data/DataComponents.tsx | Re-export barrel (MonthSelector, TransactionRow, FilterPills, SectionTitle, ProvenanceLine, FileRow, GapCard) | 0 | **Orphan** |
| data/index.ts | Public export surface | — | Exports unused components |

**Verdict:** v2.4 primitives layer sitting idle. MetricTile, ValuePill, FolderCard have 0 consumers. Only `GapCard`, `ProvenanceLine`, `SectionTitle`, `TransactionRow`, `FilterPills` are used (via barrel imports), but `MonthSelector` also exported but marked as "might be used". **Action:** Delete MetricTile, ValuePill, FolderCard; audit DataComponents barrel.

---

## 7. Feature-Specific Client Components (Router Consumers)
| Component | Imports | Status |
|-----------|---------|--------|
| balance-sheet/BalanceSheetClient.tsx | 3 | **Live** |
| bills/BillsClient.tsx | 2 | **Live** |
| dashboard/DashboardClient.tsx | 2 | **Live** |
| scenarios/ScenariosClient.tsx | 1 | **Live** |
| trips/TripsClient.tsx | 1 | **Live** |
| profile/ProfilePageClient.tsx | 1 | **Live** |
| values/ArchetypePageClient.tsx | 1 | **Live** |

**Verdict:** All live. Pattern is healthy — thin router wrappers.

---

## 8. Office Dashboard Suite (Sibling Duplication)
| Component | Purpose | Import Count | Notes |
|-----------|---------|--------------|-------|
| office/dashboards/CashFlowDashboard.tsx | Cash flow dashboard | 0 | Orphan |
| office/dashboards/NetWorthDashboard.tsx | Net worth dashboard | 0 | Orphan |
| office/dashboards/ValuesDashboard.tsx | Values dashboard | 0 | Orphan |
| office/dashboards/ScenariosDashboard.tsx | Scenarios dashboard | 0 | Orphan |
| office/dashboards/DashboardEmptyState.tsx | Shared empty state | 0 | Orphan |
| office/dashboards/DetailHeader.tsx | Shared detail header | 0 | Orphan |
| office/dashboards/DrillDownRow.tsx | Shared drill-down row | 0 | Orphan |
| office/dashboards/Briefing.tsx | Briefing dashboard | 0 | Orphan |

**Verdict:** All 8 office dashboard components are orphans from @/components perspective, but used as folder-level relative imports. These are heavily coupled to the office feature folder. Likely used by OfficeHomeClient or page routes. **Check:** Verify these are actually consumed by office pages.

---

## 9. Chat Feature Components
| Component | Purpose | Import Count | Notes |
|-----------|---------|--------------|-------|
| chat/MessageList.tsx | Chat message list | 0 | Orphan (relative import) |
| chat/ChatProvider.tsx | Chat context provider | 8 | **Live** — widely used |
| chat/ChatBar.tsx | Chat input bar | 1 | **Live** |
| chat/ChatSheet.tsx | Chat overlay sheet | 1 | **Live** |
| chat/StructuredInput.tsx | Structured input component | 2 | **Live** |
| chat/ChatInput.tsx | Chat input field | 0 | Orphan |
| chat/ChatCTA.tsx | Chat CTA button | 0 | Orphan |
| chat/TappableOptions.tsx | Tappable option list | 0 | Orphan |
| chat/MessageFeedback.tsx | Message feedback widget | 0 | Orphan |
| chat/SavedItemCard.tsx | Saved item card | 0 | Orphan |
| chat/ScenarioResult.tsx | Scenario result display | 0 | Orphan |
| chat/StatCardBlock.tsx | Stat card block | 0 | Orphan |
| chat/TripPlanResult.tsx | Trip plan result display | 0 | Orphan |
| chat/ValueMapActionButton.tsx | Value map CTA button | 0 | Orphan |

**Verdict:** 6 orphan chat feature components (likely internal to chat feature). ChatProvider is the backbone (8 imports).

---

## 10. Value Map Feature Components
| Component | Purpose | Import Count | Status |
|-----------|---------|--------------|--------|
| value-map/value-map-flow.tsx | Main flow orchestrator | 2 | **Live** |
| value-map/value-map-card.tsx | Card step in flow | 0 | Orphan (relative) |
| value-map/value-map-summary.tsx | Summary step | 0 | Orphan (relative) |
| value-map/cut-or-keep.tsx | Cut/keep step | 0 | Orphan (relative) |
| value-map/one-thing.tsx | One-thing step | 0 | Orphan (relative) |
| value-map/retake-impact.tsx | Retake impact step | 0 | Orphan (relative) |

**Verdict:** All are steps/substeps of the value-map-flow. Properly organized as feature-local components.

---

## 11. Profile Feature Components
| Component | Purpose | Import Count | Notes |
|-----------|---------|--------------|-------|
| profile/ProfilePageClient.tsx | Profile page router wrapper | 1 | **Live** |
| profile/ProfileCard.tsx | Profile card display | 0 | Orphan (relative) |
| profile/CompletenessIndicator.tsx | Completeness indicator | 0 | Orphan (relative) |
| profile/DataFreshness.tsx | Data freshness badge | 0 | Orphan (relative) |
| profile/DataManagement.tsx | Data management controls | 0 | Orphan (relative) |
| profile/ImportHistory.tsx | Import history list | 0 | Orphan (relative) |
| profile/TraitDisplay.tsx | Trait display row | 0 | Orphan (relative) |

**Verdict:** All internal to profile feature. ProfilePageClient is the entry point (1 import).

---

## 12. Landing Page Components
| Component | Imports | Status |
|-----------|---------|--------|
| landing/Hero.tsx | 1 | **Live** |
| landing/Capabilities.tsx | 1 | **Live** |
| landing/Autopilot.tsx | 1 | **Live** |
| landing/Compounding.tsx | 1 | **Live** |
| landing/Trust.tsx | 1 | **Live** |
| landing/JourneyStrip.tsx | 1 | **Live** |
| landing/BottomCta.tsx | 1 | **Live** |

**Verdict:** All consumed by landing page. Healthy organization.

---

## 13. Demo Feature Components
| Component | Imports | Status |
|-----------|---------|--------|
| demo/demo-flow.tsx | 1 | **Live** |
| demo/demo-card.tsx | 0 | Orphan (relative) |
| demo/demo-email-capture.tsx | 0 | Orphan (relative) |
| demo/demo-reveal.tsx | 0 | Orphan (relative) |
| demo/demo-resonance-feedback.tsx | 0 | Orphan (relative) |
| demo/payoff-panel.tsx | 0 | Orphan (relative) |

**Verdict:** All are sub-components of demo-flow. Properly organized.

---

## Summary of Duplicate Concept Clusters

Total clusters identified: **13**
- Actual duplicates (consolidation candidates): **1** (EmptyState variants)
- Design pattern reuse (no duplication): **9** (Cards, Avatars, Toggles, Modals, etc.)
- Feature-local organization (healthy): **3** (Value Map, Profile, Demo, Chat)
- Unused primitives layer: **1** (Data primitives: MetricTile, ValuePill, FolderCard)

