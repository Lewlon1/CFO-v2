# Codebase Audit Report
**Date:** 2026-04-13
**Branches audited:** main, session-25/folder-detail-views-routing-redirects, new-onboarding-flow

---

## Branch Topology (Critical Context)

The onboarding branch is **not independent**. It was forked from the UI branch at commit `28a6693`.

```
main (e7f88fb) ─── PR #27 merge ─── PR #25 merge ─── a41c94d (common ancestor)
                                                          │
                                                     eb022cf  session-19 office foundation
                                                     2f4cfa1  folder detail views
                                                     e539466  mobile UX polish
                                                     4fb3eed  header redesign
                                                     78f9d0e  API shape fixes
                                                     28a6693  rewire UI ─────────── new-onboarding-flow (+ uncommitted WIP)
                                                          │
                                                     1863754  folder fix-up ─────── session-25 (UI branch tip)
```

- **UI branch** = 7 commits above main
- **Onboarding branch** = same 6 commits as UI (minus 1863754) + uncommitted WIP (~3,038 lines across 32 files)
- The onboarding WIP has **never been committed**

**Planned merge path:** Onboarding WIP -> UI branch (refine UX) -> main after beta.

---

## 1. Branch Summary

### main (deployed)
- **Total source files:** 260 (.ts/.tsx/.css committed)
- **Components:** 91 .tsx files across 16 directories
- **Routes:** 23 (5 layouts + 18 pages across (app), (auth), (public) route groups)
- **API routes:** 48
- **Lib modules:** ~94 .ts files
- **Migrations:** 29 (001 through 029)

### session-25/folder-detail-views-routing-redirects (UI branch)
- **Files added:** ~50 (25 components, 25 routes, 2 API routes, 2 lib modules, 1 doc)
- **Files modified:** 27 (from main baseline)
- **Files removed:** 1 (`lib/parsers/pdf-transactions.ts`)
- **New components:** CFOAvatar, ChatProvider, ChatSheet, ChatBar, ChatHeader, QuickActionPills, PresetDropdown, NavigationBar, Breadcrumb, FolderDetail, FolderSection, InboxRow, OfficeMonthlyOverview, OfficeValuesBreakdown, 4x section components, ChartComponents, 4x data components, 3x trust components, ArchetypePageClient, OfficeTransactionsClient, PatternsClient, UploadPageClient, TheGapClient, InboxClient
- **New routes:** Entire `/(office)` route group with 25 pages: home, cash-flow (7 sub-pages), values (5), net-worth (3), scenarios (2), inbox
- **New API routes:** `/api/conversations/recent`, `/api/transactions/low-confidence-count`
- **Key changes:** New design system (tokens.ts, CSS custom properties), folder metaphor navigation, persistent ChatSheet overlay, route redirects from old (app) paths to (office) equivalents, PDF transaction parsing removed

### new-onboarding-flow (onboarding WIP)
- **Files added:** 20 new files (6 beat components, 1 modal orchestrator, 3 support components, 5 API routes, 6 lib modules, 1 hook, 1 migration)
- **Files modified:** 12 (from UI branch baseline at 28a6693)
- **Files removed:** 0
- **New components:** OnboardingModal, MessageRenderer, CategoryDisplay, TypingIndicator, ArchetypeBeat, CapabilitySelector, HandoffBeat, InsightBeat, UploadBeat, ValueMapBeat
- **New routes:** 5 API routes under `/api/onboarding/` (complete, csv-status, generate-archetype, generate-insight, progress)
- **New lib modules:** archetype-prompt, constants, insight-prompt, profile-seeder, types, value-map-reactions
- **New hook:** `useOnboarding` (reducer-based state machine)
- **New migration:** `030_onboarding_state.sql` (adds `onboarding_progress` jsonb and `capability_preferences` text[] to user_profiles)
- **Key changes:** Beat-based onboarding state machine (welcome -> framework -> value_map -> archetype -> csv_upload -> capabilities -> first_insight -> handoff), two Bedrock calls (archetype + insight generation), dual-layout mounting in both (app) and (office)

