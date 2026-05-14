# Onboarding Test Suite

On-demand automated tests for the post-signup onboarding-v2 flow. Drives 8 curated personas through the UI via Playwright, grades LLM output, captures screenshots.

The suite covers both onboarding-v2 paths:
- **Marcus path** (entry struggle = "I don't know where my money goes") — struggle → value-map → upload → archetype → chat with first-insight
- **Chat-first path** (entry struggle = wealth/debt/planning/free_text) — struggle → chat with pre-canned or LLM-generated opener

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

## Output

`tests/onboarding/test-output/<run-id>/` — `report.html`, `summary.json`, per-persona screenshots + captured JSON.

## Personas

| ID | Path | Archetype | Purpose |
|---|---|---|---|
| `builder-classic` | Marcus | Builder | Standard Builder — investment-focused spending |
| `fortress-saver` | Marcus | Fortress | Thrifty, foundation-heavy |
| `truth-teller-balanced` | Marcus | Truth Teller | Balanced across quadrants |
| `drifter-expat` | Marcus | Drifter | Lewis-style expat, EUR, high dining/subs |
| `anchor-debt` | Marcus | Anchor | Debt-heavy burden profile |
| `time-saver-expert` | Marcus | Builder | Advice-averse high-income expert |
| `skip-value-map` | Chat-first | — | Wealth struggle → straight to chat opener |
| `skip-csv-upload` | Chat-first | — | Debt struggle → straight to chat opener |

## See also

Spec: `docs/superpowers/specs/2026-04-20-onboarding-test-suite-design.md`
Plan: `docs/superpowers/plans/2026-04-20-onboarding-test-suite.md`
