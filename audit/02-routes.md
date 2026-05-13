# Route Audit Report

Generated: 2024-12-20 | Total Routes: 93 | Live: 79 | Orphan: 14 | Ambiguous: 0

## Routes Table

| Route | Type | Method | Inbound refs | Top 3 ref sites | Verdict |
|-------|------|--------|--------------|-----------------|---------|
| / | page | - | 70 | app/(public)/privacy/page.tsx, app/(public)/terms/page.tsx, app/page.tsx | live |
| /login | page | - | 13 | app/page.tsx, app/(auth)/signup/page.tsx, proxy.ts | live |
| /signup | page | - | 4 | app/(auth)/login/page.tsx, app/page.tsx, components/landing/Hero.tsx | live |
| /demo | page | - | 1 | components/dashboard/EmptyState.tsx | live |
| /privacy | page | - | 2 | app/(public)/terms/page.tsx, app/(auth)/signup/page.tsx | live |
| /terms | page | - | 2 | app/(public)/privacy/page.tsx, app/(auth)/signup/page.tsx | live |
| /v4 | page | - | 0 | - | orphan |
| /office | page | - | 17 | components/office/dashboards/ScenariosDashboard.tsx, components/office/dashboards/CashFlowDashboard.tsx | live |
| /office/cash-flow | page | - | 3 | components/office/dashboards/CashFlowDashboard.tsx, components/office/sections/CashFlowSection.tsx | live |
| /office/cash-flow/bills | page | - | 1 | components/office/dashboards/CashFlowDashboard.tsx | live |
| /office/cash-flow/monthly-overview | page | - | 1 | components/office/dashboards/CashFlowDashboard.tsx | live |
| /office/cash-flow/optimise | page | - | 0 | - | orphan |
| /office/cash-flow/patterns | page | - | 1 | components/office/dashboards/CashFlowDashboard.tsx | live |
| /office/cash-flow/spending-breakdown | page | - | 1 | components/office/dashboards/CashFlowDashboard.tsx | live |
| /office/cash-flow/transactions | page | - | 2 | components/office/dashboards/CashFlowDashboard.tsx, app/(office)/office/cash-flow/upload/UploadPageClient.tsx | live |
| /office/cash-flow/trends | page | - | 0 | - | orphan |
| /office/cash-flow/upload | page | - | 2 | components/office/sections/CashFlowSection.tsx, components/office/dashboards/CashFlowDashboard.tsx | live |
| /office/inbox | page | - | 1 | components/office/InboxRow.tsx | live |
| /office/net-worth | page | - | 3 | components/office/dashboards/NetWorthDashboard.tsx, components/office/sections/NetWorthSection.tsx | live |
| /office/net-worth/assets | page | - | 1 | components/office/dashboards/NetWorthDashboard.tsx | live |
| /office/net-worth/balance-sheet | page | - | 1 | components/office/dashboards/NetWorthDashboard.tsx | live |
| /office/net-worth/liabilities | page | - | 1 | components/office/dashboards/NetWorthDashboard.tsx | live |
| /office/net-worth/upload | page | - | 2 | components/office/dashboards/NetWorthDashboard.tsx, components/office/sections/NetWorthSection.tsx | live |
| /office/scenarios | page | - | 2 | components/office/dashboards/ScenariosDashboard.tsx, components/office/sections/ScenariosSection.tsx | live |
| /office/scenarios/goals | page | - | 1 | components/office/dashboards/ScenariosDashboard.tsx | live |
| /office/scenarios/trips | page | - | 1 | components/office/dashboards/ScenariosDashboard.tsx | live |
| /office/scenarios/what-if | page | - | 2 | components/office/dashboards/ScenariosDashboard.tsx, components/office/sections/ScenariosSection.tsx | live |
| /office/settings | page | - | 1 | components/office/UserAvatarMenu.tsx | live |
| /office/values | page | - | 4 | components/office/sections/ValuesSection.tsx, components/office/dashboards/ValuesDashboard.tsx | live |
| /office/values/archetype | page | - | 3 | components/office/dashboards/ValuesDashboard.tsx, components/office/sections/ValuesSection.tsx | live |
| /office/values/export | page | - | 1 | components/office/dashboards/ValuesDashboard.tsx | live |
| /office/values/portrait | page | - | 1 | components/office/dashboards/ValuesDashboard.tsx | live |
| /office/values/the-gap | page | - | 2 | components/office/dashboards/ValuesDashboard.tsx, app/onboarding-v2/archetype/archetype-orchestrator.tsx | live |
| /office/values/value-split | page | - | 1 | components/office/dashboards/ValuesDashboard.tsx | live |
| /onboarding-v2 | page | - | 6 | app/onboarding-v2/intro/intro-screen.tsx, app/onboarding-v2/value-map/value-map-orchestrator.tsx | live |
| /onboarding-v2/archetype | page | - | 1 | app/onboarding-v2/upload/upload-orchestrator.tsx | live |
| /onboarding-v2/intro | page | - | 1 | components/chat/ValueMapActionButton.tsx | live |
| /onboarding-v2/upload | page | - | 1 | app/onboarding-v2/value-map/value-map-orchestrator.tsx | live |
| /onboarding-v2/value-map | page | - | 1 | app/onboarding-v2/intro/intro-screen.tsx | live |
| /value-map | page | - | 2 | components/values/ArchetypePageClient.tsx, components/chat/ChatCTA.tsx | live |
| POST /api/account/consent | api | POST | 1 | app/(auth)/signup/page.tsx | live |
| POST /api/account/delete | api | POST | 1 | components/settings/AccountDataManagement.tsx | live |
| GET /api/account/export | api | GET | 1 | components/settings/AccountDataManagement.tsx | live |
| POST /api/analytics/event | api | POST | 1 | lib/events/use-track-event.ts | live |
| POST /api/analytics/feedback | api | POST | 1 | components/chat/MessageFeedback.tsx | live |
| POST /api/analyze-conversation | api | POST | 0 | - | orphan |
| GET /api/balance-sheet | api | GET | 0 | - | orphan |
| GET /api/balance-sheet/holdings | api | GET | 0 | - | orphan |
| POST /api/bills/confirm | api | POST | 1 | components/bills/BillUploadModal.tsx | live |
| POST /api/bills/delete | api | POST | 1 | components/bills/BillsClient.tsx | live |
| POST /api/bills/dismiss | api | POST | 1 | components/bills/BillsClient.tsx | live |
| GET /api/bills/history | api | GET | 0 | - | orphan |
| POST /api/bills/promote | api | POST | 1 | components/bills/BillsClient.tsx | live |
| POST /api/bills/start-conversation | api | POST | 1 | components/bills/BillDetailPanel.tsx | live |
| POST /api/bills/upload | api | POST | 1 | components/bills/BillUploadModal.tsx | live |
| POST /api/chat | api | POST | 1 | components/chat/SavedItemCard.tsx | live |
| POST /api/chat/undo | api | POST | 1 | components/chat/SavedItemCard.tsx | live |
| GET /api/conversations/recent | api | GET | 2 | components/chat/ChatSheet.tsx, components/chat/ChatProvider.tsx | live |
| POST /api/corrections/signal | api | POST | 1 | app/(office)/office/cash-flow/transactions/OfficeTransactionsClient.tsx | live |
| GET /api/cron/daily-bills | api | GET | 0 | - | live |
| GET /api/cron/nudges-daily | api | GET | 0 | - | live |
| GET /api/cron/nudges-monthly | api | GET | 0 | - | live |
| GET /api/cron/nudges-weekly | api | GET | 0 | - | live |
| GET /api/cron/portrait-extraction | api | GET | 0 | - | live |
| GET /api/dashboard/summary | api | GET | 0 | - | orphan |
| GET /api/dashboard/trends | api | GET | 0 | - | orphan |
| POST /api/demo/reading | api | POST | 1 | components/demo/demo-flow.tsx | live |
| POST /api/demo/session | api | POST | 2 | components/demo/demo-flow.tsx, components/demo/demo-reveal.tsx | live |
| POST /api/demo/signup | api | POST | 1 | components/demo/demo-email-capture.tsx | live |
| POST /api/detect-format | api | POST | 1 | lib/parsers/format-detect-client.ts | live |
| POST /api/extract-pdf-transactions | api | POST | 1 | lib/parsers/universal-pdf.ts | live |
| POST /api/goals/delete | api | POST | 1 | app/(office)/office/scenarios/goals/GoalCard.tsx | live |
| POST /api/insights/post-upload | api | POST | 1 | components/upload/ImportResult.tsx | live |
| POST /api/insights/value-map-complete | api | POST | 1 | components/demo/demo-reveal.tsx | live |
| GET /api/nudges | api | GET | 2 | app/(office)/office/inbox/InboxClient.tsx, components/office/InboxRow.tsx | live |
| POST /api/onboarding-v2/free-text-opener | api | POST | 1 | components/onboarding-v2/chat-opener-trigger.tsx | live |
| POST /api/onboarding/complete | api | POST | 0 | - | orphan |
| POST /api/onboarding/generate-archetype | api | POST | 1 | app/onboarding-v2/archetype/archetype-orchestrator.tsx | live |
| POST /api/profile/delete-data | api | POST | 1 | components/profile/DataManagement.tsx | live |
| GET /api/profile/export/profile | api | GET | 0 | - | orphan |
| GET /api/profile/export/transactions | api | GET | 0 | - | orphan |
| POST /api/profile/portrait/feedback | api | POST | 1 | components/profile/TraitDisplay.tsx | live |
| POST /api/profile/traits/dismiss | api | POST | 1 | components/profile/TraitDisplay.tsx | live |
| POST /api/profile/update | api | POST | 2 | components/chat/ChatProvider.tsx, components/profile/ProfileCard.tsx | live |
| POST /api/review/start | api | POST | 1 | components/dashboard/ReviewBanner.tsx | live |
| POST /api/upload | api | POST | 1 | components/upload/UploadWizard.tsx | live |
| GET /api/value-map/checkin | api | GET | 1 | components/value-map/value-map-flow.tsx | live |
| POST /api/value-map/checkin/save | api | POST | 1 | components/value-map/value-map-flow.tsx | live |
| POST /api/value-map/link-session | api | POST | 2 | app/(auth)/signup/page.tsx, components/demo/demo-reveal.tsx | live |
| GET /api/value-map/personal | api | GET | 1 | components/value-map/value-map-flow.tsx | live |
| GET /api/value-map/personal/impact | api | GET | 0 | - | orphan |
| POST /api/value-map/regenerate | api | POST | 0 | - | orphan |
| POST /api/value-map/reveal | api | POST | 1 | components/value-map/value-map-summary.tsx | live |