### Overlap
- **Files modified by BOTH branches from main baseline:** Since onboarding inherits all UI changes, the real question is what the onboarding WIP touches that commit 1863754 also touches. Answer: **1 file** (`lib/ai/context-builder.ts`)
- **For the combined -> main merge**, the UI branch modifies 27 files from main. The onboarding WIP adds 20 more files and modifies 12 files (most already changed by UI commits it inherits)

---

## 2. Component Inventory (main branch)

Main has 91 components. **All have at least 1 import** -- there are no dead components on main.

### High-use components (5+ imports)
| Component | Path | Imports | Notes |
|-----------|------|---------|-------|
| button | ui/button.tsx | 13 | shadcn base, used across auth, value-map, demo |
| cfo-avatar | chat/cfo-avatar.tsx | 9 | Used by value-map, demo, chat components |
| profile-completeness | app/profile-completeness.tsx | 2 | Layout + mobile nav |

### Components that become obsolete after UI branch merge
The UI branch introduces `/(office)` equivalents for most `/(app)` pages. After redirect rules take effect, these main components serve only as fallback:

| Component | Main Path | Office Equivalent | Status After Merge |
|-----------|-----------|-------------------|-------------------|
| DashboardClient | dashboard/DashboardClient.tsx | Reused by office/spending-breakdown + trends pages | Survives |
| BillsClient | bills/BillsClient.tsx | Reused by office/cash-flow/bills | Survives |
| TransactionsClient | transactions/TransactionsClient.tsx | office has OfficeTransactionsClient.tsx | Duplicated |
| ProfilePageClient | profile/ProfilePageClient.tsx | Reused by office/values/portrait | Survives |
| ScenariosClient | scenarios/ScenariosClient.tsx | Reused by office/scenarios/what-if | Survives |
| TripsClient | trips/TripsClient.tsx | Reused by office/scenarios/trips | Survives |
| BalanceSheetClient | balance-sheet/BalanceSheetClient.tsx | Reused by 3 office routes | Survives |

The (app) layout, sidebar nav, mobile-nav, logout-button, NotificationBell, NudgeBanner, ReviewBanner, and ConversationList are effectively dead once (office) fully replaces (app).

---

## 3. Dead Code

### Dead on the combined branch (UI + onboarding)
These files exist on the feature branches but are never imported:

| File | Branch | Reason |
|------|--------|--------|
| `components/charts/ChartComponents.tsx` | UI | Added but never imported by any page or component |
| `components/chat/ChatHeader.tsx` | UI | Created but not used in (office)/layout.tsx -- layout uses ChatBar + ChatSheet directly |
| `components/chat/QuickActionPills.tsx` | UI | Only imported by dead ChatHeader.tsx |
| `components/navigation/Breadcrumb.tsx` | UI | NavigationBar handles breadcrumb-like navigation instead |
| `components/trust/ConfidenceFlag.tsx` | UI | Created but not rendered by any page |
| `components/trust/ProvenanceLine.tsx` | UI | Created but not rendered by any page |
| `components/trust/SysTag.tsx` | UI | Created but not rendered by any page |
| `components/onboarding/beats/HandoffBeat.tsx` | Onboarding | Comment in OnboardingModal: "unused, replaced by MessageRenderer's ActionButton" |

### Unused Lib Modules (main)
| File | Reason |
|------|--------|
| `lib/analytics/trip-linker.ts` | Exports `linkTransactionsToTrip`, `linkTransactionsForActiveTrips` -- 0 imports. Stubbed for future trip-linking. |
| `lib/csv/hash.ts` | Exports `generateTransactionHash` -- 0 imports. Duplicate detection uses a different approach. |

