# Route Audit Summary

**Audit Date**: 2024-12-20  
**Codebase**: CFO-v2 / cfos-office  
**Scope**: All `page.tsx` and `route.ts` files under `cfos-office/src/app/`

---

## Overview

| Category | Count |
|----------|-------|
| **Total Routes** | 93 |
| **Live Routes** | 79 (84.9%) |
| **Orphan Routes** | 14 (15.1%) |
| **Ambiguous Routes** | 0 |

### Live Routes by Type
- **Pages**: 40 live out of 41 (97.6%) — only `/v4` is orphaned
- **API Routes**: 39 live out of 52 (75.0%) — 13 API endpoints are orphaned

---

## Orphan Routes (14 total)

### Pages (1 orphan)
1. **`/v4`** — Possible old landing/demo page, check if still part of product

### API Routes (13 orphans)

#### High Priority for Removal
These have clear replacements or are obviously unused:

- **`POST /api/onboarding/complete`** — Superseded by v2 flow; all active code uses `/onboarding-v2/*`
- **`GET /api/dashboard/summary`** — Orphaned; unclear if replaced by real-time queries
- **`GET /api/dashboard/trends`** — Orphaned; companion to summary, likely removed together
- **`GET /api/bills/history`** — History endpoint with no references; CRUD operations active

#### Medium Priority
These are potentially dev endpoints or unused features:

- **`POST /api/analyze-conversation`** — Likely internal/dev endpoint
- **`POST /api/value-map/regenerate`** — Regeneration feature, may be unused
- **`GET /api/value-map/personal/impact`** — Nested endpoint, unclear purpose

#### Low Priority
These are likely exports or supplementary features:

- **`GET /api/balance-sheet`** & **`GET /api/balance-sheet/holdings`** — Both orphaned; may have been replaced by inline calculations
- **`GET /api/profile/export/profile`** & **`GET /api/profile/export/transactions`** — Export endpoints; confirm if user-facing before removing

---

## Key Findings

### 1. Orphaned Onboarding v1
The legacy onboarding endpoint `POST /api/onboarding/complete` has zero references while the v2 flow (`/onboarding-v2/*`) is heavily integrated. **Recommendation**: Safe to delete v1 if no backward compatibility needed.

### 2. Dashboard Data Endpoints
Both `GET /api/dashboard/summary` and `GET /api/dashboard/trends` are completely unreferenced. Either:
- Feature was removed but endpoints left behind
- Data now fetched via different routes
- Only queried server-side (unlikely given other endpoints are referenced)

**Recommendation**: Investigate and remove if confirmed unused.

### 3. Export Endpoints
Two separate export systems exist:
- **Account-level**: `POST /api/account/export` (referenced, active)
- **Profile-level**: `GET /api/profile/export/profile`, `GET /api/profile/export/transactions` (not referenced)

**Recommendation**: Consolidate or confirm if both are needed.

### 4. Missing `/chat` Page
Multiple files redirect to `/chat` or `router.push('/chat')`, but **no page exists** at this route. This is either:
- Handled by middleware rewrite to another route
- Dynamic route `app/chat/[id]/page.tsx` not captured in audit
- A bug where code links to non-existent route

**Action Required**: Verify where `/chat` actually resolves to.

### 5. Incorrect Link References
Components link to `/transactions` and `/bills`, but actual pages are at:
- `/office/cash-flow/transactions` (not `/transactions`)
- `/office/cash-flow/bills` (not `/bills`)

This suggests either middleware rewrites these paths or there's a routing inconsistency.

---

## Duplicate Route Clusters

No true duplicates found, but related route families:

### Onboarding Hierarchy
```
/onboarding-v2          (entry point)
├── /onboarding-v2/intro
├── /onboarding-v2/value-map
├── /onboarding-v2/upload
└── /onboarding-v2/archetype

Orphaned:
└── /api/onboarding/complete  (v1 legacy)
```

### Dashboard Structure
```
/office                 (root dashboard)
├── /office/cash-flow   (with subsections: bills, upload, transactions, etc.)
├── /office/net-worth   (with subsections: assets, balance-sheet, liabilities, upload)
├── /office/values      (with subsections: archetype, portrait, the-gap, etc.)
├── /office/scenarios   (with subsections: goals, trips, what-if)
├── /office/inbox
└── /office/settings
```

### Export/Profile Management
```
POST /api/account/delete       (active, referenced)
GET  /api/account/export       (active, referenced)
POST /api/profile/delete-data  (active, referenced)
GET  /api/profile/export/*     (orphaned)
POST /api/profile/update       (active, referenced)
```

---

## Caveats & Limitations

1. **Cron routes**: All `/api/cron/*` marked as live despite zero grep hits because Vercel invokes them, not client code. Verification requires checking Vercel project settings.

2. **Dynamic routes**: Audit doesn't capture routes with `[id]` or `[slug]` segments if they don't have explicit page/route files listed in grep.

3. **Middleware rewrites**: If middleware rewrites `/transactions` → `/office/cash-flow/transactions`, the grep finds references to both, but the actual route served is only the latter.

4. **String-built URLs**: Routes constructed dynamically via `fetch(\`/api/...\${type}\`)` are counted if the base path is found; specific endpoint coverage may be incomplete.

5. **Test/debug code**: Some endpoints may be intentionally orphaned for development. Check git history or code comments before bulk deletion.

---

## Recommended Cleanup Order

1. **Phase 1 (Safe to Delete)**:
   - `/api/onboarding/complete` — Clear replacement by v2
   - `/v4` page — Likely dead demo/landing

2. **Phase 2 (Verify First)**:
   - `/api/dashboard/summary` & `/api/dashboard/trends` — Confirm no hidden usage
   - `/api/balance-sheet*` — Check if replaced by inline calculations
   - `/api/bills/history` — Verify not needed for compliance/reporting

3. **Phase 3 (Clarify Intent)**:
   - `/api/profile/export/*` — Confirm if user-facing or internal
   - `/api/value-map/*` orphans — Check Figma/product docs for planned features

4. **Phase 4 (Fix Bugs)**:
   - Investigate `/chat` page routing
   - Fix links pointing to `/transactions` instead of `/office/cash-flow/transactions`

---

## Next Steps

1. Review `/chat` routing issue — critical UX blocker if pages redirect to non-existent route
2. Run cleanup on Phase 1 routes (onboarding v1, v4 page)
3. Investigate Phase 2 endpoints and document business logic before removal
4. Update link references to use correct paths (`/office/cash-flow/transactions` instead of `/transactions`)
5. Verify Vercel cron configuration matches deployed routes in summary

