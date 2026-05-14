# PR #38 — Verification Report

**Branch:** `consolidation/v2.2`
**Date:** 2026-05-14
**Session:** 07 — pre-merge verification pass
**Verifier:** Claude (Lewis collaborating)

---

## Merge verdict: **GO-WITH-FIXES**

All 5 verification phases passed. Two defects were found and fixed in-session on `consolidation/v2.2`. The safety-critical Phase 3.2 (deliberate-break test for `llm_usage_log` propagation isolation) passed cleanly — chat survives logging failure.

The PR is **safe to merge to main**.

---

## Per-phase summary

| Phase | Topic | Result |
|---|---|---|
| 0 | Setup & smoke (build, lint, test, dev boot, landing) | PASS |
| 1.1 | Fresh user happy path (struggle → Value Map → upload → archetype → wow moment) | PASS (with 2 fixes) |
| 1.2 | Edge paths (abandon/resume, gap redirect, back-nav) | PASS |
| 2 | Theme system (dark default, SSR no-flicker, /v4 palette) | PASS |
| 3.1 | Tool-call logging — `llm_usage_log` rows shape | PASS (4 distinct tools, multi-step verified) |
| 3.2 | Deliberate-break test — chat survives logging failure | PASS (full cycle: break → confirm → revert → resume) |
| 4 | Existing-user regression walk (office, 4 folders, gap, settings) | PASS |

---

## Phase 0 — Setup & smoke

- `npm run build`: clean (Turbopack, Next.js 16.2.2)
- `npm run lint`: 23 errors / 31 warnings (baseline 23/29 — 2 new warnings, 0 new errors)
- `npm test`: 175/175 passing across 18 test files
- Dev server boots in ~330ms; landing + `/v4` render, 0 console errors on either

---

## Phase 1 — Onboarding v2 end-to-end

### Defects found

**Defect P1.A — `loadConversation` doesn't fire wow-moment auto-trigger** (BLOCKING, fixed in-session)

The archetype orchestrator creates a `first_insight` conversation server-side via `POST /api/insights/post-upload`, then redirects to `/office?chat=open&conversationId=X`. `ChatOpenerTrigger` calls `loadConversation(id)`, but `loadConversation` ignores the conversation's `type` and never sets `pendingTriggerRef`. Auto-trigger never fires → no message generated → user lands in an empty chat sheet, with the wow moment silently lost.

This is the headline product change in PR #38 — **without this fix, the entire "new user journey" premise of the PR is broken**.

**Fix:** Lifted `AUTO_TRIGGER_TYPES` to module scope; `loadConversation` now inspects the conversation type from `/api/conversations/recent` and queues the auto-trigger when type is in the set AND the conversation has zero messages. A `pendingTriggerNonce` state forces the `useEffect` to re-evaluate after the ref is set inside a promise resolution.

- Commit: `e4eea1e` — `fix(chat): auto-trigger wow moment for server-created first_insight convos`
- Files: `cfos-office/src/components/chat/ChatProvider.tsx` (+49, -17)

**Defect P1.B — Test driver waited for a removed "Continue" button** (non-blocking, fixed in-session)

In onboarding mode `ValueMapFlow.handleExerciseComplete` sets `readyToFinish=true` directly after the 10th card, fires the orchestrator's `onComplete` → `router.push('/upload')`. The summary screen with a "Continue" button is unreachable in this mode. The Playwright driver still waited for that button (artefact of the old beat-based flow) and timed out.

**Fix:** removed the obsolete `Continue` wait; just wait for URL change to `/onboarding-v2/upload`. Also bumped the post-archetype assistant-message poll from 90s → 150s — Bedrock cold paths take 60-90s and were occasionally clipping the wow moment in the runner output.

- Commit: `defe971` — `fix(tests): align onboarding driver with current Value Map → Upload flow`
- Files: `cfos-office/tests/onboarding/runner/playwright-driver.ts` (+7, -5)

### Happy path (post-fix)

Verified via custom test runner (`truth-teller-balanced` persona) + Playwright MCP. Five stages completed cleanly:

| Stage | Result |
|---|---|
| `struggle_submitted` | PASS — user lands at `/onboarding-v2`, fills struggle, advances |
| `value_map_done` | PASS — intro page skipped (commit `1369128`); 10 cards sorted; auto-advances to `/upload` |
| `upload_done` | PASS — CSV parsed; lands at `/onboarding-v2/archetype` |
| `archetype_shown` | PASS — Bedrock archetype generation succeeds in ~10.7s; "See what I found →" CTA enables |
| `complete` | PASS — first_insight conversation created via `/api/insights/post-upload`; wow moment generated and rendered in chat |

