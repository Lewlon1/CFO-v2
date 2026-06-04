# Backlog

Items deferred out of completed sessions for future work. Not a roadmap (that lives in `CLAUDE.md`); this captures things that were verified or scoped but intentionally not shipped.

---

## Coaching Cadence (2026-06-02) — deferrals

- **Legacy first-insight de-stack.** The `InsightPayload` first-insight path (`context-builder.ts` ~292/552/623) mandates a REQUIRED experiment closing beat stacked with headline→gap→`[STATS]`→hidden-pattern→hook→`[OPTIONS]`→experiment — a lot of concepts in one message. It's gated behind `!isLayeredReadEnabled()`, so it's NOT on the live value-first flow (which composes via `compose-first-read.ts`). Apply the guiding cadence (one concept at a time, no forced beat) there only if that legacy path is revived; otherwise it ages out when the layered-read kill-switch is removed.
- **Automated coaching behavioural-eval cases.** The guiding principle is verified by prompt-content unit tests (changes locked) + a human-review checklist (behavioural sign-off). Genuine behavioural eval cases — one-topic-per-turn, tie-to-goal, mechanism-matches-claim, no-forced-menu — belong in the `scripts/test-prompts.ts` §9 harness, but they assert on live model output and can't be calibrated without Bedrock creds. Author + calibrate them in a creds-enabled session.
- **"Coaching" vs "guiding" terminology (Constitution §1).** The behaviour shipped under "How the CFO guides" because §1 lists "not a coach" (cheerleader sense). If the product wants "coaching" as the official term, amend §1's "not a coach" → "not a cheerleader/life-coach" and rename the §6 subsection + BASE_PERSONA section to match. Cosmetic, but it's identity-level wording — a deliberate call, not a silent rename.

---

## Value-Flow Dedup + Post-Read Reveal Voice (2026-06-02) — deferrals

Surfaced by the dedup Phase 0 audit; out of scope for a selector/prompt-layer session.

- **The learning engine persists ZERO `value_category_rules` (the bug under the dedup bug).** Every retake/check-in user on staging has `value_category_rules` total = 0 — lew6 (25 signals / 16 merchants), lew5, lew7, lew4, marcus@test10, lewfinal1, all 0 — across April→June. `processSignals` → `computeFlatRule` should mint a flat merchant rule from even a single 2× signal (agreement 1.0 ≥ the 0.55 floor), so the absence is a real failure, not a threshold effect. Downstream, `backfillForMerchant` (which only lifts a sibling when `prediction.confidence > txn.value_confidence`, sourced from a rule) is therefore inert — siblings never settle, the whole prediction/archetype path runs on raw `correction_signals` only. **The dedup fix this session is robust to this** (it keys off `value_confirmed_by_user`, not rules), which is why it was shippable without fixing this — but the learning engine is silently non-functional for these users and deserves its own session. Likely suspects: the `after()` learning callback on `/api/value-map/personal` not flushing in the serverless runtime; a silent failure in the `value_category_rules` upsert (`onConflict: VCR_ON_CONFLICT`); or the service-client write. Localise with: pick a user with `correction_signals` but 0 rules, run `processSignals` directly, watch whether the upsert lands.
- **Double-weight signal pollution — historical, immaterial, not cleaned.** Only lew6 (a stale 2026-04-14 test user) has merchants re-rated >1× at elevated weight: `aldi` ×3 (burden AND foundation — conflicting), two more ×3, three ×2. Six merchants. The selector fix stops new accrual at source, so no production cleanup is mandated; an optional dedup query sits in `prod-backfill-071-value-flow-dedup.sql` (section C), marked DO NOT APPLY. Revisit only if (A2) of that file shows real production pollution biasing archetype regeneration.
- **Continuity not re-applied to `value_map_complete` / `monthly_review`.** The `default` ongoing-chat branch + `chip_opener` got the "don't restate the Read; extend it" rule. `monthly_review` restates the month's numbers by design (that IS the review), and `value_map_complete` is the legacy Gap-reveal surface (under value-first the reveal is the recompose) whose single-question structure the v1.4 session deliberately kept — both left as-is. If either is observed re-delivering the onboarding Read verbatim, extend the continuity rule there too.

---

## CFO Directness + Constitution v1.4 (2026-06-02) — deferrals

Out of scope for the prompt-layer + docs directness session; logged for follow-up.

