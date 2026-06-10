# Onboarding Test Suite

On-demand automated tests for the post-signup **value-first** onboarding-v2 flow.
Drives curated personas through the real UI via Playwright, grades the first Read
with an LLM judge, asserts DB state, and captures screenshots.

The flow runs entirely **in-sheet at `/office`** (the `OnboardingBeatHost`,
advancing by `onboarding_step`), with **no Marcus/chat-first split** — every
persona walks the same sequence:

```
struggle → goal → upload → income/rent → confirm fixed costs → First Read
```

The Value Map is an **optional opt-in after the Read**, not a gate. The goal beat
is goal-only and 90s-gated, so the driver fast-forwards it via the admin client
(mirroring `completeGoalBeat` / `skipGoalBeat`); goal personas get their goal
seeded so the Read can be checked for goal-awareness.

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

> **Known issue:** teardown of the test user fails on an `llm_usage_log` FK
> constraint (pre-existing — FINDINGS.md Bug #3), so each run leaves one orphaned
> test user in Staging. The next run's pre-clean sweeps stale ones.

## Output

`tests/onboarding/test-output/<run-id>/` — `report.html`, `summary.json`,
per-stage screenshots + captured JSON.

## Stages asserted

`struggle_submitted → goal_done → upload_done → essentials_done → confirm_done →
first_read`. Terminal DB state: `onboarding_step = 'first_read_delivered'`,
`onboarding_completed_at` set. Two flow-agnostic invariants run for every persona
(`db-assertions.ts`): no leaked `(System note: …)` in any assistant message, and
no case-variant duplicate `recurring_expenses` names.

## Personas (10, all value-first)

| ID | Archetype | Purpose |
|---|---|---|
| `builder-classic` | Builder | Standard Builder — investment-focused spending |
| `fortress-saver` | Fortress | Thrifty, foundation-heavy |
| `truth-teller-balanced` | Truth Teller | Balanced across quadrants |
| `drifter-expat` | Drifter | Lewis-style expat, **EUR**, high dining/subs |
| `anchor-debt` | Anchor | Debt-heavy burden profile |
| `time-saver-expert` | Builder | Advice-averse high-income expert |
| `aiko-low-transaction` | Fortress | Sparse data (21 days) — no over-confident patterns |
| `sofia-chaotic` | Drifter | Irregular freelance income — pattern-of-no-pattern |
| `tom-long-history` | Builder | 18-month history — 90-day window regression |
| `zane-spain` | Fortress | Spanish market, **EUR**, bi-monthly utilities |

The two former chat-first personas (`skip-value-map`, `skip-csv-upload`) were
removed — they modelled the retired pre-value-first bifurcation (upload is now
mandatory). A dedicated goal-skip persona could be re-added later.

## See also

Spec: `docs/superpowers/specs/2026-04-20-onboarding-test-suite-design.md`
Plan: `docs/superpowers/plans/2026-04-20-onboarding-test-suite.md`
