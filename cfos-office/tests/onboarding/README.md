# Onboarding Test Suite

On-demand automated tests for the post-signup **estimates-first** onboarding-v2
flow (the live default since OB-2/OB-3). Drives curated personas through the real
UI via Playwright, grades the Reads with an LLM judge, asserts DB state, and
captures screenshots.

The flow runs entirely **in-sheet at `/office`** (no statement upload before the
Read). The estimate beats are hosted by `EstimateBeatHost`, advancing by
`onboarding_step` via `router.refresh()`; the optional statement-check mission
reuses the legacy `OnboardingBeatHost`. Every persona walks the same opening
sequence and sketches its month from band taps — the band sketch IS the input:

```
door → context → composite → goal → income → sketch → verdicts → estimate Read
```

The **estimate Read** is the completion gate — it stamps `onboarding_completed_at`
before any upload. Personas with `runStatementCheck: true` then walk the optional
accuracy pass, which uploads a real statement and appends a second Read:

```
estimate Read → [CTA] → upload → processing → confirm → reality-check Read
```

The Value Map is a later/stretch leg and is **not** driven by this harness; the
walk stops at the reality-check Read.

## Run

```bash
npm run test:onboarding                              # full suite
npm run test:onboarding -- --personas drifter-expat  # one persona
npm run test:onboarding -- --skip-judge              # no Bedrock judge calls
npm run test:onboarding -- --keep-users              # don't teardown DB rows
npm run test:onboarding -- --concurrency 1           # serial (default 2)
```

## Requirements

- `.env.local` pointing at CFO **Staging** Supabase (`qlbhvlssksnrhsleadzn`)
- AWS Bedrock credentials (EU inference profiles) in env
- Port 3000 free (runner auto-starts dev server)

> **Known issue:** teardown of the test user can fail on an `llm_usage_log` FK
> constraint (pre-existing — FINDINGS.md Bug #3), so each run may leave one
> orphaned test user in Staging. The next run's pre-clean sweeps stale ones.

## Output

`tests/onboarding/test-output/<run-id>/` — `report.html`, `summary.json`,
per-stage screenshots + captured JSON (`estimate-read.json`,
`reality-check.json`, `db-state-after-handoff.json`, judge outputs).

## Stages asserted

`door_done → context_done → composite_done → goal_done → income_done →
sketch_done → verdicts_done → estimate_read`, then for check personas
`check_upload_done → check_confirm_done → reality_check`.

Terminal DB state (derived from `runStatementCheck` in `db-assertions.ts`):

- **Every persona:** `onboarding_completed_at` set; `onboarding_estimates` has all
  five bands + income + the three verdicts + a top value; exactly one goal row.
- **Non-check:** `onboarding_step = 'first_read_delivered'`, zero transactions.
- **Check:** `onboarding_step = 'reality_check_delivered'`,
  `onboarding_estimates.verification` populated (engine_version `v1`, ≥1 `verified`
  band), and the imported transaction count.

Two flow-agnostic invariants run for every persona: no leaked `(System note: …)`
in any assistant message, and no case-variant duplicate `recurring_expenses` names.

## The door is driven via the situation chip

The door beat accepts free text (LLM-classified into an internal family) **or** a
situation chip. The harness always drives the **chip** — deterministic, no Bedrock
classification call — mapping each persona to its family via `struggleToFamily`
(`entryStruggle` → `growth | security | agency | candor`).

## Personas (10)

| ID | Door family | Check? | Notes |
|---|---|---|---|
| `builder-classic` | growth | — | Builder — deliberate saver, GBP |
| `fortress-saver` | candor | — | Fortress — thrifty; corrects to a deposit goal via the alt-goal escape hatch (no deadline) |
| `truth-teller-balanced` | candor | — | Balanced, middling month |
| `drifter-expat` | candor | ✓ | Drifter — Barcelona, **EUR**, high dining/subs |
| `anchor-debt` | security | ✓ | Anchor — debt-heavy, nothing saved yet |
| `time-saver-expert` | candor | — | High earner; composite `not_me` → re-pick growth, 3-month deadline (STEEP pace) |
| `aiko-low-transaction` | candor | — | Young, just starting (no deadline) |
| `sofia-chaotic` | agency | ✓ | Freelance, lumpy income, 8+ subs |
| `tom-long-history` | growth | — | Established earner, 50+ |
| `zane-spain` | growth | — | Spanish market, **EUR** |

Door families cover all four (`growth ×3`, `security`, `agency`, `candor ×5`);
deadlines cover all four (`3m`, `6m`, `2y`, `none`); composite reactions cover all
three (`spot_on`, `close`, `not_me`). Three personas walk the statement-check.

## Fixtures

`fixtures/reads/*.captured.txt` are golden Reads (`<id>.captured` = estimate Read,
`<id>.reality.captured` = reality-check Read). The staging suite re-captures these
against the live flow; hand-authored golden Reads stand in so `npm run test`
(the CI gate) is deterministic without a live run. `bad-*.txt` test the judge's
negative cases (they exercise the judge, not the flow).

## See also

Spec: `docs/superpowers/specs/2026-04-20-onboarding-test-suite-design.md`
Plan: `docs/superpowers/plans/2026-04-20-onboarding-test-suite.md`
