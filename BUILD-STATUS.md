# Build Status

> **Last updated:** 2026-05-18
> **Current version:** v2.1 on main (Sessions 11–14 via #42, onboarding-v2 fix via #43)
> **Active work:** v2.3 — Experiment Engine (alongside v2.2 in review)
> **Next session:** v2.2 cohort flip per `cfos-office/docs/v2.2-rollout.md`; v2.3 manual prod-backfill (`cfos-office/supabase/prod-backfill-experiments.sql`) when Lewis is ready.
> **Branch state:** `claude/experiment-engine-oKzua` carries migration 052 (applied to staging), the 10-template catalog, scoring + limit modules, 5 new lifecycle tools, removal of legacy `PatternResult.experiment`, cron `/api/cron/expire-experiments`. 554/554 tests passing. PR not yet opened.

## Branch Topology

```
main (deployed to Vercel → production)
└── feature/v2.2-chat-intelligence (open, ~15 commits)
```

## Session History

### v2.0: Post-Merge Baseline ✅
UI rebuild (session-25/folder-detail-views) + onboarding (O1/O2) merged to main. Versioning convention established. New baseline for all future work.

### v2.1–v2.4 (on main) ✅
- v2.4 work via #42 (Sessions 11 + 12 + 13 + 14 — goal-aware office, action-items goal link & ranking, folder reframes)
- Onboarding-v2 500 fix + Value Map made mandatory via #43
- Account delete fix via #44 (on a separate cleanup branch)

### v2.2 — Session 26: Chat Intelligence 🟡 (in review)
- Branch: `feature/v2.2-chat-intelligence`
- Migrations 050 + 051 on staging (prod gated on Lewis review)
- 10 new AI tools (2 reading, 5 detective, 1 action, 1 labelling, 1 shared helper layer)
- `analyseGapV2` with three shapes (single_intent / multi_intent / coverage_gap)
- `buildFirstInsightContextV2` brief-first prompt + cohort flag
- LabelTransactionsBlock + Gap V2 client + MultiIntent/Coverage cards
- Output validators (citation / projection / voice / chip) + options-parser extraction
- Eval harness (compare-first-insight + judge + persona --prompt-version)
- See `cfos-office/SESSION-LOG.md` for full details, `cfos-office/docs/v2.2-rollout.md` for rollout commands

### Planned
- **v2.3** — Session 27: Folder Fix-Up (designed)
- **v2.4–v2.7** — Phases B–E from UX audit remediation (drafted)
- **v2.8** — Sessions 28–30: Confidence / Prediction / Value Map Retake (designed)
- **v3.0** — Premium tier launch (~August 2026)

## Derived data fields

### `user_profiles.income_shape` (Session A — Income Shape Detector)

Forward-only classifier for variable-income support. Written by
`updateIncomeShape()` at the end of `refreshMonthlySnapshots()` so every
transaction ingest triggers a fresh classification.

| Column | Type | Notes |
|---|---|---|
| `income_shape` | `text` | One of `salaried` / `salaried_with_bonus` / `variable` / `unknown` |
| `income_volatility` | `numeric` | Coefficient of variation (std dev / mean) of income deposits |
| `income_shape_deposit_count` | `integer` | Number of income deposits used to compute the CV |
| `income_shape_detected_at` | `timestamptz` | Last refresh time |

Detection path: `src/lib/analytics/income-shape.ts` → pure function over
12-month transaction window, filtered by `isIncomeRow` (income category +
positive amount). Thresholds (`CV < 0.05` salaried, `CV < 0.20`
salaried_with_bonus, `≥ 0.20` variable, `< 4` deposits → unknown) live in a
`TUNABLE_CONSTANTS` block — empirical, revisit after Wave 1.

**Critical:** detector never returns the income amount itself — only
pattern signals (shape, CV, count). Anti-hallucination block at the
context-builder layer remains the source of truth on income figures.

Staging migration: `055_add_income_shape_fields` (applied to
`qlbhvlssksnrhsleadzn`). Production migration is Lewis's manual step.

Dev verification surface: `<IncomeShapeBadge />` on the Cash Flow folder,
gated by `NEXT_PUBLIC_DEV_BADGES=true`. CLI script: `npx tsx
scripts/show-shape-and-posture.ts <userId>` prints persisted + live-recomputed
shape AND posture values side-by-side.

### `user_profiles.financial_posture` + `monthly_snapshots.closing_balance` (Session B — Posture Detector + Runway)

Forward-only posture layer built on Session A's shape. Written by
`updateFinancialPosture()` at the end of `refreshMonthlySnapshots()`,
after `backfillClosingBalances()` walks closing balances back from
`accounts.current_balance` through each snapshot's `surplus_deficit`,
and after `updateIncomeShape()` persists fresh shape data.

| Column | Type | Notes |
|---|---|---|
| `financial_posture` | `text` | One of `surviving` / `stable` / `planning` / `unknown` |
| `posture_confidence` | `numeric` | 0–0.90; damped by low-month-count, unknown trajectory, or boundary proximity |
| `runway_days` | `integer` | Days at T3M spend rate against liquid balance |
| `t3m_income_monthly` | `numeric` | Trailing-3-month mean of `total_income` |
| `t3m_spend_monthly` | `numeric` | Trailing-3-month mean of `total_spending` |
| `balance_trajectory` | `text` | `growing` / `growing_slowly` / `flat` / `shrinking` / `unknown` |
| `posture_detected_at` | `timestamptz` | Last refresh time |
| `monthly_snapshots.closing_balance` | `numeric` | Liquid balance at refresh time for newest snapshot; older rows back-walked through surplus_deficit |

Detection path: pure functions in `src/lib/analytics/cashflow-aggregates.ts`
(T3M means, runway days, trajectory) and `src/lib/analytics/posture.ts`
(thresholds + confidence). TUNABLE_CONSTANTS at top of both files —
runway cutoffs 30d (surviving) and 90d (stable / planning, gated by
income ≥ spend).

Liquid balance source: `accounts.current_balance` summed across all
non-credit-card accounts (`type != 'credit_card'`, `deleted_at is null`).
Single-currency assumption — multi-currency users will see noisy runway.

Staging migration: `056_add_financial_posture` (applied to
`qlbhvlssksnrhsleadzn`). Production migration is Lewis's manual step.

**No CFO behaviour change in Session B.** Detection + dev badge + CLI
verification only. Frame switching, voice fragments, and folder-prompt
variants land in Session C.
