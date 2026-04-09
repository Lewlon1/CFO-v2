# Tech Debt Registry — The CFO's Office

> Last updated: 2026-04-09
> Generated during Session 16 (Repo Audit & Landing Page)
>
> Living document — update as debt is added or resolved.
> Entries sourced from manual testing across sessions 3–19 plus the
> Session 16 read-only audit. Session labels below are preserved verbatim
> from the testing notes.

---

## 🔴 Launch Blockers (fix before beta users)

| #  | Issue | Source | Impact | Resolution |
|----|-------|--------|--------|------------|
| 1  | `create_action_item` DB error: *"Could not find the 'user_id' column of 'action_items' in the schema cache"* (PGRST204) | Session 19 (balance sheet) | Action item creation silently fails in chat | Next session |
| 2  | Duplicate rule conflict blocks value category updates (e.g. Deliveroo can't move Foundation → Leak) | Session 17 | Users can't correct their own categorisations | Next session |
| 3  | `apply_to_similar` may be overwriting manually-confirmed transactions — needs verification test (see Playbook A) | Sessions 16, 17 | Silent data loss on confirmed categories | Next session |
| 4  | Poison rule mis-categorising late-night Aldi visits — bad rule needs deletion + guardrails | Session 17 | Bad rules compound over time | Next session |
| 5  | Cannot create new user (blocks seed + onboarding testing) | Sessions 6, 13 | Cannot onboard anyone or reset test state | Next session |
| 6  | Onboarding flow not validated end-to-end | Session 4 | First impression broken | Next session |
| 7  | Transaction upload + auto-categorisation review outstanding | Session 3 | Core data pipeline unverified | Next session |
| 8  | CSV upload flow needs automation + gap analysis verification | Session 15 | Manual gap in beta-ready path | Next session |
| 9  | Multi-tool chain failures in chat | Session 7 | Conversations break mid-flow | Next session |
| 10 | Zero-transaction users: *"How much did I spend?"* should return a helpful error | Session 7 | New users hit confusing failures | Next session |
| 11 | Gap analysis (Value Map vs actual) needs verification | Sessions 7, 15 | Flagship "aha" feature unverified | Next session |

---

## 🟡 Quality & Reliability (fix before scaling)

| #  | Issue | Source | Impact | Resolution |
|----|-------|--------|--------|------------|
| 12 | Data export exposes internal data model (raw column names) | Session 12 | Trust/polish issue | Tier 2 |
| 13 | Investment analysis charts don't render correctly | Session 10 | Broken visuals erode trust | Tier 2 |
| 14 | Scenarios created in chat not logged to What If section (pill button does log) | Session 10 | Users can't find saved scenarios | Tier 2 |
| 15 | Monthly review: value shift detection weak | Session 8 | Reviews feel generic | Tier 2 |
| 16 | Monthly review: goal / action item context understanding | Session 8 | Reviews miss user priorities | Tier 2 |
| 17 | Bill management: no delete option | Session 9 | Users stuck with wrong bills | Tier 2 |
| 18 | Bill management: doc upload consistency needs improvement | Session 9 | Friction in bill tracking | Tier 2 |
| 19 | Bill management: add new variables | Session 9 | Feature gap | Tier 2 |
| 20 | Cron job configuration unverified (bills + nudges) | Sessions 9, 11 | Scheduled tasks may not run | Tier 2 |
| 21 | Payday detection nudge untested on CSV upload | Session 11 | Proactive feature may not fire | Tier 2 |
| 22 | Values over time methodology unclear — should every transaction be F/I/L/B? | Session 5 | Dashboard view may be misleading | Architecture decision |
| 23 | Recurring bill detection method review | Session 5 | Detection approach unverified | Tier 2 |
| 24 | Value Map part 2 needs a "don't know / skip" option | Session 13 | Forces false answers | Tier 2 |
| 25 | Mobile UX needs review | Session 13 | Mobile-first product, mobile untested | Tier 2 |
| 26 | Error handling review across app | Session 13 | Inconsistent failure UX | Tier 2 |
| 27 | Tell Claude *"actually dining is an investment for me"* — verify it acknowledges and calls the tool | Session 4 | Inline correction flow unverified | Tier 2 |
| 28 | Empty-queue handling for `get_value_review_queue` — CFO should say *"all confirmed"* rather than call the tool with an empty result (see Playbook B) | Session 16 (transactions refactor) | Poor UX when everything is already reviewed | Tier 2 |

---

## 🔵 Token Efficiency & Developer Experience

| #  | Issue | Source | Impact | Resolution |
|----|-------|--------|--------|------------|
| 29 | Messages table doesn't show which tool was called (`tools_used = null` tracking bug, pre-existing) | Sessions 7, 16 (refactor) | Developer visibility only | Tier 3 |
| 30 | 3 deferred TODOs: `TODO(session-14): log to user_events` in `src/lib/ai/tools/upsert-asset.ts`, `upsert-liability.ts`, `get-balance-sheet.ts` | Session 16 audit | User event coverage gap for balance-sheet tools | Session 14 |
| 31 | `src/lib/ai/context-builder.ts` at 1,316 lines — largest file in the repo, candidate for future refactor | Session 16 audit | Token / maintenance burden | Tier 3 |
| 32 | Large files to monitor (300+ lines): `app/api/chat/route.ts` (679), `value-map-flow.tsx` (672), `HoldingsPreview.tsx` (641), `get-value-review-queue.ts` (542), `value-map-card.tsx` (532), `demo-card.tsx` (466), `MessageList.tsx` (462), `feedback.ts` (451), `model-scenario.ts` (444), `StructuredInput.tsx` (408), `api/demo/reading/route.ts` (400), `api/upload/route.ts` (390), `api/balance-sheet/route.ts` (385), `UploadWizard.tsx` (363), `demo-reveal.tsx` (360), `balance-sheet-import.ts` (350), `BillUploadModal.tsx` (337), `question-registry.ts` (332), `ChatInterface.tsx` (319) | Session 16 audit | Future refactor candidates | Tier 3 |
| 33 | Unused npm dependencies not verified — run `npx depcheck` in a follow-up | Session 16 audit | Possible bundle bloat | Tier 3 |
| 34 | Custom favicon needed — `src/app/favicon.ico` may still be the default Next.js favicon | Session 16 audit | Minor branding polish | Tier 3 |

---

## ⚪ Polish & UX (nice to have)

| #  | Issue | Source | Impact | Resolution |
|----|-------|--------|--------|------------|
| 35 | Chat "pill button" pop-outs behave inconsistently when asking questions | Session 6 | Minor UX inconsistency | Tier 3 |
| 36 | Completed vs active chat concept unclear — verify old chats can be followed up and context extracted | Session 6 | Conversation continuity | Tier 3 |
| 37 | Profiling engine priority logic unverified (Phase 1 → Phase 2 ordering; `monthly_rent` only if housing is rental) | Session 6 | Questions may appear out of order | Tier 3 |
| 38 | Loading states too passive during tool calls | Session 10 | User wonders if app is stuck | Tier 3 |
| 39 | "What if" pill button may not add value | Session 10 | Product judgment call | Evaluate |

---

## ✅ Resolved

| # | Issue | Resolved In | Date |
|---|-------|-------------|------|
| R1 | Default Next.js landing page at `/` | Session 16 (audit) | 2026-04-09 |
| R2 | Default template SVGs (next, vercel, file, globe, window) | Session 16 (audit) | 2026-04-09 |

---

## Session 16 Audit Summary

- **Total source files (src/):** 264
- **Files removed:** 5 (all `public/*.svg` template assets)
- **Source files flagged as suspect but kept** (with reason):
  - `src/lib/categorisation/categorise-transaction.ts` — still used by `src/components/value-map/value-map-flow.tsx`
  - `src/lib/csv/*` (column-detector, hash, transform) — still used by parsers/upload, distinct purpose from `src/lib/parsers/`
- **TODO/FIXME comments found:** 3 (all deferred to Session 14)
- **Unused npm dependencies:** not checked in this session (follow-up: `npx depcheck`)
- **Largest files (top 5 by line count):**
  1. `src/lib/ai/context-builder.ts` — 1,316
  2. `src/app/api/chat/route.ts` — 679
  3. `src/components/value-map/value-map-flow.tsx` — 672
  4. `src/components/upload/HoldingsPreview.tsx` — 641
  5. `src/lib/ai/tools/get-value-review-queue.ts` — 542

---

## Verification Playbook

Tests below can be run directly from a future session to diagnose specific blockers.

### Test A — `apply_to_similar` must not overwrite confirmed transactions
*Covers blockers #3, #28.*

1. Pick a transaction you manually confirmed in a prior test (from a merchant with many transactions).
2. In chat, classify a *different* transaction from the same merchant with a different value category, and call the tool with `apply_to_similar: true`.
3. Check the DB — the originally-confirmed transaction should be unchanged: `value_confirmed_by_user` still `true`, original `value_category` intact.

### Test B — Empty queue graceful handling
*Covers #28.*

```sql
update transactions
set value_confirmed_by_user = true
where user_id = '<uid>';
```

Then in chat: *"Let's review my value categories"*.
**Expected:** CFO says something like *"All your value categories look confirmed"* rather than calling the tool and returning an empty result.

Roll back:

```sql
update transactions
set value_confirmed_by_user = false
where user_id = '<uid>';
```

### Test C — DB state snapshot after any value-category session

```sql
-- Unreviewed transactions remaining
select count(*) from transactions
where user_id = '<uid>'
  and value_confirmed_by_user = false
  and value_confidence < 0.7;

-- Recent rules created
select * from value_category_rules
where user_id = '<uid>'
order by created_at desc
limit 10;

-- Correction events logged
select event_type, payload, created_at
from user_events
where profile_id = '<uid>'
  and event_type = 'value_category_corrected'
order by created_at desc
limit 10;
```
