# Build Status

> **Last updated:** 2026-05-16
> **Current version:** v2.1 on main (Sessions 11–14 via #42, onboarding-v2 fix via #43)
> **Active work:** v2.2 — Session 26 (Chat Intelligence / Dialogue-as-Moat)
> **Next session:** Cohort flip on test users per `cfos-office/docs/v2.2-rollout.md`, monitor 5 days, then tag v2.2
> **Branch state:** `feature/v2.2-chat-intelligence` carries Phases 1–7 (migrations 050+051 on staging, 10 new tools, gap analyser V2, brief-first prompt, frontend components, output validators, eval harness). 459/459 tests passing. PR not yet opened.

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
