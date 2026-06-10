# Test Plan — The CFO's Office

_Last updated: 2026-06-06. Owner: engineering. Scope: the `cfos-office/` Next.js app._

This document inventories the testing tools that exist, maps coverage gaps, and defines the
target test strategy. It is the reference for "how do we test this" and "what should I add."

---

## 1. Tooling inventory (what exists today)

### Automated, fast — no external deps (run on every PR via CI)
| Tool | Command | Covers | Notes |
|---|---|---|---|
| **Vitest 4** | `npm test` / `npm run test:watch` | Pure logic + light integration. ~1,100 tests / ~100 files, <3s. | `environment: 'node'` ([`vitest.config.ts`](../../vitest.config.ts)) — **no jsdom / Testing-Library**, so no DOM rendering. DB-touching code is tested with hand-rolled Supabase stubs (see `reconcile-fixed-costs.test.ts`, `compute-goal-pace.test.ts`). |
| **tsc** | `npm run typecheck` | Full type safety (`--noEmit`) | — |
| **ESLint 9** (flat) | `npm run lint` | Next rules + `cfo/visual-token-guards` (hardcoded colour/radius bans, `src/**`) | A banned colour/radius literal is an **error → CI failure**. |
| **knip** | `npm run knip` | Unused files / dependencies | `exports`/`types`/`duplicates` relaxed (Audit-Zero false positives). |

CI: [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) runs `npm ci → typecheck → lint → knip → test` on every push to `main` and every PR. Hermetic — no secrets.

### Automated, heavy — need Staging Supabase + Bedrock + port 3000 (on-demand / nightly)
| Tool | Command | What it is |
|---|---|---|
| **Onboarding e2e runner** (custom Playwright) | `npm run test:onboarding` | Drives curated personas through the real UI in a browser, auto-starts the dev server, makes **DB-state assertions** (`tests/onboarding/runner/db-assertions.ts`), runs an **LLM judge** on first-read quality (`judge.ts` + `judge-first-insight.ts`, via `@/lib/ai/read-judge`), emits `report.html` + screenshots to `tests/onboarding/test-output/`. Flags: `--personas`, `--skip-judge`, `--keep-users`, `--concurrency`, `--run-id`. **Requires `.env.local` → Staging (`qlbhvlssksnrhsleadzn`)**. |
| **Prompt/quality eval harness** | `scripts/eval/*` (`rate`, `tournament`, `calibrate`, `promote`, `diagnose`) + `npm run test:prompts`, `verify-first-insight`, `compare-first-insight`, `run-personas-v2` | LLM-output rating / tournament / calibration for prompt iteration. The gate to run **before any system-prompt change**. |
| **Tool tests** | `tsx scripts/test-tools.ts` | Exercises the Claude function-calling tools end-to-end. |
| **Seeding / diagnostics** | `npm run seed:test-user`, `npm run parse:diagnose`, `scripts/reextract-portrait.ts`, `scripts/show-shape-and-posture.ts` | Fixtures + ad-hoc diagnostics. |

### Dev-loop tools (local / this environment)
- **Supabase Staging** (`qlbhvlssksnrhsleadzn`) via `execute_sql` — DB-state assertions during development.
- **Playwright MCP / Preview MCP** — drive a browser / dev server for manual verification.
- **`/styleguide`** (dev-only, `notFound()` in prod) — manual visual-regression surface for every primitive in both themes. **Not automated.**

---

## 2. Gap map (honest)

1. ~~No CI~~ — **fixed**: `.github/workflows/ci.yml` now enforces the fast gates on every PR.
2. **No component / interaction tests** — node env means the `Select` primitive, chat UI, dashboard, etc. have **no** unit-level rendering coverage; only the e2e runner exercises them in a real browser.
3. **No coverage measurement** configured.
4. **No automated a11y / visual regression** (`/styleguide` is eyeball-only).
5. **e2e flow drift** — the onboarding runner historically drove the pre-value-first flow (value-map → upload → archetype). Being refreshed to the live value-first in-sheet beats (see §5).
6. **No `buildSystemPrompt` integration harness** — prompt *wiring* bugs (a section omitted from a branch) are invisible to unit tests today.

---

## 3. The plan, by layer (testing pyramid)

### Layer 1 — Unit (Vitest, fast, every commit)
Load-bearing for "the system computes, the LLM never does." Target: **all financial math, categorisation, and prompt-assembly logic is pure and unit-tested.**