### Unused API Routes (main)
| Route | File | Reason |
|-------|------|--------|
| `/api/analyze-conversation` | analyze-conversation/route.ts | Post-conversation analysis -- never wired into frontend or cron |
| `/api/profile/data-summary` | profile/data-summary/route.ts | Profile page computes this inline via direct Supabase queries |
| `/api/profile/import-history` | profile/import-history/route.ts | Profile page uses `supabase.rpc('get_import_history')` directly |
| `/api/value-map/summary` | value-map/summary/route.ts | 0 references from any file |
| `/api/cron/nudges-daily` | cron/nudges-daily/route.ts | Code exists but NOT registered in vercel.json cron config |
| `/api/cron/nudges-weekly` | cron/nudges-weekly/route.ts | Same -- built but never wired |
| `/api/cron/nudges-monthly` | cron/nudges-monthly/route.ts | Same -- built but never wired |

---

## 4. Data Point Status

### user_profiles columns

| Column | Status | Written By | Read By |
|--------|--------|-----------|---------|
| display_name | ACTIVE | signup, LLM tool | context-builder, layout UIs |
| country | ACTIVE | signup, LLM tool | context-builder, bill search, demo |
| city | ACTIVE | LLM tool | context-builder, profile export |
| primary_currency | ACTIVE | signup, LLM tool | context-builder, all layouts, tools, nudge evaluators |
| age_range | ACTIVE | LLM tool, profiling | context-builder, ProfilePageClient, pension calc |
| employment_status | ACTIVE | LLM tool, profiling | context-builder, ProfilePageClient, question dependencies |
| gross_salary | ACTIVE | LLM tool | context-builder, ProfilePageClient, budget calc |
| net_monthly_income | ACTIVE | LLM tool, profiling, structured input | context-builder (multiple), helpers, budget/pension calc, payday nudge |
| pay_frequency | ACTIVE | LLM tool | context-builder, ProfilePageClient, export |
| has_bonus_months | ACTIVE | LLM tool, profiling | context-builder (paired with details) |
| bonus_month_details | ACTIVE | LLM tool | context-builder only (read if has_bonus_months truthy) |
| housing_type | ACTIVE | LLM tool, profiling | context-builder, ProfilePageClient, question dependencies |
| monthly_rent | ACTIVE | LLM tool, profiling | context-builder, helpers, budget calc |
| relationship_status | ACTIVE | LLM tool, profiling | context-builder, ProfilePageClient |
| partner_employment_status | ACTIVE | LLM tool | context-builder only (no UI display) |
| partner_monthly_contribution | ACTIVE | LLM tool, profiling | context-builder, helpers, budget calc, ProfilePageClient |
| dependents | ACTIVE | LLM tool, profiling | context-builder, ProfilePageClient |
| **values_ranking** | **WRITE-ONLY** | LLM tool (allowlisted) | **Never read anywhere** |
| spending_triggers | ACTIVE | LLM tool, profiling | ProfilePageClient only (not in context-builder) |
| risk_tolerance | ACTIVE | LLM tool, profiling | context-builder, ProfilePageClient |
| **financial_awareness** | **WRITE-ONLY** | LLM tool (allowlisted) | **Never read anywhere** |
| advice_style | ACTIVE | LLM tool, profiling | context-builder (persona tone), ProfilePageClient |
| nationality | ACTIVE | LLM tool, profiling | context-builder, ProfilePageClient |
| **residency_status** | **WRITE-ONLY** | LLM tool (allowlisted) | profile/export only |
| **tax_residency_country** | **WRITE-ONLY** | LLM tool (allowlisted) | profile/export only |
| **years_in_country** | **WRITE-ONLY** | LLM tool (allowlisted) | profile/export only |
| onboarding_completed_at | ACTIVE | onboarding/complete API | context-builder, both layouts (gates OnboardingModal) |
| profile_completeness | ACTIVE | signup, profile/update, chat | context-builder, ProfilePageClient, layout |
| onboarding_progress | ACTIVE | onboarding/progress API | context-builder, both layouts (resume state) |
| capability_preferences | ACTIVE | onboarding/complete API | (written but read path TBD during UX refinement) |

### messages metadata columns