`user_profiles.onboarding_completed_at` stamped at completion. 43 transactions imported.

### Edge paths

- **Abandon / resume**: `resume.ts` logic verified statically. All 6 stages of `OnboardingStep` map to the correct route. Legacy `intro_shown` → `/value-map` (correct post intro-drop).
- **"Show me the gap" redirect**: superseded by commit `f6b0645`. Button now reads "See what I found →" and routes to `/office?chat=open&conversationId=X` (wow moment), not the gap page. The Gap page itself was verified directly in Phase 4 — renders 411 transactions worth of gap analysis for the test user.
- **Back-nav**: by design, `resume.ts` enforces forward-only progression. Hitting browser back from `/upload` redirects forward to `/upload` (because `step === 'value_map_done'`). Intentional, not a regression.

### Wow-moment verbatim — Session 06 before-state

Captured 2026-05-14 08:41:16 UTC for fresh user `24e66c3d-7b78-4899-862d-738d101cbb7f` (truth-teller-balanced persona, GBP profile):

```
Right. I've been through your numbers — here's what I see.

Your spending has a clear shape: housing dominates everything else.
We're talking **housing is 73% of spending (£2,700)** across the three
months I can see. That's not necessarily a problem — in expensive
cities it just *is* — but it means every other financial decision you
make is playing out in the remaining 27%. Understanding that slice is
where the real leverage lives.

[STATS]
Tracked spend | £4,135
housing | 73%
Peak day | Sun
[/STATS]

Now here's the pattern that caught my eye: **Sundays are your spending
day**. Significantly so — Sundays are running at £1,872 vs £377 on
other days. That's not random noise, that's a habit. Could be a big
recurring payment landing on Sundays, could be weekend lifestyle
spending that concentrates on the day itself. Worth knowing either
way.

Across **43 transactions** you're showing real discipline — 80/100 on
the scoring I use internally, which puts you comfortably in the "this
person has their fundamentals sorted" camp. The work now isn't fixing
problems, it's optimising.

What I don't have yet is your income — which means I can't tell you
how much breathing room you actually have, or whether that housing
number is tight or comfortable for you. That's the next piece I need
to give you a complete picture.

[OPTIONS]
- Break down my housing
- Let's get started
[/OPTIONS]
```

**Constitution v1.1 drift to flag for Session 06:**
- First person used throughout ("I've been through", "I can see", "I need", "I use") — §2 says strict no-first-person
- No "— C." sign-off
- Otherwise: tangible-comparison framing present, fact-first opening, named the gap without lecturing

---

## Phase 2 — Theme system

- ✅ **Dark mode SSR**: raw HTML response carries `<html class="dark ...">`. Flicker is structurally impossible — first paint already has dark applied. No need for client-side reconciliation.
- ✅ **`color-scheme: dark`** on root, `colorScheme: 'dark'` in `viewport` export, `dark` class on `<html>` — the belt-and-suspenders dark-mode fix cherry-picked in `a614243` is fully integrated.
- ✅ **Warm CFO palette**: body bg `#13110D` (walnut), fg `#F4EDD9` (cream), primary `#E8A84C` (brass). CTAs on `/v4` render brass-on-walnut as designed.
- ✅ **`/v4` route**: live, intentional. No stale references found in code.
- ⚠ **Token-aware utilities spot-check**: surfaces visually coherent; full toggle-across-all-pages test deferred to next pass (theme toggle UI present in `/office/settings` and visible).
- ⚠ **Throttled connection test**: not run via DevTools throttle. Mitigation: the SSR-side `dark` class makes flicker structurally impossible regardless of network speed.

---

## Phase 3 — `llm_usage_log` tool-call logging

### 3.1 Tool calls land with correct shape — PASS

Triggered 4 distinct tools via chat as `lonsdale744@gmail.com`:

| `tool_name` | `tools_in_step` | `prompt_tokens` | `step_input_tokens` | Fired at |
|---|---|---|---|---|
| `create_goal` | 1 | NULL | 19311 | 08:51:02 |
| `get_spending_summary` | 1 | NULL | 19670 | 08:52:10 |
| `compare_months` | 2 | NULL | 20322 | 08:54:49 |
| `create_action_item` | 2 | NULL | 20322 | 08:54:49 |

**Key validations:**
- ≥3 distinct tool names: ✅ (4)
- `prompt_tokens` and `completion_tokens` NULL on all `tool_call` rows: ✅ (100%, deliberate per Session 02 design)
- Metadata populated: `tools_in_step`, `step_input_tokens` present
- **Multi-tool step correctly attributed**: `compare_months` + `create_action_item` both logged with `tools_in_step=2` in the same step (08:54:49) — no double-counting because token columns are NULL. Aggregation via `metadata->>'step_input_tokens'` works without inflating sums.

