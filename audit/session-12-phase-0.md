# Session 12 — Phase 0 Audit (CFO Goal-Awareness)

**Investigation date:** 2026-05-14
**Branch:** `feature/goal-aware-office` (shared with Sessions 11 + 14)
**Constitution version on disk:** v1.2 (May 2026) — to be bumped to v1.3 this session.

## Constitution v1.2 intersection map (where goal-awareness lands)

Goal-awareness threads through v1.2 already, but as voice/example artefacts — not as a top-level behavioural rule. v1.3 codifies it.

- **§3 ("What the CFO does")** — line 119-120 already plants the seed: *"These three activities serve one job above all others: helping the user reach their stated financial goal. Every CFO interaction either advances the goal, names a gap that's preventing the goal, or maintains the relationship between the user and the goal across time."* This is the bridge sentence the new §3 Goal-awareness sub-section operationalises. Placement: insert after line 120, before "Allocation questions" at line 121.
- **§5 ("Knowledge hierarchy")** — line 151 lists the active goal as #1: *"The user's active goal. What they're trying to achieve, the target, the timeline. The CFO refers to it by the user's own name for it ('Japan', 'the deposit', 'the buffer') rather than a category."* Hierarchy entry stays; v1.3's behavioural rule is in §3.
- **§5 (Gap response shape)** — assumes a goal-conditioned reasoning frame. Not modified by v1.3.
- **§6 (Bad-month accountability)** — line 190 is goal-paced ("quantify the shortfall against the active goal in concrete numbers"). Implicitly assumes a goal exists. v1.3's no-goal protocol is the complementary case.
- **§8 (Status-check anchor)** — line 232 ("Status checks on a goal anchor in four slots…") assumes goal exists. v1.3 adds: when no goal, no status-check is possible — the no-goal surfacing happens instead.
- **§9 (Reference exchanges)** — 6 of 8 exchanges (A, B, C, D, F, G) reference a goal explicitly or implicitly. E and H do not. A new §9.I is added: *No active goal* — the canonical no-goal exchange, mirrored into the §9 harness as case 9I.
- **§10 (Maintenance protocol)** — v1.3 entry added above the v1.2 entry. The few-shot-re-derivation rule from v1.2 carries forward: if the 9th harness case converges on different prose than §9.I's draft, §9.I is rewritten to match.

## §9 harness structure (the regression net)

[`cfos-office/scripts/test-prompts.ts`](../cfos-office/scripts/test-prompts.ts) — Session 06 asset.

- **Assembly:** `BASE_PERSONA + DIRECT_REGISTER + '\n\n---\n\n' + case.context` (line 263). Single user message. No tools. Bedrock cache point on system role.
- **Case shape:** `{ id, title, context, userMessage, checks: { name, test: (out: string) => boolean }[] }` (line 44-50). `id` is a literal union `'9A' | … | '9H'` — to extend with `'9I'`.
- **Check helpers:** `containsCaseInsensitive`, `regexCheck`, `endsWithSignOff`, `noFirstPerson` (with `stripUserQuotes` to allow first-person inside quoted user blocks), `noApology`.
- **Per-case pass:** all checks must pass. Up to 3 retries per case (line 321 `while (attempt < 3 && !passed)`).
- **Exit gate:** `process.exit(failed.length > 1 ? 1 : 0)` (line 370) — one failure tolerated. With 9 cases this enforces ≥8/9.
- **Cache + cost telemetry:** prints token totals and cache hit rate at the end.

## Goal context today (the silent no-goal state)

[`cfos-office/src/lib/ai/context-builder.ts`](../cfos-office/src/lib/ai/context-builder.ts).

- **Fetch:** [line 567-571](../cfos-office/src/lib/ai/context-builder.ts) — `supabase.from('goals').select('*').eq('user_id', userId).eq('status', 'active')`. Note: **no `deleted_at IS NULL` filter** — divergent from `getPrimaryGoal`'s filter. Latent inconsistency; the hybrid approach in Phase 3 treats `getPrimaryGoal` as the canonical signal so the no-goal marker wins when the two diverge.
- **Renderer:** `buildGoalsContext(goals, actions)` at [line 1183-1212](../cfos-office/src/lib/ai/context-builder.ts). Emits `## Active goals` heading + `- {name}: target {X}, current {Y}, by {date} (need {Z}/mo) ✓/✗ on track` per goal. **When `goals` and `actions` are both empty/null, returns empty string** (line 1210). The whole section disappears from the prompt — the CFO has no signal that no-goal is a state.
- **Assembly slot:** 11 of 18 in `buildSystemPrompt`'s main sections array ([line 678-697](../cfos-office/src/lib/ai/context-builder.ts)), after balance sheet, before trips.
- **Other paths bypass `buildGoalsContext`:**
  - `onboarding_goal_chat` mode (line 644-655) uses `buildGoalDeriveConfirmContext(profile, goals)` instead — designed for users in the act of setting a goal, so the no-goal marker isn't useful here.
  - `first_insight` / `post_upload` mode (line 666-676) uses `buildFirstInsightContext(payload)` — the payload is the sole source of truth, all other context is suppressed.
- **Goal-derive-confirm + first-insight are not changed by Session 12.**

## Session 11's centralised signal (Phase 3 reuse target)

[`cfos-office/src/lib/goals/primary-goal.ts`](../cfos-office/src/lib/goals/primary-goal.ts) — exported `getPrimaryGoal(supabase, userId): Promise<PrimaryGoal | null>`.

- **Filter:** `status='active' AND deleted_at IS NULL`. Sorted by `priority` (high<medium<low<null) then `created_at DESC`. First or null.
- **Pre-declared reuse:** the function's docstring at lines 38-39 says verbatim: *"Session 12 imports this same function for CFO prompt context — keep the implementation centralised so the 'does this user have a goal' signal does not drift between surfaces."*
- **Today's usage:** only `cfos-office/src/app/(office)/office/page.tsx` (the home page). Not used by the chat path. Session 12 adds that.

## Harness env-loader bug (deferred)

- **Symptom:** `npm run test:prompts` fails with `region: undefined` Bedrock error unless env vars are pre-sourced.
- **Cause:** ESM hoists `import { chatModel } from '../src/lib/ai/provider'` at [test-prompts.ts:35](../cfos-office/scripts/test-prompts.ts) above the manual `.env.local` reader at lines 18-32. `provider.ts:3-7` calls `createAmazonBedrock(...)` at module load with stale `process.env`.
- **Workaround (used this session):** `cd cfos-office && set -a && source .env.local && set +a && npm run test:prompts`.
- **Status:** **deferred** per Phase 5 decision. Workaround documented in BACKLOG.md; the candidate fixes (npm-script `--env-file`, lazy Bedrock construction, dotenv-cli) carry into a follow-up.

## Out-of-scope (documented so it doesn't drift)

- Onboarding wow moment (post-archetype insight) — established pattern, untouched.
- Multi-goal listing display — hybrid approach in Phase 3 preserves it. Consolidating to primary-only is a future cleanup.
- UI — Session 11 did home, Session 14 does folder reframes.
- Schema / migrations / production DB.
- Individual PR — work stays on `feature/goal-aware-office`.