| Column | Status | Written By | Read By |
|--------|--------|-----------|---------|
| **profile_updates** | **WRITE-ONLY** | chat/route.ts (per assistant message) | Never queried |
| **actions_created** | **WRITE-ONLY** | chat/route.ts (per assistant message) | Never queried |
| **insights_generated** | **DEAD** | Never written | Never read |
| **tools_used** | **WRITE-ONLY** | chat/route.ts (per assistant message) | Never queried |

### financial_portrait

| Pattern | Status | Written By | Read By |
|---------|--------|-----------|---------|
| trait_type='archetype' | ACTIVE | onboarding/generate-archetype, profile-seeder | context-builder, TraitDisplay, office/page |
| trait_type='behavioral' | ACTIVE | analyze-conversation, balance-sheet/portrait | context-builder, TraitDisplay |
| trait_type='onboarding' | ACTIVE | profile-seeder | context-builder |
| trait_type='gap_analysis' | ACTIVE | gap-analyser | office/page, TheGapClient |
| trait_type='asset_profile' | ACTIVE | balance-sheet/portrait | context-builder |
| trait_type='value_preference' | ACTIVE | chat/route.ts | context-builder |
| trait_type='follow_up_suggestion' | ACTIVE | gap-analyser | context-builder |

### monthly_snapshots columns

| Column | Status | Computed By | Displayed By |
|--------|--------|-----------|-------------|
| total_income | ACTIVE | monthly-snapshot.ts | context-builder, dashboard, OfficeMonthlyOverview, CashFlowSection, TrendChart |
| total_spending | ACTIVE | monthly-snapshot.ts | context-builder, dashboard, emergency fund calc |
| surplus_deficit | ACTIVE | monthly-snapshot.ts | context-builder, dashboard, OfficeMonthlyOverview |
| **total_fixed_costs** | **DEAD** | Not computed | Not read |
| **total_discretionary** | **READ-ONLY** | Not computed by monthly-snapshot.ts | helpers.ts reads it (always returns null) |
| spending_by_category | ACTIVE | monthly-snapshot.ts | context-builder, dashboard, trip planning |
| spending_by_value_category | ACTIVE | monthly-snapshot.ts | context-builder, dashboard, OfficeValuesBreakdown |
| transaction_count | ACTIVE | monthly-snapshot.ts | context-builder, dashboard, profile pages |
| avg_transaction_size | ACTIVE | monthly-snapshot.ts | dashboard/summary API (not displayed in UI) |
| largest_transaction | ACTIVE | monthly-snapshot.ts | context-builder, dashboard API |
| largest_transaction_desc | ACTIVE | monthly-snapshot.ts | context-builder, dashboard API |
| vs_previous_month_pct | ACTIVE | monthly-snapshot.ts | context-builder, dashboard, OfficeMonthlyOverview |
| **vs_budget_pct** | **DEAD** | Not computed | Not read |
| **dining_out_count** | **DEAD** | Not computed | Not read |

### value_map_results fields

| Field | Status | Written By | Read By |
|-------|--------|-----------|---------|
| Per-card rows (quadrant, confidence, timing) | ACTIVE | value-map-flow, link-session | gap-analyser |
| archetype_name | ACTIVE | generate-archetype API | generate-insight API |
| **archetype_subtitle** | **WRITE-ONLY** | generate-archetype API | Subtitle read from financial_portrait instead |
| **full_analysis** | **WRITE-ONLY** | generate-archetype API (JSON.stringify of traits) | Never read back |
| **certainty_areas** | **WRITE-ONLY** | generate-archetype API | Read from financial_portrait traits instead |
| **conflict_areas** | **WRITE-ONLY** | generate-archetype API | Read from financial_portrait traits instead |
| **comfort_patterns** | **DEAD** | Never written | Never read |

### Analytics events

**Client-side (via useTrackEvent -> /api/analytics/event):** 28 distinct event names covering signup, upload, dashboard, chat, value map, inbox, and folder interactions.

**Onboarding-specific (via useTrackOnboarding, category 'funnel'):** 13 event names covering the full onboarding funnel from start to completion.

**Server-side (direct user_events insert):** 10 event types for corrections, exports, hallucination detection, and value classifications.

