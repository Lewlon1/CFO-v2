# Baseline — estimates-first onboarding (2026-06-13)

Full Playwright onboarding harness run captured on branch
`claude/nifty-carson-4jzdl2` (OB-4), run against staging on 2026-06-13
(run id `ob4-baseline`).

This is the **"after"** snapshot for the estimates-first onboarding redesign —
the live default since OB-2/OB-3. It is the counterpart to the frozen
**"before"** value-first baseline in `../main-2026-06-12/` (do not delete that
one — it captures the upload-first flow this replaces).

## Result summary

All 10 personas: Functional PASS · LLM judge PASS · Visual PASS.
Likert means: warmth 5.0 · accuracy 4.9 · on_brand 5.0 · persona_fit 4.9 · actionability 4.9.

Three personas (`drifter-expat`, `anchor-debt`, `sofia-chaotic`) walk the optional
statement-check mission through the reality-check Read; the other seven stop at
the estimate Read.

## Contents

- `summary.json` — structured suite result (per-persona stages, judge scores, durations)
- `report.html` — human-readable report
- `<persona>/` — per-stage screenshots (PNG: `door_done` → `verdicts_done` →
  `estimate_read`, plus `check_upload_done` → `check_confirm_done` →
  `reality_check` for the three statement-check personas) + `captured/`
  (`estimate-read.json`, `reality-check.json`, `judge-estimate-read.json`,
  `judge-reality-check.json`, `db-state-after-handoff.json`).
