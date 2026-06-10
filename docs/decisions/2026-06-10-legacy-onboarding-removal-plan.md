# Removal plan — legacy onboarding processes (pre-layered path + V1 narration)
> Drafted: 2026-06-10 | Branch: `claude/dead-redundant-code-analysis-ojnldr` | Baseline: `b5ae57d` (post-#67 merge)
> Status: **EXECUTED 2026-06-10** (single PR, per Lewis's call; Phase 0 data gates verified against prod, Vercel env check left with Lewis). Companion to `docs/audits/2026-06-09-dead-redundant-code.md` §3.

## Scope

Remove the two retired onboarding generations that survive behind runtime kill-switches:

1. **The pre-layered onboarding path** — every `!isLayeredReadEnabled()` branch
   (`LAYERED_READ_DISABLED` env kill-switch), including the legacy
   `computeFirstInsight()` deterministic first-insight pipeline and the
   archetype-terminal routing for new users.
2. **The V1 deterministic-narration first read** — the
   `isChatIntelligenceV2Enabled()` false-branch (`CHAT_INTELLIGENCE_V2_FORCE=0`
   escape hatch), its system-prompt branch, and the V1-vs-V2 comparison
   harnesses that exist only to exercise it.

The two are nested (V1/V2 fork is only reachable when the layered flag is off),
so removal is staged: retire the outer switch first, which strands the inner
one, then sweep the inner generation and its dependency cascade.

**Explicitly NOT in scope (keep list):**

- `/onboarding-v2/archetype` page, `archetype-orchestrator.tsx`, `ArchetypeBeat.tsx`,
  `api/onboarding/generate-archetype`, `lib/onboarding/archetype-prompt.ts` — still
  the terminal for legacy-stamped users and the `dont_know` path. Not flag-gated.
- Legacy step-stamp forwarding (`essentials_done`, `goal_set`, `goal_skipped`,
  `archetype_shown`, `first_read_shown`) in `lib/onboarding-v2/resume.ts` and
  `IN_SHEET_BEAT_STEPS` — mid-flow users must not strand. Revisit only after a
  DB check shows zero users on these stamps.
- `pattern-detectors.ts`, `insight-types.ts`, `experiments/{templates,scoring}.ts` —
  shared with the live chat-intelligence tools (`find-outliers`,
  `propose-experiment`, etc.). Verified live importers; they stay.
  (Execution note: `income-signal.ts` was on this keep-list but turned out to
  have insight-engine as its ONLY production caller — the other references were
  comments — so it was removed with the engine, along with the orphaned
  `BLOCKED_AT_FIRST_INSIGHT` / `INCOME_SIGNAL_THRESHOLD` consts and the
  never-set `requires_income_signal` template field. The v1 Gap rendering
  (`TheGapClient.tsx` + `GapCard`/`ProvenanceLine`) also fell out as a cascade
  of inlining the chat-intelligence gate on the-gap page.)
- `merchant_aggregates` MV, `wow_events` table, Value Map surfaces — live.

---

## Phase 0 — Go/no-go preconditions (no code)

Per CLAUDE.md the legacy path is "kept as a runtime rollback through the first
live cohort". All of the following must hold before Stage 1:

- [ ] **Layered flow proven in prod.** Suggested bar: ≥1 full live cohort has
      completed value-first onboarding end-to-end (rows with
      `onboarding_step = 'first_read_delivered'` or later AND
      `onboarding_completed_at IS NOT NULL`), with zero kill-switch flips since
      launch and no `compose-first-read` / wow-assessment criticals in the
      alert webhook for the proving window. Lewis signs off on the window length.
- [ ] **Migrations 062–069 applied in prod** (the layered flow's go-live
      requirement — after removal there is no fallback if they're missing).
- [ ] **Env audit:** `LAYERED_READ_DISABLED` and `CHAT_INTELLIGENCE_V2_FORCE`
      are unset in ALL Vercel environments (prod / preview / dev). If any env
      sets them, removal silently changes that env's behaviour.
- [ ] **No mid-flight legacy first-reads.** SQL check (prod, run by Lewis per
      the production-SQL rule): zero non-completed `conversations` rows with
      `metadata ? 'first_insight_payload'`. Completed rows keep the metadata
      harmlessly — it just stops being read.
- [ ] **Stamp census** (informational, not blocking): count of users on
      `essentials_done` / `goal_set` / `goal_skipped` / `archetype_shown`.
      Confirms the keep-list forwarding is still needed.

**Rollback model changes at this point** — flag flip (seconds, no deploy) is
replaced by `git revert` of the removal PRs (minutes, redeploy). Accepting that
trade is the go/no-go decision.

---

## Stage 1 — Retire the layered-read kill-switch (PR 1)

Delete `src/lib/feature-flags/layered-read.ts` (22 lines) and collapse all ten
call sites to their true-branch. Function names are authoritative; line numbers
drift (post-#67 baseline).

| Site | Action |
|---|---|
| `lib/ai/tools/index.ts` (`createToolbox`) | Always register `get_cluster_behaviour` + `get_conversation_signals` |
| `lib/ai/context-builder.ts` (`buildWhyBeatContext` early-return) | Drop the guard |
| `lib/ai/context-builder.ts` (layered-instructions assembly) | Include `buildLayeredReadInstructions()` unconditionally |
| `app/api/chat/route.ts` (signal-extraction hook) | Always fire `extractAndStoreSignals()` |
| `app/api/chat/route.ts` (why-beat one-shot gate) | Drop the flag check |
| `app/api/upload/route.ts` (MV refresh) | Always refresh `merchant_aggregates` |
| `app/api/insights/post-upload/route.ts` | Route becomes `handleLayeredFirstRead()` only — **delete the entire legacy body** (idempotency scan for narrate-via-trigger conversations, `computeFirstInsight` call, `first_insight_payload` / `chat_intelligence_v2` metadata writes) |
| `app/api/wow/event/route.ts` | Drop the no-op early return |
| `app/onboarding-v2/first-read/page.tsx` | Drop the redirect-to-archetype guard |
| `app/(office)/layout.tsx` + `lib/onboarding-v2/resume.ts` | `upload_done` always routes to `/onboarding-v2/first-read` |

Note: `/onboarding-v2/archetype` remains reachable for users already stamped
`archetype_shown` (resume routing) — that's the keep list, not the flag.

Estimated diff: ~−250 lines.

## Stage 2 — Remove V1 narration + the chat-intelligence gate (PR 2)

After Stage 1, the V1/V2 fork in post-upload is gone; the gate survives at three
sites and the V1 prompt path is unreachable. Sweep:

1. **Extract the live dependency first:** move sync `resolveUserCurrency` out of
   `lib/analytics/insight-engine.ts` into its own module (suggested:
   `lib/analytics/resolve-user-currency.ts`). Update importers:
   `lib/ai/compose-first-read.ts` (live layered path — added by #67) and
   `lib/analytics/__tests__/resolve-user-currency.test.ts`. **This is mandatory
   before the engine can be deleted.**
2. Delete `lib/analytics/insight-engine.ts` (589 lines). Verified safe: its other
   imports (`pattern-detectors`, `insight-types`, `experiments/*`, `income-signal`,
   `group-by-merchant`) all have live importers elsewhere and stay.
3. Delete `lib/features/chat-intelligence-v2.ts` + `chat-intelligence-v2.test.ts`;
   inline the true-branch at the three remaining call sites
   (`app/api/chat/route.ts` v2 surface, `the-gap/page.tsx` cohort gate,
   `context-builder.ts` prompt fork).
4. In `context-builder.ts`: delete `buildFirstInsightContext()` (~200 lines) and
   the `conversationIsFirstInsight && firstInsightPayload` system-prompt branch.
   `metadata.first_insight_payload` is then write-dead AND read-dead; no DB
   migration needed (old completed conversations keep inert metadata).
5. Delete the V1-vs-V2 comparison tooling (exists only to compare against V1):
   `scripts/compare-first-insight.ts` (501), `scripts/verify-first-insight.ts` (296),
   `scripts/_stub-next-headers.ts` (10), `scripts/run-personas-v2.ts` (88),
   `tests/onboarding/runner/prompt-version-flag.ts` (66 — not wired into `cli.ts`,
   rides with `run-personas-v2`).
6. Rewrite tests that build V1 fixtures: `lib/ai/__tests__/no-greet-warmly.test.ts`
   and `lib/ai/context-builder-v2.test.ts` construct `first_insight_payload`
   conversations / reference `buildFirstInsightContext`. Re-point their
   assertions at the layered/V2 prompt or delete the V1-specific cases.
7. Comment hygiene: `income-signal.ts` docstring references
   "the full computeFirstInsight pipeline" — reword.

Estimated diff: ~−1,800 lines.

## Stage 3 — Docs, env, ship (with PR 2 or immediately after)

- **CLAUDE.md:** delete the `isLayeredReadEnabled()` feature-flag section, the
  "Layered-read flag / kill-switch" paragraph under Onboarding completion, and
  the `!isLayeredReadEnabled()` rollback sentences. Update the Model Routing
  note if `CHAT_INTELLIGENCE_V2_FORCE` is mentioned anywhere.
- **Other docs:** sweep `ONBOARDING-MAP.md`, `CODE-MAP.md`,
  `cfos-office/docs/the-layers.md` for flag references; mark
  `docs/audits/2026-06-09-dead-redundant-code.md` §3 as executed.
- **Env hygiene:** delete both env vars from Vercel everywhere (inert after
  removal, but dead config invites confusion).
- **knip:** run as-is (files/deps gates must stay green). Optional follow-up:
  with `insight-engine` gone, re-attempt tightening the relaxed `exports` rule.
- **Versioning per conventions:** this is a MINOR session — assign the next free
  version at ship time, bump `package.json`, tag, add the `SESSION-LOG.md` entry.

## Verification matrix (each PR)

1. `npm run typecheck` · `npm run lint` (no new warnings) · `npm run knip` ·
   `npm test` · `npm run build` — all green.
2. Grep gates (must return zero in `src/`): `isLayeredReadEnabled`,
   `LAYERED_READ_DISABLED`, `computeFirstInsight`, `first_insight_payload`
   (writes/reads), `isChatIntelligenceV2Enabled`, `CHAT_INTELLIGENCE_V2_FORCE`,
   `buildFirstInsightContext`.
3. Playwright persona run (`npm run test:onboarding`) against staging — the
   value-first flow end-to-end, plus one legacy-stamped fixture user
   (`archetype_shown`) to prove the keep-list routing still lands.
4. Preview-deploy smoke: signup → goal beat → upload → first read →
   Value Map accept AND skip → office home.

## Sequencing & risk notes

- **Two PRs, not one.** Stage 1 is behaviour-neutral for every user already on
  the default flag values; Stage 2 is the large deletion. Separating them makes
  `git revert` surgical.
- Land Stage 1, let it soak in prod for a few days (one cron cycle of
  portrait-extraction + nudges), then land Stage 2.
- Highest-risk single step is the `resolveUserCurrency` extraction (live
  first-read path) — it has an existing unit test; do it as its own commit
  inside PR 2.
- After both PRs, the only onboarding architecture is value-first layered; any
  future rollback is a revert + redeploy, not a flag.