## Orphan Routes (0 references)

The following routes appear to have no inbound references and should be reviewed for removal:

### Pages
- `/v4` — Possible old demo/landing variant, check if still needed

### API Routes
- `POST /api/analyze-conversation` — May be dev/debug endpoint
- `GET /api/balance-sheet` — Potentially unused data endpoint
- `GET /api/balance-sheet/holdings` — Companion to balance-sheet, likely orphaned together
- `GET /api/bills/history` — History endpoint, may be superseded
- `POST /api/onboarding/complete` — Likely replaced by v2
- `GET /api/dashboard/summary` — Dashboard data endpoint, may be unused
- `GET /api/dashboard/trends` — Dashboard data endpoint, may be unused
- `GET /api/profile/export/profile` — Export endpoint, may be superseded
- `GET /api/profile/export/transactions` — Companion to profile export
- `GET /api/value-map/personal/impact` — Nested value-map endpoint
- `POST /api/value-map/regenerate` — May be dev/unused feature

## Duplicate/Overlapping Clusters

### Dashboard/Office Navigation
- **cluster**: `/office`, `/office/cash-flow`, `/office/net-worth`, `/office/values`, `/office/scenarios`
- **note**: These are main dashboard sections with clean hierarchy; no duplication found

### Onboarding Versions
- **cluster**: `/onboarding-v2/*` and legacy `/api/onboarding/complete`
- **finding**: v2 is active (referenced 6+ times), legacy endpoints at v1 are orphaned
- **recommendation**: Remove `/api/onboarding/complete` if migration to v2 is complete