**Consumer of events:** Only `context-builder.ts` and `check-value-checkin-ready.ts` read from `user_events`. All other events are write-only (presumably for future analytics dashboard or export).

---

## 5. Feature Branch Analysis

### UI Branch: What It Introduces

**Architecture.** A complete restructuring of the authenticated experience from a sidebar-nav SPA into a folder-metaphor "office" interface. The `/(office)` route group contains ~50 files organized as four main folders (Cash Flow, Values & You, Net Worth, Scenario Planning) plus an inbox. Each folder has a `FolderDetail` page listing sub-pages as "files."

**Design system.** A new design token system (`lib/tokens.ts` + CSS custom properties in `globals.css`) defines: 5 background tiers, gold accent (#E8A84C), folder-specific colors, value category colors, and three fonts (DM Sans, JetBrains Mono, Cormorant Garamond). The aesthetic is "dark, warm, monospaced authority."

**Chat system.** The old full-page `/chat` route is replaced by a persistent `ChatSheet` overlay (slides down from top) accessible from anywhere via a `ChatBar`. `ChatProvider` manages conversation state globally, supporting typed conversations (onboarding, monthly review, bill optimization, nudge-initiated) that auto-trigger LLM system messages.

**Coexistence.** The old `/(app)` route group is preserved but `next.config.ts` adds permanent redirects from old paths (`/dashboard`, `/bills`, `/chat`, etc.) to their `/(office)` equivalents. The `/(app)` layout is not modified. Components like `DashboardClient`, `BillsClient`, and `ProfilePageClient` are reused by `/(office)` pages -- they are imported, not duplicated.

**Removals.** PDF transaction parsing is removed (`pdf-transactions.ts` deleted, parser types updated). PDFs are now only accepted for balance sheet uploads.

**Extra commit (1863754).** Adds: PatternsClient (splits spending habits from bills), UploadPageClient (upload wizard embedded in office), ArchetypePageClient, PresetDropdown for chat. Modifies: `context-builder.ts` (adds "known fields" list preventing LLM re-asking), `system-prompt.ts` (adds profile-checking rule), `recurring-detector.ts` (adds `detectFrequency()`), ChatInterface/ChatSheet integration improvements.

### Onboarding Branch: What It Introduces

**Architecture.** A full-screen `OnboardingModal` that overlays the authenticated layout. It mounts in **both** `(app)/layout.tsx` and `(office)/layout.tsx` (whichever the user lands on). Visibility gated on `onboarding_completed_at IS NULL`.

**State machine.** `useOnboarding` is a `useReducer`-based state machine with 8 beats: welcome -> framework -> value_map -> archetype -> csv_upload -> capabilities -> first_insight -> handoff. Actions: ADVANCE_MESSAGE (increment within beat), COMPLETE_BEAT (advance to next beat with skip logic), SET_DATA (merge data), SKIP, DISMISS. Skip logic: if Value Map completed without personality type, skip archetype; if CSV upload skipped, skip first_insight.

**Message system.** Each beat has a sequence of typed messages with configurable delays. `MessageRenderer` types them out with a `TypingIndicator` delay. Special tokens (CATEGORY_DISPLAY, ARCHETYPE_DISPLAY, INSIGHT_DISPLAY) embed beat-specific components inline. `value-map-reactions.ts` generates contextual CFO reactions during the Value Map exercise (max 3 per exercise).

**Two Bedrock calls:**
1. `POST /api/onboarding/generate-archetype` -- Temperature 0.7, 15s timeout, with retry and deterministic fallback
2. `POST /api/onboarding/generate-insight` -- Temperature 0.6, 12s timeout, gap-analysis-based with template fallback

**Database writes:** `user_profiles.onboarding_progress` (state machine snapshot, cleared on completion), `user_profiles.onboarding_completed_at`, `user_profiles.capability_preferences`, `financial_portrait` (archetype traits seeded via profile-seeder.ts), `value_map_results` (archetype fields on existing rows).

**Value Map modification.** In onboarding mode, the Value Map uses sample transactions (not real data), skips anchoring/cut-or-keep/one-thing steps, and reports results to the parent modal via callbacks. The `value-map-card.tsx` gains an `onTransactionResult` callback for the reaction system.

**Signup change.** Post-signup redirect changed from `/chat?type=onboarding` to `/dashboard`. The modal appears on any authenticated page instead of requiring a specific chat conversation.

### How They Interact

The onboarding modal and the office UI are **complementary, not competing.** The modal overlays the office layout for new users, then dismisses permanently once onboarding completes, revealing the office underneath.

**Integration path:**
1. User signs up -> redirected to `/office` (via `/dashboard` redirect)
2. `(office)/layout.tsx` fetches `onboarding_completed_at`, finds it null -> renders `OnboardingModal`
3. User progresses through beats (Value Map with sample data -> archetype -> CSV upload -> capabilities -> first insight)
4. On completion: `onboarding_completed_at` set, `onboarding_progress` cleared, financial_portrait seeded
5. Modal dismisses -> user sees the office home with their data

**Shared dependencies:** Both branches use `ChatProvider` (onboarding could trigger post-upload conversations), both read `user_profiles`, both write to `financial_portrait`. The onboarding branch modifies `context-builder.ts` to add `getOnboardingResumeContext()` for users who abandon onboarding mid-flow.

---

## 6. Duplicate Components Across Branches

| Concept | main | UI branch adds | Onboarding adds | Identical? | Resolution |
|---------|------|---------------|-----------------|-----------|------------|
| CFO avatar | chat/cfo-avatar.tsx (SVG in chat bubble) | brand/CFOAvatar.tsx (new SVG, glasses, gold bg) | Uses CFOAvatar from UI branch | Different designs | CFOAvatar is the new brand avatar; cfo-avatar.tsx is the chat-inline version. **Keep both** -- different contexts |
| Typing dots | (none on main) | (none) | onboarding/TypingIndicator.tsx | N/A | Onboarding-specific, no conflict |
| Transaction list | transactions/TransactionsClient.tsx | + OfficeTransactionsClient.tsx | (none) | Different | OfficeTransactionsClient is a simplified view using office design tokens. **TransactionsClient still needed** for the (app) fallback route |
| Message renderer | chat/MessageList.tsx | Modified MessageList.tsx | + onboarding/MessageRenderer.tsx | Different purpose | MessageRenderer is onboarding-specific (typed messages with delays). MessageList is chat-specific (AI responses). **No duplication** |
| Value category display | (various inline) | data/ValuePill.tsx | onboarding/CategoryDisplay.tsx | Different | CategoryDisplay is a 2-column grid of all 5 categories. ValuePill is a single badge. **Keep both** |
| Layout wrapper | (app)/layout.tsx | + (office)/layout.tsx | Modifies both | Different | (app) = sidebar nav. (office) = header + chat overlay + folder nav. Both mount OnboardingModal. **Both needed during transition** |

---

## 7. Merge Conflict Forecast

### Step 1: Onboarding WIP -> UI branch

| File | Conflict Type | Severity | Resolution Strategy |
|------|--------------|----------|-------------------|
| `lib/ai/context-builder.ts` | Both add to `buildProfileContext()` | HIGH | UI adds "known fields" block; onboarding adds `getOnboardingResumeContext()`. These are different sections of the same function. Manual merge: keep both additions. |
| `(office)/layout.tsx` | Onboarding adds OnboardingModal import + render | LOW | Onboarding modifies the file that 1863754 also touched. Changes are additive (new import + conditional render). Applies cleanly if done against the 1863754 version. |

All other onboarding WIP files either: (a) are new files (no conflict), or (b) modify files at 28a6693 that 1863754 didn't touch.

### Step 2: Combined UI+Onboarding -> main

| File | Conflict Type | Severity | Resolution Strategy |
|------|--------------|----------|-------------------|
| `app/globals.css` | UI adds ~100 lines of CSS tokens + animations | MEDIUM | Main has minimal globals.css. UI's version is a superset. Take UI version entirely. |
| `lib/ai/context-builder.ts` | UI adds known-fields, onboarding adds resume-context | MEDIUM | Main has neither. Both additions apply cleanly on top of main since they modify different functions. |
| `lib/ai/system-prompt.ts` | UI adds 2 new rules | LOW | Additive. Append to main's version. |
| `next.config.ts` | UI adds 8 redirect rules | LOW | Main has 1 redirect. UI adds 7 more. Clean merge. |
| `components/upload/UploadWizard.tsx` | Both branches modify (UI: PDF restriction; onboarding: autoImport + callback) | MEDIUM | Different sections of same file. Manual merge: apply both changes. |
| `components/value-map/value-map-flow.tsx` | Onboarding adds mode prop, callbacks, removes anchoring step | HIGH | Significant restructuring. Must take onboarding version and verify UI branch compatibility. |
| `components/value-map/value-map-card.tsx` | Onboarding adds onTransactionResult callback | LOW | Additive prop. Clean merge. |
| `(auth)/signup/page.tsx` | Onboarding changes redirect target | LOW | One-line change. Take onboarding version. |
| `lib/parsers/index.ts` | UI removes PDF format | LOW | Take UI version. |
| `lib/parsers/types.ts` | UI removes pdf_statement source | LOW | Take UI version. |
| `lib/analytics/track-llm-usage.ts` | UI removes pdf_transaction_parse | LOW | Take UI version. |
| `package.json` | UI adds remark-gfm | LOW | Additive. |

### Files that will need deletion from main after merge
| File | Reason |
|------|--------|
| `lib/parsers/pdf-transactions.ts` | Removed on UI branch |

---

## 8. Recommendations

### Dead code to remove before merge (reduces noise)

**On main (safe deletions):**
1. `lib/analytics/trip-linker.ts` -- 0 imports, stubbed feature never wired
2. `lib/csv/hash.ts` -- 0 imports, superseded by other dedup approach
3. API route `api/analyze-conversation/` -- never called from anywhere
4. API route `api/profile/data-summary/` -- superseded by inline queries
5. API route `api/profile/import-history/` -- superseded by RPC call
6. API route `api/value-map/summary/` -- 0 references
7. Three nudge cron routes (`nudges-daily/weekly/monthly`) -- built but never registered in vercel.json

**On UI branch (after onboarding merge):**
8. `components/charts/ChartComponents.tsx` -- added but never imported
9. `components/chat/ChatHeader.tsx` + `QuickActionPills.tsx` -- dead chain (ChatHeader not used by layout)
10. `components/navigation/Breadcrumb.tsx` -- NavigationBar handles this
11. `components/trust/ConfidenceFlag.tsx`, `ProvenanceLine.tsx`, `SysTag.tsx` -- created but not rendered by any page (wire them into office pages or delete)

**On onboarding branch:**
12. `components/onboarding/beats/HandoffBeat.tsx` -- explicitly unused per code comment

### Data points to flag for schema cleanup

| Column | Action | Impact |
|--------|--------|--------|
| `user_profiles.values_ranking` | Remove from LLM allowlist OR add to context-builder | Currently silently collecting data nobody reads |
| `user_profiles.financial_awareness` | Remove from LLM allowlist OR add to context-builder | Same -- wasted profiling effort |
| `user_profiles.residency_status` | Add to context-builder (tax advice context) OR remove | Only in export -- not used for advice |
| `user_profiles.tax_residency_country` | Add to context-builder OR remove | Same |
| `user_profiles.years_in_country` | Add to context-builder OR remove | Same |
| `messages.profile_updates` | Add analytics dashboard OR remove column | Written every message, never queried |
| `messages.actions_created` | Same | Same |
| `messages.tools_used` | Same | Same |
| `messages.insights_generated` | Remove column | Never written, never read |
| `monthly_snapshots.total_fixed_costs` | Compute in monthly-snapshot.ts OR remove | Column exists but never populated |
| `monthly_snapshots.total_discretionary` | Compute in monthly-snapshot.ts OR remove | Read by helpers.ts but always null |
| `monthly_snapshots.vs_budget_pct` | Implement budget feature OR remove | Column exists but never populated |
| `monthly_snapshots.dining_out_count` | Compute in monthly-snapshot.ts OR remove | Column exists but never populated |
| `value_map_results.archetype_subtitle` | Read from here instead of financial_portrait OR remove | Duplicate of financial_portrait data |
| `value_map_results.full_analysis` | Read from here OR remove | Written but never read back |
| `value_map_results.certainty_areas` | Read from here OR remove | Written but read from financial_portrait instead |
| `value_map_results.conflict_areas` | Same | Same |
| `value_map_results.comfort_patterns` | Remove column | Never written, never read |

### Components to consolidate

1. **Trust components** (ConfidenceFlag, ProvenanceLine, SysTag) -- These are well-designed but orphaned. Wire them into office pages: ConfidenceFlag on transactions page, ProvenanceLine on data-heavy pages, SysTag where system-generated content appears. Or delete if the trust layer is being redesigned.

2. **ChatHeader + QuickActionPills** -- ChatHeader was likely an earlier design that got replaced by the ChatBar + ChatSheet pattern. Either wire ChatHeader into the layout as the expandable header it was designed to be, or delete both.

### Merge order recommendation

**Step 1: Commit the onboarding WIP on `new-onboarding-flow`.** It's ~3,000 lines of uncommitted work. Commit it.

**Step 2: Rebase `new-onboarding-flow` onto `session-25/folder-detail-views-routing-redirects`.** Since onboarding is based on 28a6693 and UI tip is 1863754 (one commit ahead), this rebase should be clean except for `context-builder.ts`. Resolve that conflict manually: keep both the "known fields" block (from 1863754) and `getOnboardingResumeContext()` (from onboarding).

**Step 3: Refine UX on the combined branch.** Wire up the trust components, verify the onboarding -> office handoff transition, test the ChatProvider auto-trigger system with onboarding conversation types.

**Step 4: Clean main before merge.** Delete the 7 dead API routes and 2 dead lib modules listed above. This removes merge noise and prevents shipping dead code.

**Step 5: Merge combined branch into main.** The primary conflict zone is `value-map-flow.tsx` (significant restructuring) and `context-builder.ts` (two independent additions). Everything else is additive or takes the feature branch version.

**Step 6: Post-merge cleanup.** Decide the fate of the `(app)` route group. Currently preserved with redirects, but eventually should be removed entirely once the `(office)` UI is validated.

### Open questions for Lewis

1. **The (app) route group**: Keep as fallback during beta, or delete now? The redirects make it unreachable except for `/balance-sheet`, `/goals`, `/settings`, and `/chat/[id]`.

2. **Trust components**: Were ConfidenceFlag/ProvenanceLine/SysTag intentionally left unwired (future work), or forgotten? They're polished but orphaned.

3. **Three nudge cron routes**: These are fully implemented but never registered in vercel.json. Are nudges intentionally disabled for beta, or was the cron registration missed?

4. **`values_ranking` and `financial_awareness` columns**: The LLM can write to these but nothing reads them. Should they feed into the system prompt, or was this a profiling experiment that didn't pan out?

5. **`messages.profile_updates/actions_created/tools_used`**: These are written on every assistant message but never queried. Is there a planned analytics dashboard, or should the write be removed to save DB space?

6. **`comfort_patterns`** in value_map_results: This column was never implemented. Safe to drop in a migration?

---

## Methodology

This audit was performed by:
1. Comparing git trees (`git ls-tree -r`) between branches for precise file counts
2. Using `git diff` and `git show` for cross-branch file reading
3. Using `git stash show -p` for onboarding WIP analysis
4. Searching for imports via grep across the working tree
5. Cross-referencing database column names against all .ts/.tsx files

**Branch state note:** The audit found that we were on `new-onboarding-flow` with onboarding WIP present (stash was popped during exploration). Component inventory was performed against the combined UI+onboarding state. Main-specific counts were derived from `git ls-tree main`.