| Area | Type | Example cases | Target |
|---|---|---|---|
| Fixed-cost reconcile (`lib/analytics/reconcile-fixed-costs.ts`) | pure | rent included; dismissed excluded; case-dedup; cadence aliases; declared↔detected dedup | all branches |
| Budget / pace / debt / pension / emergency-fund (`lib/ai/tools/*`, `lib/goals/*`, `lib/finance/*`) | pure | surplus = income−fixed−discretionary; goal pace; compound bands | all branches |
| Categorisation + value resolution (`lib/categorisation/*`, `lib/prediction/predictor.ts`) | pure | rules-engine matches; tier ladder; judgmental default → unsure | all tiers |
| Value breakdown (`lib/ai/tools/get-value-breakdown.ts`) | pure | confidence-gated bucketing | done ✓ |
| Parsers (`lib/parsers/*`) | table-driven | locale decimals, Spanish bi/tri-monthly billing, malformed rows | each format + edge rows |
| Prompt builders (`lib/ai/context-builder.ts`) | string-assertion | section presence/absence per conversation type | each branch |
| Validators / sanitiser (`lib/ai/insight-validator.ts`, `persona-sanitiser.ts`) | pure | citation/projection/voice/length; `stripValidatorNote` round-trip | done ✓ |

**New gap to close:** a `buildSystemPrompt` test harness (table-aware Supabase stub) so prompt *wiring* is testable — the class of bug (a goals section omitted from the `first_read` branch) that unit tests currently can't catch.

### Layer 2 — Integration (Vitest + stubs)
- **Tool executors** end-to-end with stubbed Supabase (pattern in `reconcile`/`compute-goal-pace` tests): correct shape, missing-data handling, never divides-by-LLM.
- **Upload pipeline** (`lib/upload/pipeline.ts`): CSV → parse → categorise → persist → snapshot; **idempotency** (re-upload must not double-count).
- **Onboarding step machine**: `advanceStep` transitions + the one-way `onboarding_completed_at` ratchet + both completion paths (`lib/onboarding/markComplete.ts`).
- **API routes** (chat / upload / insights): auth, validation, RLS scoping.

### Layer 3 — E2e (onboarding runner, on-demand / nightly)
Persona-driven, real browser, DB + LLM-judge assertions. Kept current with the value-first flow and the regression invariants in §4. See §5 for the refresh.

### Layer 4 — LLM quality eval (eval harness, pre-prompt-change)
`scripts/eval` (`rate`/`tournament`/`calibrate`) as the gate before any system-prompt edit: grounded-numbers rate, banned-phrase rate, goal-awareness, voice. Track a scorecard over time.

---

## 4. Risk-area matrix (product-specific)

| Risk | Why it matters here | Primary layer | Status |
|---|---|---|---|
| **Financial correctness** | A wrong number kills trust on first impression | Unit + integration | strong |
| **LLM grounding** (no invented numbers/goals/notes) | The recent critical bugs were all this class | Validator unit + e2e judge | improving |
| **Data integrity** (dedup, dual-categorisation, idempotent upload) | Inflated fixed costs / leaks | Unit + integration | partial |
| **Onboarding completion** | Stranded users | Integration (step machine) | gap |
| **Multi-currency / locale** | EUR/GBP, Spanish billing | Unit (parsers/formatters) + e2e persona | partial |
| **RLS / privacy / anonymisation** | Cross-user data leak | Integration (RLS) | **untested** |

---

## 5. Regression set — the 6 onboarding/first-read fixes (lock them in)

Unit coverage landed with each fix. Remaining work is the **e2e assertions** so they can't
regress through the UI (added during the e2e refresh):

| # | Fix | Unit | E2e invariant to assert |
|---|---|---|---|
| 1 | First-read sees the goal; `compute_goal_pace` needs no UUID | ✓ | first_read text never contains `/no (active )?goal/i`; goal row persists |
| 2 | No `_(System note: …)_` leak / echo | ✓ | no `messages.content` matches `/_\(System note:/`; judge banned-phrase |
| 3 | Budget fixed costs incl. rent + case-dedup | ✓ | `recurring_expenses` has no `lower(name)` dups; reconciled total ≥ rent |
| 4 | Unsorted spend not reported as Leak | ✓ | dining-heavy persona → breakdown surfaces `uncategorised`, not 100% leak |
| 5 | Cluster summary uses user currency + positive magnitude | ✓ | EUR persona → summary uses `€`, never `£`, no negative sign |

---

## 6. Priorities

1. ~~Wire CI fast gates~~ — **done**.
2. **`buildSystemPrompt` test harness** (closes the prompt-wiring gap).
3. **E2e refresh** to the value-first flow + the §5 invariants.
4. **Component tests** — add `@testing-library/react` + jsdom for the `Select` primitive and key chat/dashboard interactions (or document e2e-only).
5. **Coverage** — `vitest --coverage` with a floor on `lib/analytics`, `lib/ai`, `lib/prediction`.
6. **(Later)** nightly secrets-gated e2e/eval CI job; automated a11y/visual-regression.
