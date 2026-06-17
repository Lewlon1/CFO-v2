# Frozen baseline — main-branch onboarding (2026-06-12)

Full Playwright onboarding harness run captured from `main` at commit `c90ad28`
("security: harden demo/value-map flow against hijack and cost-DoS (#69)"),
run against staging on 2026-06-12 (run id `2026-06-12T19-36-16-447Z`).

This is the **"before"** evidence for the estimates-first onboarding redesign
(OB-1…OB-5 on branch `claude/nifty-carson-4jzdl2`). It is frozen: do not re-run,
edit, or regenerate — the upload-first flow it captures no longer exists on the
feature branch. The dev compare surface (`/dev/onboarding-compare`, OB-4) and
`runner/compare-runs.ts` read from this directory.

## Result summary

All 10 personas: Functional PASS · LLM judge PASS · Visual PASS.
Likert means: warmth 4.8 · accuracy 5.0 · on_brand 4.2 · persona_fit 4.3 · actionability 4.4.

## Contents

- `summary.json` — structured suite result (per-persona stages, judge scores, durations)
- `report.html` — human-readable report
- `<persona>/` — per-stage screenshots (PNG) + `captured/` (first-read text in
  `insight.json`, `archetype.json`, `judge-insight.json`, `db-state-after-handoff.json`)
