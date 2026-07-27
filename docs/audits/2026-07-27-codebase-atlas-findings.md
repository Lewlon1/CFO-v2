# Codebase Atlas — findings (2026-07-27, v2.8 snapshot)

Companion to `docs/codebase-atlas.html` (interactive: zoomable treemap, module
import graph, subsystem dossiers, data flows). Regenerate with
`node docs/atlas/build.mjs`. Snapshot basis: 898 tracked files, ~146.9k lines,
240 module-level import edges extracted from `@/` imports under
`cfos-office/src`, branch `claude/codebase-interactive-viz-jrn1sq` at v2.8.0.

All claims below were verified against the working tree on the snapshot date.

## Structural reads

- **The core rule holds in the import graph.** Layering is one-directional:
  `lib/ai → lib/analytics` ×54 with no reverse edge; `app/*` sits above `lib/*`
  throughout. "The LLM interprets, the system computes" is enforced by
  structure. The graph is a usable regression check: any new `lib → app` edge
  is a layering violation.
- **The AI layer is the centre of gravity.** ~16% of all lines and the
  most-connected module. Concentration: `lib/ai/context-builder.ts` (2,752
  lines) and `app/api/chat/route.ts` (1,143 lines).
- **Docs & audits are the largest zone** (~22% of lines) — a real asset
  (SESSION-LOG, audits, decision records) that has begun to drift from code
  (see F5).

## Findings, prioritized

### F1 — persona-sanitiser contradicts the Constitution it enforces
`lib/ai/system-prompt.ts` (BASE_PERSONA) explicitly endorses first person that
carries a stance — "I'd push back on that" is given as a *good* example — while
`lib/ai/persona-sanitiser.ts` hard-bans `\bI\b`, `\bI'd\b`, `\bme\b`, `\bmy\b`.
Constitution-approved phrasing is silently rewritten by Haiku before persist
(and the rewrite exists precisely because persisted messages feed the Bedrock
prompt cache). Effect: flattened voice on exactly the turns where the persona
is strongest, plus an unnecessary Haiku call per false positive. Per CLAUDE.md,
the Constitution wins: loosen the sanitiser (or amend the Constitution if the
ban is intended).

### F2 — two live generations of the gap engine
`lib/analytics/gap-analyser.ts` (1,188 lines) carries both `analyseGap` (v1)
and `analyseGapV2`. v1 still has three live consumers — the `analyse_gap` chat
tool (`lib/ai/tools/analyse-gap.ts`), `app/api/insights/value-map-complete/route.ts`,
and `lib/analytics/pattern-detectors.ts:593` — while the first-read composer
uses v2. The same user can get "the Gap" computed two different ways; in a
trust-first product, number divergence between surfaces is the primary failure
mode. Action: make v2 canonical, migrate the three v1 call sites, delete v1.

### F3 — components import types from a route file
11 files (`lib/hooks/useDashboardData.ts` + 10 `components/dashboard/*`) do
`import type { … } from '@/app/api/dashboard/summary/route'`. Type-only, so it
works — but it inverts layering (components/lib → app/api), makes a route
handler file a de-facto shared contract, and accounts for the
`components/dashboard → app/api` edge cluster in the graph. Action: move
`DashboardSummary`, `CategorySummary`, `ValueCategorySummary`, `RecurringItem`,
`ReviewStatus` into a `lib/` types module and re-point the imports.

### F4 — context-builder is a 2,752-line monolith with no per-section telemetry
`buildSystemPrompt()` assembles ~18 sections from 11 parallel queries.
CLAUDE.md pitfall #7 ("token budget is real") cannot be managed without
measurement. Action: extract sections into modules (unit-testable, read-judge
style) and log token counts per section through the existing
`[bedrock-usage]` / `lib/ai/usage-logger.ts` pipeline.

### F5 — CLAUDE.md tool documentation has drifted
CLAUDE.md documents ~8 chat tools; `lib/ai/tools/index.ts` `createToolbox()`
registers 43. The file-structure section also predates renames
(`lib/categorizer` → `lib/categorisation`, etc.). Since Claude sessions steer
by CLAUDE.md, drift here directly causes misdirected changes. Action:
regenerate the tool table from `tools/index.ts` or replace it with a pointer
to CODE-MAP as source of truth.

### F6 — the guard layer is the least-tested load-bearing code
`insight-validator`, `value-save-guard`, `read-judge`, `persona-sanitiser` are
what stand between a hallucinated number and the user, and they are
regex-heavy (regression-prone under innocent-looking edits). `eval/golden-set`
infrastructure already exists. Action: golden-set unit tests for the guards —
highest-value coverage available.

## Incidental notes

- The recurring-detector CV thresholds (`MAX_AMOUNT_CV 0.20`, `MAX_GAP_CV
  0.35`) encode the "Satans Coffee classified as a weekly bill" staging
  incident — preserved in a comment; good institutional memory.
- Zone shares at v2.8: Docs & audits 22.2% · AI layer 16.1% · Components
  14.1% · App routes 10.9% · Domain libs 9.1% · Tests & eval 9.0% ·
  Analytics 7.9% · Database 3.9% · Ops & config 3.5% · Data pipeline 3.4%.
- Regeneration cadence suggestion: rebuild the atlas per version tag; watch
  for files crossing ~1,000 lines and for new wrong-direction graph edges.