### 3.2 Deliberate-break test — PASS

The safety-critical test. Full cycle completed:

1. Injected `throw new Error('break test')` in `logToolCall`'s try block (before `.insert()`). Required dev-server restart — Turbopack didn't HMR the library file (worth knowing for future).
2. Triggered tool-using chat: "Pull my spending breakdown for March 2026 again"
3. **Result**: chat response streamed and rendered cleanly for the user ("Same numbers — March 2026 came in at €4,177 total." + full category breakdown). **Zero new rows** in `llm_usage_log` after the break-injection timestamp (09:00:00).
4. Reverted via `git checkout` — `git diff cfos-office/src/lib/observability/llm-usage-log.ts` returned 0 lines.
5. Restarted dev server, triggered another tool-using chat.
6. **Logging resumed**: new `get_spending_summary` row at 09:03:52, exactly as expected.

This verifies that logging failures are isolated inside `logToolCall`'s try/catch and never propagate to the chat response. The fire-and-forget `void logToolCall(...)` pattern in `app/api/chat/route.ts:537` works as designed.

**Minor observation (non-blocking)**: the `console.error('[llm_usage_log] tool_call write failed:', err)` in the catch block didn't appear in `/tmp/cfos-dev*.log`. The chat survival and DB-row-suppression evidence is sufficient for the safety claim, but the error visibility is worth a separate investigation (Turbopack/Node stderr handling, or the catch's `err` formatter).

---

## Phase 4 — Existing-user regression walk

Walked `lonsdale744@gmail.com` (411 transactions, real value map, mature account):

| Surface | Result |
|---|---|
| `/office` home | PASS — 4 folders linked, banner renders ("Morning, Lewis · Thu 14 May") |
| `/office/cash-flow` | PASS — 0 console errors |
| `/office/values` | PASS — 0 console errors |
| `/office/net-worth` | PASS — 0 console errors |
| `/office/scenarios` | PASS — 0 console errors |
| `/office/values/the-gap` | PASS — 411 transactions, real gaps surfaced (Gym Membership "Investment" → barely spent on; Dinner Out "Investment" → flagged) |
| Chat (via Phase 3.1) | PASS — 5 separate exchanges, multiple tool calls, all responded |
| `/office/settings` | PASS — theme toggle, sign out, data export, danger zone all render |
| Inbox (1 unread nudge) | renders correctly |

No regressions observed. Cookie-based auth round-trip works. Onboarding v2 refactor did not disturb existing-user data paths.

---

## Defect summary

| ID | Severity | Status | Description |
|---|---|---|---|
| P1.A | Blocking | Fixed (commit `e4eea1e`) | Wow moment auto-trigger never fired for server-created `first_insight` conversations |
| P1.B | Non-blocking | Fixed (commit `defe971`) | Test driver waited for a Continue button that doesn't exist in onboarding-mode Value Map flow |
| P3.2 | Non-blocking | Deferred | `console.error` in `logToolCall`'s catch block not visible in dev log; investigate Turbopack/Node stderr handling |

### Deferred (non-blocking) for follow-up

- **Tier 1 dead-code cleanup**: not in this PR by design (would have deleted `/v4` page, plus migration 042 numbering conflict). Should be a separate PR — see `BACKLOG.md`.
- **Full theme-toggle-across-every-surface test**: spot-checked OK, full sweep deferred.
- **Throttled-connection visual test**: SSR dark class makes structural flicker impossible, but a real-device throttled test is recommended for an end-user demo build.
- **Migration 042 + 043 production apply**: still pending Lewis (idempotent backfill, safe).
- **Constitution v1.1 prompt rewrite** to remove first-person from `BASE_PERSONA` and wow-moment prompts — owned by Session 06. Before-state captured above.

---

## Commits added to `consolidation/v2.2` during verification

```
defe971 fix(tests): align onboarding driver with current Value Map → Upload flow
e4eea1e fix(chat): auto-trigger wow moment for server-created first_insight convos
```

---

## Final state checks

- ✅ `git diff cfos-office/src/lib/observability/llm-usage-log.ts` = 0 lines (break reverted cleanly)
- ✅ All in-session fixes committed; tree clean apart from the new audit doc + SESSION-LOG entry
- ✅ No production database writes during this session (staging only)
- ✅ No prompt files touched (wow-moment drift recorded, not fixed)
- ✅ Migration 042 + 043 still on staging; production untouched
- ✅ 3 test users left on staging from runner runs (`@cfo-test.local` domain) — runner's default cleanup will catch them on next run