- **`persona-sanitiser.ts` undoes the §2 v1.4 first-person relaxation on the chat path.** The runtime guard (`src/lib/ai/persona-sanitiser.ts`, called from `app/api/chat/route.ts`) regex-detects first-person (`\bI\b`, `me`, `my`, `I'd`, `I'll`, `I'm`, `let me`) and rewrites it out via Haiku before persisting. Constitution v1.4 now ALLOWS stance-bearing first person ("I'd push back on that") and bans only narration + the service-desk register — so the sanitiser is now *stricter than the constitution* and will strip legitimate stance-first-person from production chat. **Fix:** soften `LEAK_PATTERNS` + `REWRITE_PROMPT` to match v1.4 (keep stripping narration "I noticed"/"I can see", service-desk "let me"/"I can help", and "advice"/"advise"; STOP stripping bare stance-bearing "I"/"I'd"), and **re-derive `persona-sanitiser.test.ts` in the same edit** (it currently asserts `"I'd note that…"` gets rewritten). Not on the First Read path (`first-read.ts` is already first-person-free), so the headline change is unaffected. Deferred because it's runtime code outside this session's manifest ("prompt-layer + docs only / do not open a rewrite front").
- **Feed the confirmed fixed-cost / recurring set into the First Read lever context.** `compose-first-read.ts` computes `total_fixed_costs` (+ `reconcileFixedCosts` fallback), but the `Lever` set passed to `first-read.ts` has no dedicated "recurring bills" lever — only `cut | shift | reallocate | supply_input`. So the v1.4 First Read names "recurring bills" generically as a headline (acceptable per the session's lever-as-headline rule). Wire the confirmed fixed-cost set into the lever package so the recurring-bills lever can cite a real number.
- **`read-judge.ts` word ceiling (250) now looser than the prompt target (120–220).** The first-read prompt targets 120–220 words (relocated from Constitution §8); `READ_WORD_CAP = 250` remains the hard fail-ceiling. 120–220 ⊂ ≤250 so nothing breaks and no test fails, but the judge no longer polices the reveal target. Tighten `READ_WORD_CAP` to 220 if the judge should enforce the target rather than just act as a backstop.

---

## Audit Zero (v2.6, 2026-05-29) — NEEDS-LEWIS follow-ups

Verified in Audit Zero but intentionally not actioned this session (protected files / deeper work). Full evidence + three-search: `audit/audit-zero-killlist.md`.

- **Dead `value-map-flow.tsx` transaction-insert path** (~L352–390) — writes to non-existent `bank_accounts`, reads dead `merchant_category_map`; superseded by `/api/upload`. Protected file → dedicated follow-up. Removing it unblocks dropping `merchant_category_map`.
- **`agents` phantom** — `value-map/reveal/route.ts:16` queries a non-existent table (tolerated via `?? 'unknown'`); retire the dead `getAgentId` scaffold.
- **`user_hypotheses`** — staging-only scaffold (0 refs / 0 rows); drop or wire the feature.
- **`benchmarks` vs `benchmark_reference`** — possible redundancy; confirm which is canonical.
- **`@types/pdf-parse`** — knip-unused devDep; verify `tsc` without it before removing.
- **`proxy.ts` `protectedPaths`** — legacy route names, omits `/office` (vestigial; office gated by the `(office)` layout).
- **Layered-read legacy path** — `!isLayeredReadEnabled()` branches + `computeFirstInsight`; retained kill-switch rollback, remove once proven in prod.
- **~10–15 genuinely-uncalled exports** (`predictValueCategory`, `estimateCostUSD`, `templatesForPattern`, `findAction`, …) — un-export or remove.
- **Migration registry/file drift** — 86 applied vs 069 numbered files; staging ahead of prod.
- **Prod row cleanup** (Lewis runs the guarded SQL): drop `savings_tips` (18) + `third_party_data_flows` (3); delete test users `lewis@test.com` + `gsbs@test.com`. See `cfos-office/supabase/migrations/prod-backfill-070_audit_zero_cleanup.sql`.

---

## Constitution v1.2 candidates (Session 06 findings) — RESOLVED

**Status: all five lifted into Constitution v1.2 in the same session as the BASE_PERSONA rewrite,** at Lewis's direction. (The original Session 06 rule "Constitution updates are their own session" was waived once the harness re-run at 8/8 made the persona-level rules concrete enough to formalise.)

Original candidates retained below for traceability.

### [v1.2 — LANDED] Reveal/reading length convention is unwritten

§8 specifies status (1–3 sentences) and gap analysis (4–6 sentences) but doesn't cap Value Map reveals (~150–220 words) or personality readings (~120–180 words). The new BASE_PERSONA points to "the call site" but §8 itself should name this category and its length range. Otherwise every new long-form output has to re-invent its own cap.

**Proposed:** add a §8 sub-bullet for "Reveal / reading outputs: 120–220 words, single dense paragraph (reading) or three short paragraphs (reveal). Same voice rules apply."

**Landed:** Constitution v1.2 §8 Length now includes the reveal/reading length cap.

### [v1.2 — LANDED] Few-shot example outputs must be re-derived when prompts change

`demo/reading/route.ts` had 4 in-prompt `<example_reading>` blocks that taught the model a voice the Constitution forbids. The examples did more work than the instructions. Constitution v1.1 doesn't currently require example outputs to be re-derived alongside any voice change.

**Proposed:** add to §10 (maintenance) — "When a prompt contains few-shot example outputs, they must be re-derived in the same edit. Stale examples override fresh instructions."

**Landed:** Constitution v1.2 §10 has the "Few-shot example outputs travel with the rules" paragraph.

### [v1.2 — LANDED] CFO-as-self-referent — when "your CFO" is required

§2 forbids first person and says self-reference is "your CFO" when omitting it would create ambiguity. In practice, dropping all self-reference is the default — but the prompt didn't make that explicit, and a model trained on the prior persona kept reaching for "I". A clarifying example pair would help.

**Proposed:** §2 — add: "Default to no self-reference. 'Your CFO' is the explicit form only when otherwise ambiguous (e.g. 'Your CFO keeps watching as more data comes in')."

**Landed:** Constitution v1.2 §2 now has an explicit "Default to no self-reference" paragraph.

### [v1.2 — LANDED] Routine save confirmations — sign-off ambiguity

§8 says sign-off applies to "meaningful findings". When a write tool returns a confirmation card and the CFO reacts in one short sentence ("Saved."), should the message be signed off? The current rule says no (routine reply) but the model may infer otherwise. Examples in §9 don't cover this case directly.

**Proposed:** §8 — add: "Tool-confirmation reactions (one-sentence acknowledgement of a save) do not get a sign-off. The confirmation card is the receipt."

**Landed:** Constitution v1.2 §8 Sign-off now has three explicit clarifications (tool confirmations no, substantiation yes, routine declines no).

### [v1.2 — ALREADY-IN-v1.1] Tangible-comparison invocation gate is unwritten

§2 says comparisons must come from "things in the user's actual life" but doesn't formalise the precondition. The prompt-side rule (audit/06-summary.md gap #3) ended up enforcing two conditions: reference is in user data AND it helps the user feel the number. Worth lifting into §2 verbatim.

**Proposed:** §2 — codify the existing prompt rule into the Constitution proper.

**Resolution:** the two conditions are already codified in v1.1 §2 (the "Tangible comparison" sub-section, "Use the comparison only when: 1... 2..."). This BACKLOG entry was stale — no v1.2 edit needed.

---

## §9 acceptance harness — persistent failures (Session 06, 2026-05-14) — RESOLVED

**Status: resolved in code AND in Constitution v1.2.**

First run: 3/8 PASS (9B, 9D, 9F). Second run after surgical patches: **8/8 PASS** (commits [`cc44c7c`](../../commit/cc44c7c) harness + [`9087fdf`](../../commit/9087fdf) persona). The persona-level rules behind the four behavioural failures (9A goal status, 9C accountability, 9E The Gap, 9G windfall) have been lifted into Constitution v1.2 — see §3 Allocation questions, §5 The Gap response shape, §6 bad-month accountability sub-section, §8 status-check-on-goal four-slot anchor. The 9H sign-off-survives-substantiation rule is codified in §8 Sign-off.

Original run details retained below for traceability.

Verbatim from the harness at `eu.anthropic.claude-sonnet-4-6` with `providerOptions.bedrock.cachePoint = default`, temperature 0.4, maxOutputTokens 600.

### [v1.2 / persona] 9A — Goal progress check elides goal name and progress%

**Missed checks:** cites current amount 1240, cites or implies 41%, uses goal name "Japan".
**Truncated output:** `On track. You need €440/month and last month's surplus was €460 — €20 ahead of pace. At this rate, you hit €3,000 by September 2026 with a small buffer. — C.`
**Read:** the CFO is *too terse*. It cites the monthly need, the surplus, the target, and the deadline — but skips the current balance, the % complete, and the goal's name. The §2 brevity instruction is over-pulling against §5 "honour the user's exact terms" (the user said "Japan goal" — the CFO answered without echoing it back) and against an unwritten rule that status updates should anchor the user in *where they are now*, not just trajectory.
**Proposed:** §8 status-reply rule — "Status replies must cite (a) the goal name, (b) current state, (c) progress toward target, in addition to trajectory." OR BASE_PERSONA add one sentence to the status-format protocol naming these four slots.

### [v1.2 / persona] 9C — Bad-month reply skips the pattern-vs-one-off question

**Missed checks:** asks pattern vs one-off, no moralising, no first-person.
**Truncated output:** `Dining ran €540 this month — double your three-month average of €270. Two weekend trips on top of that. Those are the two places the overspend lives. The practical effect: your Japan surplus this month was €160 against the €440 you need. T…`
**Read:** the CFO diagnosed the overspend (good) but didn't ask the §7 accountability question ("is this a pattern or a one-off?"). Also picked up "no first-person" and "no moralising" failures — there's an "I" or "my" leaking somewhere past the 240-char truncation, and "the overspend lives" / similar phrasing may register as moralising under the regex `/disappointing|let yourself down|terrible/i` (need full output to confirm).
**Proposed:** §7 accountability rule — "When the user reports a bad period, the CFO names the diagnosis AND asks whether it's a pattern or a one-off before suggesting a path." BASE_PERSONA already implies this but the §9 example (9C in Constitution) doesn't show the question explicitly.

### [v1.2 / persona] 9E — The Gap moment doesn't invoke the Value Map quadrant or pose two hypotheses

**Missed checks:** quotes Value Map quadrant "Leak", poses two possibilities, asks user to choose, no first-person.
**Truncated output:** `Three patterns show up most often when dining runs high despite the intention to cut it. **Frequency, not size.** The bill per outing looks reasonable, so each one passes the mental check — but the count accumulates. Worth pulling how many…`
**Read:** the CFO answered with three generic patterns instead of two user-specific hypotheses grounded in the Value Map context block (which named dining as a self-classified Leak with 5/5 confidence). This is the most-critical failure of the batch — The Gap is the headline product feature and the §9 reference exchange tests exactly this. The persona is reaching for "three patterns generally" instead of "two possibilities given what you told me". Possibly a layer-drift symptom: the Value Map context block isn't being weighted heavily enough, or the persona is defaulting to observation mode instead of confrontation mode.
**Proposed:** investigate whether the Value Map context block in `context-builder.ts` is reaching the model with sufficient emphasis. May need BASE_PERSONA edit to add explicit "when the Value Map disagrees with actuals, name the quadrant, pose two user-specific theories, and ask which one fits."

### [v1.2 / persona] 9G — Windfall reply doesn't offer to model the trade-off

**Missed checks:** offers to model.
**Truncated output:** `Three things competing for that £3,000: **Credit card: £420.** Clear it first. It's the highest-cost money on the balance sheet — whatever rate it's charging, the return on paying it off is guaranteed. **Emergency buffer: £600 short of yo…`
**Read:** the CFO surfaced the three competing demands well — the only thing missing is an offer to run a scenario (`/(modell|model out|scenario|run the numbers)/i`). This is borderline — the answer is structurally correct and could pass on temperature variance, but a Windfall is exactly the place where §6 "model the trade-off" should fire reliably.
**Proposed:** §6 — add: "When the user asks how to allocate a windfall, the CFO names the candidates AND offers to model the trade-off explicitly (e.g., 'want the numbers run on X vs Y?')."

### [v1.2 / persona] 9H — Pushback reply doesn't sign off (likely token-cutoff)

**Missed checks:** signs off — C.
**Truncated output:** `Dining transactions tagged this month total €420 across 14 visits. Here is the full list: 1. Pintxos Bar — €38, 2 May 2. Sukiyaki — €52, 3 May 3. Bocadillo Run — €11, 4 May 4. La Trattoria — €46, 6 May 5. Sushi Bento — €28, 8 May 6. Cafe d…`
**Read:** the CFO listed all 14 transactions in response to a pushback challenge. The `maxOutputTokens: 600` cap is likely truncating the response before the sign-off lands. The persona is doing the right thing (substantiate the claim with the data) but the harness's output cap is shorter than the response needs.
**Proposed:** two-part fix:
1. **Harness:** raise `maxOutputTokens` from 600 to 1000 in `scripts/test-prompts.ts:278` — substantiation responses for §9 cases legitimately need more headroom.
2. **Persona:** consider a §2 rule: "If forced to choose between full substantiation and the sign-off, finish with the sign-off — substantiation can be summarised." Probably better to fix the harness cap; the persona behaviour is correct.

---

## Tier 2 cleanup deferrals — Session 05 (2026-05-13)

### `merchant_category_map` table — needs read-site refactor before drop

The Tier 2 candidate list flagged `merchant_category_map` for deletion, but `cfos-office/src/components/value-map/value-map-flow.tsx:357` reads from it during first-categorisation at signup. Dropping it without a refactor regresses new-user onboarding.

**Work to do:** migrate the lookup to `user_merchant_rules` (or another live table), then drop. Likely a half-session because the read happens on the unauthenticated public flow and the source data needs a home.

> **Audit Zero correction (2026-05-29):** the stated blocker is out of date. The read (now `value-map-flow.tsx:381`) sits inside a **dead transaction-insert path** that also writes to the non-existent `bank_accounts` table (`newAccount!.id` would throw if reached) and is superseded by the `/api/upload` pipeline — it does **not** run on the live signup flow. `merchant_category_map` is 0-rows in both envs, has **no writer**, and **zero FK deps**. Real blocker = removing that dead path (protected file `components/value-map/**`) + Lewis sign-off, not an onboarding-regression risk.

### Tier 1 leftover — `ValuePill.tsx`

Session 03's Tier 1 list named three v2.4 primitives for deletion (`MetricTile.tsx`, `ValuePill.tsx`, `FolderCard.tsx`); only two were deleted. `cfos-office/src/components/data/ValuePill.tsx` survived because it was still imported by `DataComponents.tsx` at the time.

**Work to do:** re-grep, confirm it is now orphan, delete (and prune any remaining barrel re-export).

### Production migration application — 042 + 043

- `042_drop_dead_tables.sql` — applied to staging in Session 03, **not** applied to production. Lewis-only. Run advisors immediately after.
- `043_backfill_schema_migrations.sql` — metadata-only backfill of versions 038–041 in the production tracker. Applied to staging in Session 05 (no-op there). Apply to production manually after merge.

### Tier 3 — out of cleanup scope, real code work

- `llm_usage_log` instrumentation — schema design + write sites are real code, not cleanup.
- Export-style standardisation across `src/lib/**` — codemod scope; do as its own pass.

---

## Goal-derive-and-confirm fold-in to the Constitution — PROPOSED (deferred past v1.3)

Session 09 introduced goal derive-and-confirm as new CFO behaviour at the start of every onboarding journey. The behaviour currently lives as an onboarding-context prompt-layer fragment ([`buildGoalDeriveConfirmContext()` in `cfos-office/src/lib/ai/context-builder.ts`](cfos-office/src/lib/ai/context-builder.ts)) and a dedicated assembly branch for `conversationType='onboarding_goal_chat'`. It belongs in the Constitution proper, not just a layered fragment. Session 12 landed v1.3 (goal-awareness steady-state + no-goal protocol) but deliberately did **not** fold derive-and-confirm in — that was out of Session 12's scope. Carries forward to the next Constitution bump.

**Proposed for Session 12 (Constitution v1.3):**
- §3 should describe the CFO deriving a goal from minimal signals (entry struggle + free-text) and confirming with the user as a canonical first-meeting move — observe → calculate → educate → and now, at first contact, **derive**.
- §9 should add a canonical exchange showing the three derive paths: sufficient-signal direct draft, insufficient-signal one clarifying question, and user correction (re-draft to user's exact terms per the §5 "honour the user's exact terms" rule).
- Once landed, the prompt-layer text in `context-builder.ts` becomes a thin reference to the relevant §3/§9 sections rather than self-contained instructions.

**Out of Session 09 scope** because §10 says the Constitution is updated when behaviour shifts at the principle level — Session 12 is the natural point to make that shift, alongside the goal-aware reading work it owns.

---

## `create_goal` confirmation card — DEFERRED

Every other write tool ([`create_action_item`, `update_user_profile`, `upsert_asset`, `upsert_liability`, `update_value_category`, `record_value_classifications`](cfos-office/src/components/chat/MessageList.tsx)) renders a `SavedItemCard` confirmation in the chat UI on success. `create_goal` does not — the user only sees the model's natural-language echo. Session 09 noted this gap during planning but kept scope tight; the natural place to add it is alongside the Session 10 progress-engine UI work, where the goal card can also surface progress against target.

**Proposed:** add a `goal_create` builder to [`savedCardBuilders.ts`](cfos-office/src/components/chat/savedCardBuilders.ts) that renders the goal name, target amount, target date, and starting amount. Wire it into the switch in [`MessageList.tsx`](cfos-office/src/components/chat/MessageList.tsx) at the same place the other write-tool cards are dispatched.

---

## Goal contribution affordance — surface in Session 11's home goals section — PROPOSED

Session 10 added a "log contribution" affordance to [`GoalCard.tsx`](cfos-office/src/app/(office)/office/scenarios/goals/GoalCard.tsx) on the scenarios/goals page. Session 11 (home goals surface) is already drafted and will surface goal progress in the office home view. The contribution affordance built in Session 10 is the natural action for the home goal card / folder detail to expose — the user shouldn't have to navigate to the scenarios page to log a deposit.

**Proposed for Session 11:** integrate the existing inline log-contribution form (or extract it into a reusable component first) on whatever goal-display surface Session 11 introduces. The write path through [`POST /api/goals/contributions`](cfos-office/src/app/api/goals/contributions/route.ts) is already shared — no backend work needed, just the UI hook-up.

---

## Transaction-to-goal matching — DEFERRED INVESTIGATION

Session 10 deliberately stopped at manual contributions. Auto-detecting savings-deposit transactions as goal contributions was scoped out — building it requires a `savings_transfer` categorisation on `transactions` (which does not currently exist as a transaction-level tag), an opt-in heuristic for matching transfers to specific goals, and a UX for users to confirm/correct matches before they post to the contribution ledger.

This is its own multi-week project, not a bolt-on. It depends on Session 10's `goal_contributions` table being live (which it now is) — auto-detected matches would write to the same ledger as manual logs, just with a different `kind` value (e.g. `kind='auto_match'`).

**Out of any current session's scope.** Surfaces if/when the manual-contribution path proves too high-friction for users and we have data showing the categorisation work would be worth it. Until then, manual is the mechanism.

---

## Projection-based action-item ranking — DEFERRED (Session 13)

Session 13 added a heuristic three-tier ranking to `get_action_items`:
1. `goal_id` matches the user's primary goal,
2. `goal_id` null AND category is goal-adjacent (`goal_setting` / `savings_transfer`),
3. everything else.

Within each tier: priority then `created_at DESC`. The `priority` column is now actually used in ranking (previously stored but never read).

A €-impact projection — modelling how much each action contributes toward the goal, ranking by that figure — needs Session 10's progress engine to be live and meaningful. Until `current_amount` is being kept fresh from real transaction data, any projection runs against a near-zero baseline (86% of production goals have `current_amount = 0`).

When that lands: a follow-up session can replace tier 0/1 ordering with a modelled score. The dead `potential_savings` column on `action_items` (currently zero rows populated across prod) is the natural place to store the projected figure — preserving the heuristic as a fallback for items the projector hasn't scored yet.

**Out of any current session's scope** until the progress engine produces a non-trivial `current_amount` distribution. The heuristic is doing real work: production action items are 80% `goal_setting`/`savings_transfer`, so tier 1 is meaningful even before tier 0 is well-populated.

---

## §9 harness env-loader (`test:prompts`) — DEFERRED (Session 12)

[`cfos-office/scripts/test-prompts.ts`](cfos-office/scripts/test-prompts.ts) cannot be invoked via `npm run test:prompts` alone — Bedrock instantiates with `region: undefined` and the run fails immediately. The §9 harness is the persona regression net (now 9 cases as of Session 12), so this friction is load-bearing.

**Symptom:** `npm run test:prompts` errors out on first model call unless env vars are pre-sourced.

**Cause:** ESM hoists `import { chatModel } from '../src/lib/ai/provider'` at [test-prompts.ts:35](cfos-office/scripts/test-prompts.ts) above the manual `.env.local` reader at lines 18–32. [`provider.ts:3-7`](cfos-office/src/lib/ai/provider.ts) calls `createAmazonBedrock({ region: process.env.AWS_REGION!, ... })` at module load time, with stale (undefined) env.

**Workaround (current):**

```bash
cd cfos-office && set -a && source .env.local && set +a && npm run test:prompts
```

**Candidate fixes (in increasing order of robustness and blast radius):**
1. **npm-script `--env-file`** — change `test:prompts` to `node --env-file=.env.local --import tsx/esm scripts/test-prompts.ts` (Node 20.6+). One file touched; no API changes. Smallest defensible move.
2. **`dotenv-cli`** — add as devDep; script becomes `dotenv -e .env.local -- tsx scripts/test-prompts.ts`. Adds a dependency.
3. **Lazy Bedrock client construction in `provider.ts`** — defer `createAmazonBedrock(...)` until first model call. Removes the load-order dependency for any future caller of `chatModel`/`utilityModel`/`opusModel`. Most robust, but touches every consumer of those exports (or stays API-stable via a Proxy, which trades clarity for compatibility).

Session 12 chose to defer the fix to keep scope tight. Pick this up in any session that touches `provider.ts` or before the harness moves to CI. Lazy construction is the long-term right answer; the npm-script `--env-file` is the small fast move if the harness moves to CI urgently.



---

## Goal tag on goal-serving folder items — DEFERRED (Session 14)

The original mockup put a small gold tag on files within folders that "serve the goal" (e.g. a goal-funding view in Cash Flow, the goal-relevant what-if in Scenarios). Session 14 scoped the tag as exploratory: ship if the static mapping is obvious, defer if not.

**The static mapping is not obvious.**

Surveying current sub-pages by folder:

- **Cash Flow** — `bills`, `monthly-overview`, `optimise`, `patterns`, `spending-breakdown`, `transactions`, `trends`, `upload`. None are explicitly a "goal funding" view. `optimise` is the closest interpretive match (optimising spending frees surplus that feeds the goal), but it's not a goal view per se.
- **Net Worth** — `assets`, `balance-sheet`, `liabilities`, `upload`. Pure balance-sheet building blocks. No goal-tagged view exists.
- **Scenarios** — `goals`, `trips`, `what-if`. The `goals` page IS the goal (and is already shortcut from the home Goals folder card). `what-if` could model goal-relevant scenarios but only contextually — not a static "this is the goal what-if" view.
- **Values** — `archetype`, `export`, `portrait`, `the-gap`, `value-split`. `the-gap` is the closest interpretive match (alignment between values and reality bears on goal discipline), but it's not goal-tagged.

Determining "which file serves the goal" properly needs either (a) creating new dedicated goal-funding/goal-relevant views inside each folder — a non-trivial UX expansion — or (b) dynamic computation of goal-relevance per existing view per user. Both are Session 15 (data-deep) territory.

The summary lines (Phase 2 of Session 14, shipped) carry the goal-aware framing on their own at the home level. The goal tag is a future enhancement, not a Session 14 omission to backfill.

**The `<GoalTag />` component itself was not built.** Design intent if/when revived: small gold pill using `folderColors.goals` (see `cfos-office/src/lib/tokens.ts`) — same accent the Goals folder card uses, so the tag visually echoes the card. Apply it to whatever items the dynamic goal-relevance scoring (Session 15) surfaces.

---

## v2.5 component-reuse audit deferrals

Items catalogued in `cfos-office/audit/v2.5-component-reuse.md` that were classified BACKLOG rather than fixed in v2.5. Each links back to a specific audit finding.

### Foundation / Investment colour inversion (audit Q3, finding 8)

`src/lib/tokens.ts` says foundation=`#22C55E` (green), investment=`#3B82F6` (blue). `src/lib/value-map/constants.ts` says the opposite: foundation=`#4A90D9` (blue), investment=`#48BB78` (green). Same applies to Leak (`#F43F5E` vs `#E53E3E`) — close but not identical. Pick a source of truth and migrate the other. UX-bearing decision: which colour represents which category in the Value Map quadrant grid? Pulls in product framing, not just refactor.

### FolderCard dead code (audit Q1, finding 9)

`cfos-office/src/components/data/FolderCard.tsx` has zero consumers as of v2.5 — only re-exported from `src/components/data/index.ts`. Delete the file and remove the export. Confirmed by `grep -rn "FolderCard" src/ --include="*.tsx"` returning only the definition and the index re-export.

### formatCurrencyRounded vs formatCurrency consolidation (audit Q2, finding 10)

`src/lib/utils/format-currency-rounded.ts:formatCurrencyRounded` and `src/lib/format/currency.ts:formatCurrency` (extracted in v2.5 Phase 5) do similar work with slight signature differences. Reasonable to consolidate into a single `formatCurrency(amount, currency, { rounded?: boolean })` once the dashboards migrate. Low priority — both helpers work and are honest about their behaviour.

### GoalCard purple Tailwind tokenisation (audit Q3, finding 11)

`src/app/(office)/office/goals/GoalCard.tsx` lines 105, 154, 169 use `bg-purple-500` / `text-purple-400` for goal-status highlights. Not Burden-semantic — these are CTA highlight colours. Add a "highlight purple" token to `tokens.ts` and migrate so future palette shifts don't pass these by.

### Hardcoded folder hexes in non-dashboard files (audit Q3, finding 12)

The v2.5 audit catalogued ~25 sites outside the four office dashboards that hardcode `#22C55E`, `#06B6D4`, `#3B82F6`, `#F43F5E`. Files include `src/components/dashboard/DataComponents.tsx`, `src/components/office/OfficeMonthlyOverview.tsx`, `src/app/api/balance-sheet/route.ts`, onboarding archetype reveal, value-map flow components. Migrate to `folderColors.*` and value-category tokens. Out of scope for v2.5 since none of those files were touched by Phases 1–4.

### formatMonth triple-implementation (audit Q2, finding 13)

`formatMonth` exists in `src/lib/constants/dashboard.ts:60`, `src/lib/utils/format-currency-rounded.ts:26` (`formatMonthShort`), `src/components/dashboard/ReviewBanner.tsx:13` (`formatMonthName`), and `src/lib/ai/review-context.ts:57` (`formatMonth`). Three different implementations of "render a month from a date". Consolidate after the dashboards are settled.

### PatternsClient maxFractionDigits-only signature (v2.5 Phase 5 carve-out)

The `src/lib/format/currency.ts` helper extracted in Phase 5 supports `{ decimals }` (fixed min+max). `src/app/(office)/office/cash-flow/patterns/PatternsClient.tsx` previously used `maxFractionDigits: 2` without a min — €45 stayed "€45", not "€45.00". Migration would force a visual shift to "€45.00" everywhere. If we extend the helper with `{ minDecimals, maxDecimals }`, PatternsClient becomes a one-line migration; until then it keeps its local helper.

---

## CSV ingest writes `accounts.current_balance` from closing balance — DEFERRED (Session B)

Session B's posture/runway detection depends on `accounts.current_balance` for liquid balance, but ingest currently does not write that field from the CSV closing balance. Test personas (Maya, Carlos) require manual UPDATE in staging to set `current_balance` to the CSV closing value before posture lands correctly.

**Follow-up:** during upload, write `accounts.current_balance` from the parsed CSV's closing balance (where the parser exposes it — Revolut and Santander both do). Replaces manual entry for new ingests. Stale-balance handling and confidence damping are already in `posture.ts`; this work just feeds the input.

---

## Reconcile `incomeDetected` pattern detector with persisted `income_shape` — DEFERRED (Sessions A + B)

`src/lib/analytics/pattern-detectors.ts` still ships an `incomeDetected` pattern detector that derives income signals at request time. Session A added persisted `income_shape` (writeable source of truth) and Session B layered posture on it. The two paths can disagree without breaking anything (`incomeDetected` still serves first-insight narration; the persisted field serves anything context-builder-driven), but the duplication is a latent foot-gun.

**Follow-up:** Session C cleanup. Decide whether `incomeDetected` should be (a) deleted in favour of reading the persisted field, (b) repurposed as a narration-only helper, or (c) kept as a fallback for users who haven't run an ingest. Whichever, codify the boundary.
