# Codebase Atlas — action items + session prompts (2026-07-27)

Derived from `docs/audits/2026-07-27-codebase-atlas-findings.md` (F1–F6).
Five sessions, each with a ready-to-paste prompt. Target versions are assigned
by Lewis at scheduling per the CLAUDE.md convention ("versions ship, sessions
don't"); v2.9 is currently reserved for Phase E, so these slot into the next
free minors. Suggested order: **S1 → S3 → S2 → S5 → S4** (quick user-facing
win, then cheap drift cleanup, then number-correctness, then the safety net,
then the big refactor last — S5 before S4 so the guard tests exist before the
prompt assembler is taken apart).

| # | Finding | Session | Size | Why this order |
|---|---------|---------|------|----------------|
| S1 | F1 | Persona-sanitiser realignment | S | User-facing voice, spec already in BACKLOG |
| S2 | F2 | Gap engine convergence (v1 → v2) | M | Number consistency across surfaces |
| S3 | F3+F5 | Drift cleanup: dashboard contract + CLAUDE.md | S | Cheap, unblocks accurate future sessions |
| S4 | F4 | Context-builder sectioning + token telemetry | L | Biggest refactor; do after S5's tests exist |
| S5 | F6 | Guard-layer golden tests | M | Safety net for S1/S4 and future prompt edits |

Cross-reference: S1 lifts the existing BACKLOG deferral ("CFO Directness +
Constitution v1.4 (2026-06-02) — deferrals", first bullet) into a scheduled
session — it is the same item, not a new one.

---

## S1 — Persona-sanitiser realignment (F1) — size S

```
Session v2.x — Persona-sanitiser realignment with Constitution §2

MISSION
The runtime persona sanitiser is stricter than the Constitution it enforces.
Constitution (v1.5) §2 ALLOWS stance-bearing first person ("I'd push back on
that" is an endorsed example) and bans only narration + the service-desk
register. persona-sanitiser.ts hard-bans \bI\b, \bI'd\b, \bI'll\b, \bI'm\b,
\bme\b, \bmy\b, "let me" — so constitution-approved phrasing is silently
rewritten by Haiku before persisting (and the rewrite feeds the Bedrock prompt
cache, so the flattening compounds). Align the sanitiser with the
Constitution. Per CLAUDE.md: the Constitution wins; read it before any change.

PHASE 0 — read before writing
- CFO-CONSTITUTION.md §2 (voice) and §6 (how the CFO guides)
- cfos-office/src/lib/ai/persona-sanitiser.ts (LEAK_PATTERNS, REWRITE_PROMPT)
- cfos-office/src/lib/ai/persona-sanitiser.test.ts (currently asserts
  "I'd note that…" GETS rewritten — this assertion must flip)
- The call site in cfos-office/src/app/api/chat/route.ts
- BACKLOG.md § "CFO Directness + Constitution v1.4 (2026-06-02) — deferrals",
  first bullet (the original spec for this fix)

SCOPE
- KEEP stripping: narration ("I noticed", "I can see"), service-desk register
  ("let me", "I can help"), and "advice"/"advise" (banned words).
- STOP stripping: bare stance-bearing "I" / "I'd" / "me" / "my".
- Update REWRITE_PROMPT to match: Haiku must not strip stance-first-person
  when it does rewrite for other reasons.
- Re-derive persona-sanitiser.test.ts IN THE SAME EDIT: stance examples pass
  clean, narration/service-desk examples still get flagged. Add the
  Constitution's own "I'd push back on that" as a must-pass-through case.
- OUT OF SCOPE: first-read path (first-read.ts is first-person-free by
  design — do not touch), Constitution amendments, any other guard.

VERIFY
npm run typecheck && npm run lint && npm run test (from cfos-office/; npm, not
pnpm/yarn). All existing tests pass or are re-derived with justification.

DELIVER
Commit on a feature branch; SESSION-LOG.md entry (what was stripped before vs
after, with one before/after transcript pair); mark the BACKLOG deferral
resolved with a pointer to the commit.
```

---

## S2 — Gap engine convergence (F2) — size M

```
Session v2.x — Gap engine convergence: retire analyseGap v1

MISSION
lib/analytics/gap-analyser.ts (1,188 lines) carries two live generations.
analyseGapV2 powers the first-read composer; analyseGap (v1) still serves
three consumers. The same user can get "the Gap" computed two different ways —
in a trust-first product, cross-surface number divergence is the primary
failure mode. Make v2 canonical, migrate the three v1 call sites, delete v1.

PHASE 0 — read before writing
- cfos-office/src/lib/analytics/gap-analyser.ts — both generations, and the
  comment at ~L415 ("keep using analyseGap. v2 writes to financial_portrait
  under 'gap_v2_<id>'") — understand WHY v1 was kept before removing it
- The three v1 consumers:
  - cfos-office/src/lib/ai/tools/analyse-gap.ts (the analyse_gap chat tool)
  - cfos-office/src/app/api/insights/value-map-complete/route.ts
  - cfos-office/src/lib/analytics/pattern-detectors.ts:593
    (+ gapResultToPatternResult — shape adapter)
- Map the shape difference: v1 = five gap types (leaking_despite_awareness,
  …); v2 = three shapes (single_intent, multi_intent, coverage_gap). Decide
  per consumer: adapter over v2 output, or consumer rewrite.
- financial_portrait source keys: v1 writes source='gap_analysis', v2 writes
  'gap_v2_<id>' — decide the post-convergence convention and whether old rows
  need a compatibility read (they should NOT be migrated in this session).

SCOPE
- Migrate all three call sites to v2 (adapter or rewrite, per Phase 0).
- Delete analyseGap v1 and v1-only helpers from gap-analyser.ts.
- Chat tool description stays accurate (tool contract may not silently change
  meaning — if v2 output changes what the tool tells Claude, update the tool
  description in the same edit).
- OUT OF SCOPE: production data migration or backfill of old
  financial_portrait rows (needs Lewis; note in SESSION-LOG if warranted);
  any prompt-layer change beyond the tool description.

VERIFY
npm run typecheck && npm run lint && npm run test && npm run knip. Existing
gap tests re-derived against v2 shapes. Grep proves zero remaining references
to the v1 symbol.

DELIVER
Feature branch; SESSION-LOG.md entry recording the per-consumer migration
decision (adapter vs rewrite) and the portrait source-key convention.
```

---

## S3 — Drift cleanup: dashboard contract + CLAUDE.md (F3 + F5) — size S

```
Session v2.x — Drift cleanup: dashboard type contract + CLAUDE.md reconciliation

MISSION
Two verified drifts. (1) Eleven files import types from a route file
('@/app/api/dashboard/summary/route'), inverting layering and making a route
handler a de-facto shared contract. (2) CLAUDE.md documents ~8 chat tools
while lib/ai/tools/index.ts createToolbox() registers 43, and its file
structure section predates renames (lib/categorizer → lib/categorisation,
llm-categorizer → llm-categoriser, etc.).

PHASE 0 — read before writing
- cfos-office/src/app/api/dashboard/summary/route.ts — the exported types:
  DashboardSummary, CategorySummary, ValueCategorySummary, RecurringItem,
  ReviewStatus
- The 11 importers: src/lib/hooks/useDashboardData.ts + 10 files in
  src/components/dashboard/ (grep "from '@/app/api/dashboard/summary/route'")
- cfos-office/src/lib/ai/tools/index.ts — the actual tool registry
- CLAUDE.md — "Tool Definitions" section + "File Structure" section

SCOPE
- Create a lib home for the dashboard response contract (e.g.
  src/lib/contracts/dashboard.ts or alongside existing lib types — follow
  whatever pattern lib/ already uses for shared types). Route imports the
  types; components/hooks import from lib. Route file exports only handlers
  and route config afterwards.
- CLAUDE.md: replace the stale tool table with either a regenerated list from
  tools/index.ts or a one-line pointer to the registry file as source of
  truth (prefer the pointer — a generated list re-drifts). Fix the file
  structure section's dead names. Correct the "Current" version line (says
  v2.6; package.json is 2.8.0). Touch nothing else in CLAUDE.md — it is an
  identity document; minimal factual edits only.
- OUT OF SCOPE: any behaviour change; any other route's exports; CODE-MAP.md
  (verify it is accurate first — if it already covers the tools, the CLAUDE.md
  pointer should target it).

VERIFY
npm run typecheck && npm run lint && npm run test && npm run knip. Grep
proves no component/lib file imports from any app/api route path.

DELIVER
Feature branch; SESSION-LOG.md entry; note in the entry that the atlas
dependency graph should show the components/dashboard → app/api edge cluster
gone on next regeneration (node docs/atlas/build.mjs).
```

---

## S4 — Context-builder sectioning + token telemetry (F4) — size L

```
Session v2.x — context-builder: section modules + per-section token telemetry

MISSION
lib/ai/context-builder.ts is 2,752 lines assembling ~18 prompt sections from
11 parallel queries. CLAUDE.md pitfall #7 says the token budget is real, but
there is no per-section measurement, and sections are not independently
testable. Extract sections into modules and add token accounting — WITHOUT
changing a single character of assembled output.

PHASE 0 — read before writing
- cfos-office/src/lib/ai/context-builder.ts — full read; list every section
  builder and its data dependencies
- CLAUDE.md "System Prompt Architecture" — the documented 18-section assembly
  order is the contract; empty sections filtered, joined with '\n\n---\n\n'
- cfos-office/src/lib/ai/usage-logger.ts — the [bedrock-usage] pipeline the
  telemetry should extend
- The cachePoint usage in app/api/chat/route.ts — assembly changes must not
  break prompt-cache stability (identical input → identical prompt string)

SCOPE
- FIRST, the safety net: a golden snapshot test that renders buildSystemPrompt
  for fixture users (rich profile / sparse profile / mid-onboarding) and
  asserts the exact assembled string. Commit it against the CURRENT code
  before refactoring; it must pass unchanged after.
- Extract each section into src/lib/ai/context-sections/<name>.ts with a
  common signature; buildSystemPrompt becomes orchestration (parallel fetch
  via Promise.allSettled preserved, order preserved, join preserved).
- Add per-section size accounting (chars + estimated tokens) logged through
  the existing usage-logger pipeline, so [bedrock-usage] lines show where the
  budget goes. Estimation is fine; do not add a tokeniser dependency without
  checking bundle impact.
- Unit tests per extracted section (empty-input → empty-string behaviour,
  the filter contract).
- OUT OF SCOPE: changing any section's CONTENT, reordering, dropping
  sections, prompt-wording edits of any kind. If a section looks wrong,
  note it in SESSION-LOG — do not fix it here.

VERIFY
Golden snapshots byte-identical pre/post. npm run typecheck && npm run lint
&& npm run test && npm run knip && npm run build.

DELIVER
Feature branch; SESSION-LOG.md entry including a first per-section token
table from the fixture users (this becomes the baseline for future
prioritise-ruthlessly decisions).
```

---

## S5 — Guard-layer golden tests (F6) — size M

```
Session v2.x — Golden tests for the guard layer

MISSION
insight-validator, value-save-guard, read-judge, and persona-sanitiser are
what stand between a hallucinated number and the user. They are regex-heavy —
the most regression-prone kind of code — and under-tested relative to their
load. Build deterministic unit coverage. (Historical context: S-W1.5-11 —
silent pipeline failure is this codebase's known worst failure mode.)

PHASE 0 — read before writing
- cfos-office/src/lib/ai/insight-validator.ts, value-save-guard.ts (or their
  actual locations — locate via lib/ai/), read-judge.ts,
  persona-sanitiser.ts (+ existing persona-sanitiser.test.ts)
- cfos-office/eval/golden-set/ — existing fixture format; reuse it where the
  pairs contain usable assistant outputs
- scripts/test-prompts.ts §9 harness — note which checks live there; those
  assert on LIVE model output and need Bedrock creds. THIS session builds
  only cred-free deterministic tests; do not duplicate §9 cases.

SCOPE
- insight-validator: fixtures where every number/merchant traces to a tool
  result (pass) and where one is fabricated (fail) — including near-misses
  (rounded numbers, currency formatting, merchant-name variants).
- value-save-guard: "saved it" claims with and without a matching
  record_value_classifications call.
- read-judge: word cap boundary, exactly-one-CTA, closing-question detection
  — pass/fail pairs at the boundaries.
- persona-sanitiser: detector-only tests (mock the Haiku rewrite path —
  assert WHAT gets flagged, not rewrite quality). If S1 has landed, test the
  post-S1 pattern set; if not, test current behaviour and leave a TODO
  pointing at the S1 spec.
- OUT OF SCOPE: changing guard behaviour (test what IS, file discrepancies
  in SESSION-LOG); live-model behavioural evals (creds-gated, see BACKLOG
  "Coaching Cadence — deferrals").

VERIFY
npm run typecheck && npm run lint && npm run test. New tests fail when a
guard regex is deliberately broken (mutation-check at least one per guard,
demonstrated in SESSION-LOG).

DELIVER
Feature branch; SESSION-LOG.md entry listing coverage added per guard and any
behaviour discrepancies found while writing fixtures.
```
