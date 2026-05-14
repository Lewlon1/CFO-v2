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
