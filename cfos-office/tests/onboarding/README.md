# Onboarding Test Suite

On-demand automated tests for the post-signup onboarding flow. Drives 8 curated personas through the UI via Playwright, grades LLM output, captures screenshots.

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

| ID | Archetype | Purpose |
|---|---|---|
| `builder-classic` | Builder | Standard Builder — investment-focused spending |
| `fortress-saver` | Fortress | Thrifty, foundation-heavy |
| `truth-teller-balanced` | Truth Teller | Balanced across quadrants |
| `drifter-expat` | Drifter | Lewis-style expat, EUR, high dining/subs |
| `anchor-debt` | Anchor | Debt-heavy burden profile |
| `skip-value-map` | — | User skips Value Map (asserts auto-skip logic) |
| `skip-csv-upload` | Builder | User skips CSV upload (asserts auto-skip logic) |
| `time-saver-expert` | Builder | Advice-averse high-income expert |

## See also

Spec: `docs/superpowers/specs/2026-04-20-onboarding-test-suite-design.md`
Plan: `docs/superpowers/plans/2026-04-20-onboarding-test-suite.md`