### Export/Profile Data
- **cluster**: `GET /api/profile/export/profile`, `GET /api/profile/export/transactions`, `POST /api/profile/delete-data`, `POST /api/account/export`, `POST /api/account/delete`
- **finding**: Account-level and profile-level exports are separate; `profile/export/*` appears unused while `account/*` is referenced
- **recommendation**: Clarify whether both are needed or consolidate

### Dashboard Data Endpoints
- **cluster**: `GET /api/dashboard/summary`, `GET /api/dashboard/trends`, `GET /api/balance-sheet`, `GET /api/balance-sheet/holdings`
- **finding**: All orphaned; unclear if these were replaced by real-time queries or removed features
- **recommendation**: Check if dashboard data is now fetched via different routes

### Bills Management
- **cluster**: `GET /api/bills/history` (orphaned) vs active endpoints (`POST /api/bills/*`)
- **finding**: CRUD operations are referenced; history endpoint is not
- **recommendation**: Remove `/api/bills/history` if historical data is not user-facing

## Notes on Caveats

### Missing Routes Referenced in Code
- **`/chat` page**: Referenced heavily via `router.push('/chat')`, `redirect('/chat')`, and middleware, but **no page exists**. This is either:
  - A dynamic route `app/chat/[id]/page.tsx` missing from the file list
  - A catch-all that isn't captured in this audit
  - A routing bug where links point to non-existent route
  - Handled via middleware rewrite
  
  **Recommendation**: Find the actual `/chat` handler or add to orphan list if it's truly missing.

### Incorrect Link References
- **`components/dashboard/EmptyState.tsx` and `components/dashboard/NoIdeaQueue.tsx`**: Both link to `/transactions` (no leading `/office/cash-flow`), but the actual page is at `/office/cash-flow/transactions`. This is likely:
  - URL rewrite/middleware redirect
  - Bug in link construction
  - Old routing that was changed without updating links

### Cron Routes (Vercel)
- All `/api/cron/*` routes marked as **live** despite zero grep hits, as these are invoked by Vercel's cron scheduler, not client code.
- Verification: Check Vercel project configuration for active cron jobs.

### Conditional/Dynamic Navigation
- Some routes referenced via string concatenation (e.g., `router.push(\`/chat?type=${type}\`)`), which aren't easily statically analyzable but have been counted if the base path is found.
- `/office` routes heavily cross-linked within dashboard components; all appear active.

### Auth Callback Routes
- `/login`, `/signup`, and auth flows appear well-maintained with multiple reference sites.
- No dedicated auth callback route like `/auth/callback` found in this codebase (likely handled by Supabase Auth middleware).

