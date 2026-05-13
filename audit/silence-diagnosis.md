# Production Silence Diagnosis — 2026-04-24 → 2026-05-13

**Investigation date:** 2026-05-13
**Branch:** `investigation/silence-2026-04-24-nervous-shannon` (re-base off `claude/nervous-shannon-750502`; original `investigation/silence-2026-04-24` remains on origin off `main`)
**Production project:** `iccelmjenljanqrhhzdv` (CFO Production, eu-west-1)
**Scope:** read-only. No code, no migrations, no deployments.

## Verdict

**Behavioural, not technical.** Nothing is broken. The chat persistence path works, auth works, and users *are* coming back to the app — they're just not engaging chat once they arrive. Proceed with the refactor plan.

A secondary finding worth flagging separately: the nudges cron has written **zero rows in the last 23 days**, which is suspicious even with a dormant user base. Not a blocker for the refactor, but worth a follow-up.

## 1. What broke

Nothing.

## 2. What didn't break (with evidence)

### 2.1 No deploys in the silence window

`git log --all` across 2026-04-15 → 2026-05-01 returns **zero commits across all branches**. The last code commit before the silence was 2026-04-14 (`3aa3f96` — merge of #30 "Install Vercel Web Analytics"). Inspecting that diff:

```
cfos-office/src/app/layout.tsx | 2 ++
cfos-office/package.json       | 1 +
cfos-office/package-lock.json  | 43 +++
cfos-office/.vade-report       | 63 +++
```

The only application-code change was `+ import { Analytics }` and `+ <Analytics />` in the root layout — a pure client-side telemetry component, structurally unable to break server-side message persistence.

Lewis re-engaged with development on 2026-05-01 and has been actively committing since (28 commits May 1 → May 13). The "silence" therefore brackets a period during which the deployed code was *unchanged*: nothing was shipped that could have broken anything.

### 2.2 The chat persistence path is intact

`cfos-office/src/app/api/chat/route.ts` on `claude/nervous-shannon-750502` (HEAD `787d8e24`):

- Line 40: `supabase.auth.getUser()` — server-side auth check
- Line 166: user message insert into `messages` table (`await supabase.from('messages').insert({...})`)
- Line 696: assistant message insert in `streamText`'s `onFinish`

Auth uses `@supabase/ssr` cookie-bound `createServerClient` in `cfos-office/src/lib/supabase/server.ts:1-22`. No `middleware.ts` exists; auth gating happens per-route.

The nervous-shannon route adds onboarding-v2 logic (decline classifier before streaming, action-marker stripping in `onFinish`) but the user/assistant message-insert calls themselves are unchanged from the `main` version. The structural conclusion holds for both branches.

### 2.3 Auth is issuing sessions during the silence window

```sql
SELECT date_trunc('day', created_at)::date AS day, count(*) AS sign_ins
FROM auth.sessions
WHERE created_at >= '2026-04-15' AND created_at < '2026-05-14'
GROUP BY 1 ORDER BY 1;
```

Result:

| day        | sign_ins |
|------------|---------:|
| 2026-05-02 | 1        |
| 2026-05-06 | 1        |
| 2026-05-07 | 1        |

Three successful sign-ins post-silence, across three different users. Auth is working.

### 2.4 No "orphan empty conversations" pattern

If message inserts had been silently failing post-Apr-24, we'd expect conversations created with zero messages. The only conversations created in the silence window:

| conversation_id                          | created_at        | msg_count |
|------------------------------------------|-------------------|-----------|
| f7e390a1-c707-4ba3-a50d-f9578bede08c     | 2026-04-23 10:04  | 21        |
| a92a051b-0458-41aa-bd62-b1e0564605db     | 2026-04-23 11:31  | 16        |
| 8bb8fa09-25a7-47fa-b61c-84709367c105     | 2026-04-24 11:29  | 2         |

The April 24 conversation has the one user message + one assistant message that match the daily counts (status still `active`). All three conversations have writes. No silent-failure signature.

### 2.5 No spike in failed writes (with caveat)

The Supabase MCP `get_logs` tool returned `INVALID_ARGUMENT: User specified reservation projects/supabase-analytics-ext-queries/locations/EU/reservations/queries-short-12hr is not found` for both `api` and `auth` services — platform-side failure of the log query reservation, not just the 24-hour retention limit. So I could not pull historical error rates directly. However, the absence of orphan conversations (§2.4) is the structural signal that would have shown a silent write-failure pattern; that signal is absent.

### 2.6 Onboarding-v2 surface — not in production, but worth flagging for once it ships

`claude/nervous-shannon-750502` adds two onboarding-v2 hooks to the chat route that don't exist on `main`:

1. **Synchronous Haiku `classifyValueMapDecline` call** (call site `cfos-office/src/app/api/chat/route.ts:200`, gating `if` at lines 191-198) before `buildSystemPrompt`, when the user is on the chat onboarding route and the Value Map has been offered but not declined. Helper at `cfos-office/src/lib/onboarding-v2/value-map-decline-classifier.ts`.
2. **Action-marker stripping** (`<ACTION:start_value_map>`) in the `onFinish` callback, via `hasStartValueMapAction` / `stripActionMarkers` from `cfos-office/src/lib/onboarding-v2/bridge.ts`.

This code **is not deployed**; it lives only on the feature branch. It therefore cannot have caused the 2026-04-24 silence. But for the team's awareness when nervous-shannon ships:

- The action-marker helpers are pure string functions (no I/O) — not a failure surface.
- The decline classifier is `await`ed on the request critical path. The helper itself is fail-open (its `try/catch` swallows Bedrock errors and returns `false`, with a `warning`-level alert via `sendAlert`), so a Bedrock outage won't 500 the chat. **But it does add one Haiku round-trip of latency** to every onboarding chat turn until either (a) the user accepts the Value Map or (b) the classifier flips `value_map_declined_in_chat` to `true`. A Bedrock latency spike — not failure — could push a chat response past the route's `maxDuration = 60` limit and 504 the request.
- Worth tracking once shipped: alert volume for `onboarding_v2_value_map_decline_failed` and the p99 latency added by the classifier call.

None of this is the cause of the silence under investigation. Documented here because the file-level audit was redone against nervous-shannon and these are the additions vs. `main`.

## 3. Behavioural picture

### 3.1 The "April 24 cliff" is a misleading framing

Daily message volume in the lead-up was already collapsing:

| day        | user_msgs | asst_msgs | distinct_users |
|------------|----------:|----------:|---------------:|
| 2026-04-10 | 20        | 25        | 1              |
| 2026-04-11 | 2         | 4         | 2              |
| 2026-04-12 | 17        | 22        | 3              |
| 2026-04-13 | 27        | 34        | 2              |
| 2026-04-17 | 20        | 21        | 1              |
| 2026-04-18 | 21        | 21        | 1              |
| 2026-04-23 | 19        | 18        | 1              |
| 2026-04-24 | **1**     | **1**     | 1              |

Peak day was April 12 (3 distinct users). By April 17 there was only one active user, and from April 18 → April 24 the entire base had collapsed to a single user. April 24 itself was the trailing wisp of *one* user's session: one message, one reply, then nothing. Not a cliff — a tail.

### 3.2 Users are returning to the app without engaging chat

Of the nine `auth.users` rows, the three most-engaged users have all signed in since the silence began:

| user_id (short) | signup     | last_login     | total_user_msgs | last_msg_day |
|-----------------|------------|----------------|----------------:|--------------|
| eac08b34…       | 2026-04-13 | **2026-05-07** | 43              | 2026-04-24   |
| eb587a09…       | 2026-04-10 | **2026-05-06** | 21              | 2026-04-11   |
| a26cc3f5…       | 2026-04-11 | **2026-05-02** | 6               | 2026-04-12   |

The most-engaged user (`eac08b34`, 43 messages) logged in as recently as May 7 and sent nothing — 13 days of post-login silence. The May 6 sign-in by `eb587a09` aligns with the **single** `value_map_sessions` row in the window (also 2026-05-06): that user came back, did a Value Map retake, didn't chat. So at least one returning user *did* engage a non-chat product surface; they just didn't message the CFO.

That pattern — sign in, do something light, leave — is the live story behind the silence. It's the absence of a chat pull, not a broken pipe.

### 3.3 Zero new signups in the silence window

```
auth.users (new)     0
user_profiles (new)  0
transactions         0
```

The funnel above chat is dry too. No new users, no new uploads. With no acquisition and no engagement, message volume can only decay.

## 4. Adjacent finding (non-blocker): nudges cron has produced zero rows in 23 days

`cfos-office/vercel.json` declares five crons (`portrait-extraction`, `daily-bills`, `nudges-daily`, `nudges-weekly`, `nudges-monthly`). The `nudges` table has **zero rows since 2026-04-20** (the floor of my query). This is *plausible* — all evaluators read transaction/bill data that hasn't refreshed since users went dormant — but zero rows over 23 calendar days deserves a sanity check that the cron is firing in production at all.

Cron firing telemetry is not visible from inside the DB (no `cron_runs` table found in this codebase). A separate session should:

1. Confirm Vercel cron status in the dashboard.
2. Either add a heartbeat row per cron run (a `cron_runs` table) or rely on Vercel cron logs.

This is **separate from** the user-silence question; flagging here so it doesn't get lost.

## 5. Engagement-pull gap (per project memory, but with sharper evidence)

CLAUDE.md notes re-engagement infrastructure is roadmapped but not built. The concrete shape of the gap, given the data above:

- Nudges deliver only to the in-app inbox. Search confirmed `RESEND_API_KEY` is referenced only in `cfos-office/src/lib/alerts/notify.ts` — Resend usage is operator-alert-only, not user-facing.
- No push, no email, no SMS. There is no mechanism by which a dormant user is reminded the app exists.
- Users *are* remembering on their own (3/9 came back) — but once back, they don't reach chat. So even closing the "remind them to return" gap would not by itself fix this; the in-app pull from `/office` toward `/chat` is also missing or weak.

## 6. Next action

**Proceed with the refactor plan.** There is no technical bug to fix first.

When prioritising what the refactor lands first, the data argues for surfacing chat affordance from the home/dashboard — three users opened the app and didn't chat. That's where the loss is, not in the chat route itself.

Separately, open a small follow-up (~30 min) to verify the nudges cron is actually executing in production.

---

## Phase artefacts

- **Phase 0 (setup):** 2026-05-13, branch `investigation/silence-2026-04-24` created off `main`.
- **Phase 1 (deploy history):** `git log --all` for 2026-04-15 → 2026-05-01 returns 0 commits. Last pre-silence commit `3aa3f96` (2026-04-14).
- **Phase 2 (error logs):** Supabase MCP `get_logs` unavailable due to a BigQuery reservation error; structural alternatives used (§2.4).
- **Phase 3 (auth + chat code):** `cfos-office/src/app/api/chat/route.ts`, `cfos-office/src/lib/supabase/server.ts`, and `cfos-office/src/lib/onboarding-v2/value-map-decline-classifier.ts` reviewed on `claude/nervous-shannon-750502` (HEAD `787d8e24`). Findings differ from main only in the additional onboarding-v2 surfaces (see §2.6); the message-write path itself is identical.
- **Phase 4 (engagement triggers):** `cfos-office/vercel.json` lists 5 crons; nudges deliver in-app only; no user-facing email.
- **Phase 5 (DB queries):** six SQL queries (A–F) against production, results inline above.
