# Session 30 — Chat critical-path latency

**Date:** 2026-05-22
**Branch:** `session-29/onboarding-state-machine`
**Scope:** chat route latency for an onboarding (`onboarding_goal_chat`) turn, before vs after Session 30.

## What changed

Two synchronous DB round-trips were removed from the chat route's request-blocking path:

1. **Decline classifier** — already had a regex pre-filter (`quickClassifyDecline`) gating the Haiku call. No code change needed; Session 30 just adds path-tagged telemetry (`value_map_decline_classified` user_event) so the hit-rate can be measured against the assumption that >70% of replies are settled by regex.
2. **Stall handler** — the 2-query check (`messages.user_count` + `goals.active_count`) ran synchronously *before* the LLM call on every onboarding-goal-chat turn. Now it runs inside `after()` post-response. Behaviour preservation: the pivot instruction shows up in the *next* turn's prompt (gated on `onboarding_step === 'goal_chat_tentative'` in `buildGoalDeriveConfirmContext`) rather than the *current* turn's. One-turn delay; acceptable.

## Measurements

> Not captured in this session. The latency win is structural — two count queries removed from the synchronous path — so the win is reproducible without an A/B measurement. A staging spot-check would confirm the order-of-magnitude saving but isn't load-bearing for the decision.

**Estimated saving per onboarding-goal-chat turn**: ~50–150ms (two round-trip count queries against `messages` and `goals`, in series with prompt building). This is on the critical path before the streamText call, so the user feels it as a delay before the first token arrives.

**Estimated saving across the funnel**: every onboarding-goal-chat user's first ~5 turns (typically 4–10 turns before either goal_set or stall). At 100ms saved per turn × 5 turns × ~50% of new users entering the chat-path route, the aggregate saving is real but small.

## Regex hit-rate measurement

The chat route now writes a `value_map_decline_classified` event with `payload.path` ∈ `regex_declined | regex_accepted | haiku` for every Value-Map decline classification. Query plan:

```sql
SELECT payload->>'path' AS path, COUNT(*)
FROM user_events
WHERE event_type = 'value_map_decline_classified'
  AND created_at >= now() - interval '7 days'
GROUP BY path;
```

Hit-rate target: regex paths ≥ 70%. If lower, expand the regex set in `quickClassifyDecline`.

## What did NOT change

- The Haiku decline call itself — same model, same prompt, same fail-open.
- `recomputeIfStale` — already gated on `onboarding_completed_at != null` in Session 29.
- The prompt-builder parallel reads — already done in commit `1466a44`.

## Verification

- 687 tests pass (681 → 687, +6 emit-action tests)
- `tsc --noEmit` clean
- `next build` clean (11.9s)

## Open items

1. Capture actual before/after p50/p95 latency on staging once seeded users are running through the onboarding flow.
2. Watch the regex hit-rate over the first week. If it drops below 60%, the regex needs broadening.
3. Watch stall-pivot promptness. If users complain the pivot lands a turn late, the safety net can be re-inserted on the request path with a lightweight pre-check.
