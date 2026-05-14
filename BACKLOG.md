# Backlog

Items deferred out of completed sessions for future work. Not a roadmap (that lives in `CLAUDE.md`); this captures things that were verified or scoped but intentionally not shipped.

---

## Constitution v1.2 candidates (Session 06 findings)

Surfaced during the BASE_PERSONA rewrite. Do NOT update `CFO-CONSTITUTION.md` v1.1 in this session — Constitution updates are their own session.

### [v1.2] Reveal/reading length convention is unwritten

§8 specifies status (1–3 sentences) and gap analysis (4–6 sentences) but doesn't cap Value Map reveals (~150–220 words) or personality readings (~120–180 words). The new BASE_PERSONA points to "the call site" but §8 itself should name this category and its length range. Otherwise every new long-form output has to re-invent its own cap.

**Proposed:** add a §8 sub-bullet for "Reveal / reading outputs: 120–220 words, single dense paragraph (reading) or three short paragraphs (reveal). Same voice rules apply."

### [v1.2] Few-shot example outputs must be re-derived when prompts change

`demo/reading/route.ts` had 4 in-prompt `<example_reading>` blocks that taught the model a voice the Constitution forbids. The examples did more work than the instructions. Constitution v1.1 doesn't currently require example outputs to be re-derived alongside any voice change.

**Proposed:** add to §10 (maintenance) — "When a prompt contains few-shot example outputs, they must be re-derived in the same edit. Stale examples override fresh instructions."

### [v1.2] CFO-as-self-referent — when "your CFO" is required

§2 forbids first person and says self-reference is "your CFO" when omitting it would create ambiguity. In practice, dropping all self-reference is the default — but the prompt didn't make that explicit, and a model trained on the prior persona kept reaching for "I". A clarifying example pair would help.

**Proposed:** §2 — add: "Default to no self-reference. 'Your CFO' is the explicit form only when otherwise ambiguous (e.g. 'Your CFO keeps watching as more data comes in')."

### [v1.2] Routine save confirmations — sign-off ambiguity

§8 says sign-off applies to "meaningful findings". When a write tool returns a confirmation card and the CFO reacts in one short sentence ("Saved."), should the message be signed off? The current rule says no (routine reply) but the model may infer otherwise. Examples in §9 don't cover this case directly.

**Proposed:** §8 — add: "Tool-confirmation reactions (one-sentence acknowledgement of a save) do not get a sign-off. The confirmation card is the receipt."

### [v1.2] Tangible-comparison invocation gate is unwritten

§2 says comparisons must come from "things in the user's actual life" but doesn't formalise the precondition. The prompt-side rule (audit/06-summary.md gap #3) ended up enforcing two conditions: reference is in user data AND it helps the user feel the number. Worth lifting into §2 verbatim.

**Proposed:** §2 — codify the existing prompt rule into the Constitution proper.

---

## §9 acceptance harness — persistent failures (Session 06, 2026-05-14)

**Status: resolved in code, Constitution candidates remain.**

First run: 3/8 PASS (9B, 9D, 9F). Second run after surgical patches: **8/8 PASS** (commits [`cc44c7c`](../../commit/cc44c7c) harness + [`9087fdf`](../../commit/9087fdf) persona). The five entries below stay open as Constitution v1.2 candidates — the persona patches make the *current* persona produce the right answers, but the *Constitution* still under-specifies these rules and a future rewrite would have to re-derive them. The maintenance work (lifting the persona rules up into Constitution v1.2) is for a separate session.

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
