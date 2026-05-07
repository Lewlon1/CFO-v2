# Onboarding Test Suite — Design

**Date:** 2026-04-20
**Author:** Lewis + CFO (Claude)
**Status:** Design — awaiting user review

## Purpose

Build an on-demand automated test suite that exercises the **post-signup onboarding flow** (`OnboardingModal` + `/api/onboarding/*`) across a curated set of user personas. The suite must:

1. **Catch functional bugs** — broken buttons, failed API calls, wrong DB state, flow-control regressions (e.g. skipping archetype beat when Value Map was skipped).
2. **Grade LLM output quality** — does the generated archetype make sense for the persona? Is the first insight on-brand and grounded in the user's actual transactions? Does the CFO persona violate banned-word rules?
3. **Surface UX/visual regressions** — capture screenshots at key beats so a human can eyeball rendering changes per persona.

Failure modes we expect to find: the CFO over-advising users who want automation, numbers hallucinated in insight narration, archetype cards breaking on certain personality types, flow-skip logic broken when users decline steps, copy regressions when beats are edited.

## Scope

**In scope:**
- `src/components/onboarding/**` — OnboardingModal, beats, reactions
- `src/app/api/onboarding/**` — progress, complete, generate-archetype, generate-insight, csv-status
- `src/hooks/useOnboarding.ts` — the reducer-driven state machine
- `src/lib/onboarding/**` — types, constants, profile-seeder, archetype-prompt
- `src/lib/value-map/personalities.ts` — `calculatePersonality` logic
- CSV upload path (`/api/upload`) as it's triggered inside onboarding
- Post-handoff DB state (profile, financial_portrait, transactions, onboarding_progress rows)

**Out of scope (future suites):**
- Pre-signup `/demo` and `/value-map` public flows
- First CFO chat conversation after handoff
- Monthly reviews, scenario planning, nudges
- Profile editing, data export
- Multi-user / couples flows (product doesn't support)

## Design Principles

1. **On-demand, not CI-gated** — suite runs via `npm run test:onboarding`. Not on every push. Teams can add CI later.
2. **Real stack, not mocks** — hits CFO Staging Supabase and real Bedrock. Mocking Bedrock would defeat the LLM-quality purpose. Cost per full run ≈ $0.05 — trivial.
3. **Per-persona isolation** — each persona runs as its own throwaway Supabase Auth user. Teardown deletes users and cascades via FK. `--keep-users` flag for debug.
4. **Human-in-the-loop for visuals** — screenshots saved as artifacts, no pixel-diff automation. "Opportunities for improvement" surface as visual samples a human reviews.
5. **Hard rules fail loudly, Likert scores trend** — binary rule violations (banned words, wrong quadrant, missing CSV references) fail the persona. Likert scores are informational until ≥10 runs establish a baseline.

## Architecture

### Run flow

```
$ npm run test:onboarding [-- --personas id1,id2] [--skip-judge] [--keep-users] [--concurrency N]

1. Preflight
   - Verify CFO Staging env vars present (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AWS_*)
   - Refuse to run if URL points at production project (hard guard)
   - Ensure dev server on :3000 (spawn if not; kill at end)
   - Run Vitest unit tests first; abort on any failure

2. Per persona (parallel, default concurrency 2)
   a. Create throwaway auth user via Supabase admin API
   b. Launch Playwright context, sign in as that user, land on /office
   c. Drive OnboardingModal through all beats per persona script:
      - Scripted Value Map responses (or skip)
      - File upload of persona CSV (or skip)
      - Capability selection
      - Click through to handoff
   d. Capture at each beat:
      - Screenshot (test-output/<run-id>/<persona>/<beat>.png)
      - Network responses (archetype JSON, insight JSON, progress state)
   e. Functional assertions:
      - Beat completion order matches expected
      - DB state post-handoff matches expected shape
      - No console errors
   f. LLM judge on archetype + insight (skip layer with --skip-judge)

3. Teardown
   - Delete test users + auth rows (unless --keep-users)
   - Cascade: onboarding_progress, user_profiles, financial_portrait,
     transactions, import_batches, value_map_results

4. Report
   - test-output/<run-id>/report.html — openable, all personas × all layers
   - test-output/<run-id>/summary.json — machine-readable
   - CLI exit code: 0 if all hard checks pass, 1 if any fail
```

### Key design decisions

| Decision | Choice | Why |
|---|---|---|
| Browser or API | Full Playwright UI driving | Only way to catch OnboardingModal's client-side orchestration bugs (dwell timers, upload-in-flight gating, reactions) |
| Backing services | Real staging Supabase + real Bedrock | LLM quality evals require real calls; RLS/migrations need real DB |
| Parallelism | 2 concurrent personas | Bedrock throttling safety; override via `--concurrency` |
| Judge model | Haiku 4.5 (utilityModel) | 4× cheaper than Sonnet, decoupled from model-under-test |
| Visual approach | Screenshots-as-artifacts | Catches real changes without pixel-diff flakiness; human-reviewed |
| Teardown | Auto-delete, opt-in keep | Keeps staging DB clean; `--keep-users` for debug |
| Test user emails | `test-onboarding-<persona>-<run-id>@cfo-test.local` | Identifiable in staging DB; easy bulk-cleanup if a run crashes |
| Concurrency safety | Per-persona dedicated Playwright context | No shared state; suite can run while dev works in another tab |
| Production guard | Refuse to run if URL contains prod project ref | Uses current memory entry (qlbhvlssksnrhsleadzn is staging) |

## Personas

Eight curated personas — one per money personality archetype, plus two skip-path personas, plus one "advice-averse" persona:

| # | ID | Archetype | Persona description |
|---|---|---|---|
| 1 | `builder-classic` | Builder | UK professional, £3.2k/mo salary, healthy dining + gym + courses. Revolut GBP. Clean Builder case (investment ≥35%). |
| 2 | `fortress-saver` | Fortress | Thrifty, cautious. Rent + groceries dominate, minimal discretionary. Generic CSV GBP. Foundation ≥50%. |
| 3 | `truth-teller-balanced` | Truth Teller | Balanced across quadrants, no threshold tripped. Tests the default archetype path. Revolut GBP. |
| 4 | `drifter-expat` | Drifter | Lewis-style expat. EUR, Barcelona, Santander XLSX, bi-monthly gas, UK student loan on statement, high dining. **Highest-signal persona** — exercises Santander parser, non-GBP, Drifter archetype. |
| 5 | `anchor-debt` | Anchor | Heavy debt servicing, loan repayments, burden ≥30%. Generic CSV GBP. Tone check under financial pressure. |
| 6 | `skip-value-map` | — | Skips Value Map at first opportunity. Asserts flow skips `archetype` beat. Tests minimal-engagement path. |
| 7 | `skip-csv-upload` | Builder | Completes Value Map, skips CSV upload. Asserts flow skips `first_insight` beat. |
| 8 | `time-saver-expert` | Builder | High-income finance professional. Already maxes ISA/SIPP, has a strategy. **Wants automation, not advice.** Tests the CFO's failure mode of over-advising sophisticated users. |

### Persona module shape

Each persona is a single TypeScript module at `tests/onboarding/personas/<id>.ts`:

```ts
export const drifterExpat: Persona = {
  id: 'drifter-expat',
  label: 'The Drifter — Expat',

  // Written to user_profiles after signup
  profile: {
    displayName: 'Marta',
    country: 'ES',
    city: 'Barcelona',
    currency: 'EUR',
  },

  // Scripted taps — 10 entries matching SAMPLE_TRANSACTIONS order.
  // Engineered to produce the target archetype per calculatePersonality thresholds.
  valueMapResponses: [
    { cardId: 'vm-rent', quadrant: 'burden', confidence: 4, firstTapMs: 1500, cardTimeMs: 2100, deliberationMs: 600, hardToDecide: false },
    // ... 9 more
  ],

  // CSV uploaded during csv_upload beat.
  // Base64 inline per Q7 decision A (everything in one file).
  // ~60-120 transactions across 3 months.
  csv: {
    filename: 'santander-marta-jan-mar-2026.xlsx',
    contentBase64: '...',
    expectedBank: 'santander',
  },

  // Beat skip behaviour. [] = run full flow.
  // ['value_map'] = user skips Value Map (reducer auto-skips archetype downstream).
  // ['csv_upload'] = user skips CSV upload (reducer auto-skips first_insight).
  // Concrete values per persona:
  //   builder-classic, fortress-saver, truth-teller-balanced, drifter-expat,
  //   anchor-debt, time-saver-expert:        skipBeats: []
  //   skip-value-map:                        skipBeats: ['value_map', 'csv_upload']
  //   skip-csv-upload:                       skipBeats: ['csv_upload']
  skipBeats: [],

  expectations: {
    // Functional layer
    archetype: {
      expectedQuadrant: 'leak',
      personalityId: 'drifter',
    },
    beatsCompleted: ['welcome', 'framework', 'value_map', 'archetype', 'csv_upload', 'capabilities', 'first_insight', 'handoff'],
    beatsSkipped: [],
    dbAfterHandoff: {
      user_profiles: { primary_currency: 'EUR', country: 'Spain' },
      financial_portrait: {
        archetype_name: 'exists',
        dominant_value_quadrant: 'leak',
      },
      transactions: { countBetween: [70, 120] },
      onboarding_progress: { onboarding_completed_at: 'not-null' },
    },

    // LLM-judge hard rules (binary, fail-the-persona)
    hardRules: {
      bannedWords: ['advise', 'advice', "The CFO's Office", 'lecture'],
      archetype: {
        mustReferenceQuadrant: 'leak',
        mustMentionOneOf: ['impulse', 'drift', 'leak', 'habit', 'small'],
      },
      insight: {
        mustReferenceMerchantsFromCsv: ['dining', 'delivery'],
        numbersMustMatchCsv: true,
      },
    },

    // LLM-judge Likert dimensions (scored 1-5, trended, no fail threshold initially)
    likertDimensions: ['warmth', 'accuracy', 'on_brand_voice', 'persona_fit', 'actionability'],
  },
}
```

### Per-persona hard-rule specialisation

Key persona-specific rules beyond the global banned-word set:

**`time-saver-expert`** — the most important custom rules:
```ts
bannedPatterns: [
  /you (should|could|might want to) (invest|save|allocate|consider)/i,
  /have you thought about/i,
  /(an ISA|compound interest|diversification) (is|means)/i,
],
insightMustReferenceOneOf: [
  'track', 'watch', 'flag', 'automate', 'monitor', 'tell you when',
  'subscription', 'bill', 'change',
],
archetypeMustAcknowledgeOneOf: [
  'have a plan', 'know what you', 'clear', 'intentional', 'in control',
  'system already', 'dialled in',
],
```

**`anchor-debt`** — tone check under pressure:
```ts
bannedPatterns: [
  /just (need|have) to|simply/i,       // dismissive
  /discipline|willpower/i,              // finger-wagging
],
insightMustReferenceOneOf: [
  'debt', 'refinance', 'reduce', 'priority', 'order'
],
```

**`skip-value-map`, `skip-csv-upload`** — no LLM judge (nothing generated for those beats). Functional-only.

## LLM Judge

### Model

Claude Haiku 4.5 via Bedrock — `utilityModel` in existing config. Cheaper, faster, fine for classification-style grading.

### Prompt shape

One call per captured output (2 per persona for most: archetype, insight).

```
You are grading output from "your CFO" — a personal-finance AI in The CFO's Office.

<persona>
  id: drifter-expat
  description: Drifter — impulse spending, subscription drift. Barcelona expat, EUR. Eats out 4x/week.
  dominant_quadrant: leak
</persona>

<cfo_output_type>archetype</cfo_output_type>

<cfo_output>
{ archetype_name, archetype_subtitle, traits, certainty_areas, conflict_areas }
</cfo_output>

<source_csv_summary>
3 months, 287 transactions, €X total.
Top merchants: Glovo €340, Deliveroo €210, Netflix €14, ...
Recurring active: Netflix, Spotify, DIR Gym (no check-ins 6wks)
</source_csv_summary>

HARD RULES — return true/false for each:
- R1_no_banned_words: output contains none of: "advise", "advice", "The CFO's Office", "lecture"
- R2_references_dominant_quadrant: narrative references "leak" theme
- R3_mentions_expected_topic: mentions at least one of [dining, delivery, subscriptions]
- R4_numbers_match_csv: every numeric figure quoted exists in source_csv_summary
- R5_warm_tone: tone is warm/conversational, not condescending

LIKERT — 1-5 scores with one-sentence justification:
- L1_warmth: smart friend vs lecture
- L2_accuracy: grounded in source data
- L3_on_brand: matches CFO persona (no jargon, no "advice", uses tangible comparisons)
- L4_persona_fit: written for this user specifically, not generic
- L5_actionability: points toward insight or action, not vague

Return JSON only:
{
  "hardRules": { "R1_no_banned_words": true, ... },
  "likert": { "L1_warmth": { "score": 4, "reason": "..." }, ... }
}
```

### Grading behaviour

- Any hard rule = `false` → persona's LLM layer fails (red ❌ in report)
- Likert scores stored in `summary.json`, surfaced in report; no fail threshold until baseline established (~10 runs)
- Judge model ID + timestamp logged per output for drift tracking
- Raw judge output saved at `captured/<persona>/judge-<output-type>.json` for audit

## Unit Tests (Vitest)

Pure-logic tests that run before any Playwright persona spins up. Fast (~1s total), fail the suite early.

**Coverage targets:**

1. **`calculatePersonality` deterministic assertions** — for each persona's scripted Value Map responses, assert the calculated personality matches `expectations.archetype.personalityId`. Catches accidental breakage of threshold logic.

2. **`seedFromOnboarding` idempotency + shape** — seeding with the same data twice doesn't duplicate rows; all expected `financial_portrait` keys land.

3. **Beat-skip reducer logic** — the `useOnboarding` reducer's `COMPLETE_BEAT` handler with `skipBeats` behaves correctly (skipping `value_map` triggers skipping `archetype`; skipping `csv_upload` triggers skipping `first_insight`).

## File Structure

```
cfos-office/
├── tests/
│   └── onboarding/
│       ├── README.md                          # How to run, debug, add personas
│       ├── personas/
│       │   ├── index.ts                       # Export registry
│       │   ├── types.ts                       # Persona type definition
│       │   ├── builder-classic.ts
│       │   ├── fortress-saver.ts
│       │   ├── truth-teller-balanced.ts
│       │   ├── drifter-expat.ts
│       │   ├── anchor-debt.ts
│       │   ├── skip-value-map.ts
│       │   ├── skip-csv-upload.ts
│       │   └── time-saver-expert.ts
│       ├── runner/
│       │   ├── cli.ts                         # npm run test:onboarding entry
│       │   ├── preflight.ts                   # env checks, dev server spawn
│       │   ├── user-factory.ts                # Create/teardown throwaway users
│       │   ├── persona-runner.ts              # Orchestrate one persona run
│       │   ├── playwright-driver.ts           # UI interactions per beat
│       │   ├── db-assertions.ts               # Post-handoff state checks
│       │   ├── judge.ts                       # LLM-judge prompt + call
│       │   ├── csv-summariser.ts              # Summarise CSV for judge context
│       │   └── reporter.ts                    # HTML + JSON report generation
│       └── unit/
│           ├── calculate-personality.test.ts
│           ├── seed-from-onboarding.test.ts
│           └── beat-skip-reducer.test.ts
├── test-output/                               # Gitignored; per-run artifacts
│   └── <run-id>/
│       ├── report.html
│       ├── summary.json
│       ├── preflight.log
│       └── <persona-id>/
│           ├── welcome.png
│           ├── framework.png
│           ├── value_map.png
│           ├── archetype.png
│           ├── csv_upload.png
│           ├── capabilities.png
│           ├── first_insight.png
│           ├── handoff.png
│           ├── captured/
│           │   ├── archetype.json
│           │   ├── insight.json
│           │   ├── judge-archetype.json
│           │   ├── judge-insight.json
│           │   └── db-state-after-handoff.json
│           └── console-errors.log
└── package.json
    └── scripts:
        - "test:onboarding": "tsx tests/onboarding/runner/cli.ts"
```

## CLI flags

| Flag | Purpose |
|---|---|
| `--personas id1,id2` | Run only specified personas |
| `--skip-judge` | Skip LLM judge calls (functional + screenshots only) |
| `--keep-users` | Don't delete test users after run (for manual DB inspection) |
| `--concurrency N` | Override default 2 |
| `--no-unit` | Skip Vitest preflight (not recommended) |
| `--run-id name` | Custom run-id for output folder (default: ISO timestamp) |

## Report format

### CLI summary (always printed)

```
Onboarding Test Suite — run 2026-04-20T14-23-15
─────────────────────────────────────────────────────────────────────
Preflight:       ✓ env      ✓ unit tests (12)    ✓ dev server
─────────────────────────────────────────────────────────────────────
Persona                        Functional  LLM   Visual   Time
─────────────────────────────────────────────────────────────────────
builder-classic                ✓           ✓     ✓        1m42s
fortress-saver                 ✓           ✓     ✓        1m51s
truth-teller-balanced          ✓           ✓     ✓        1m48s
drifter-expat                  ✓           ✗     ✓        2m15s   ← R3 failed: insight didn't mention delivery
anchor-debt                    ✓           ✓     ✓        1m55s
skip-value-map                 ✓           —     ✓        0m48s
skip-csv-upload                ✓           —     ✓        1m22s
time-saver-expert              ✓           ✗     ✓        2m08s   ← R1 failed: contained "you should invest"
─────────────────────────────────────────────────────────────────────
Likert means (across 6 LLM-tested personas):
  warmth 4.2    accuracy 4.1    on_brand 3.8    persona_fit 4.0    actionability 3.9
─────────────────────────────────────────────────────────────────────
Report: file:///.../test-output/2026-04-20T14-23-15/report.html
Exit: 1 (2 persona LLM failures)
```

### HTML report

Per-persona cards showing:
- Pass/fail badges per layer
- Screenshot gallery by beat (click to enlarge)
- Raw archetype + insight JSON
- Judge verdicts with per-rule pass/fail and Likert justifications
- DB-state JSON captured post-handoff
- Console error log

## Safety guards

- **Production guard:** `cli.ts` refuses to run unless `NEXT_PUBLIC_SUPABASE_URL` includes the **staging** project ref (`qlbhvlssksnrhsleadzn` per memory). Allowlist-based, not denylist — fails closed if env points anywhere unexpected. The detected project ref is printed so the user can verify.
- **Bedrock spend cap:** per-run hard cap of $1 (~20× a normal run). Judge calls are metered; runner aborts + reports if cap hit.
- **Email namespace:** all test emails use `@cfo-test.local` domain. Teardown queries match on this domain as a safety net so human users are never touched.
- **Teardown-on-crash:** runner wraps persona loop in try/finally; crashes still delete users.

## What we are not testing (YAGNI, documented so we don't pretend otherwise)

- Multi-user / couples onboarding (product doesn't support)
- Non-English UI (product is English-only)
- Signup/auth flow itself — suite creates users via admin API, doesn't drive the signup UI
- Background pg_cron / edge functions — those run async post-handoff
- CSV parsing correctness beyond what the 8 personas exercise — unit tests for parsers live elsewhere
- Actual Bedrock throttling or outage behaviour — assumes Bedrock healthy
- Accessibility audit — worth doing separately with axe-playwright eventually
- Pixel-perfect visual regression — deliberately chose human-reviewed screenshots

## Tradeoffs

- **Runtime ~10-15 min for full suite.** Acceptable for on-demand; painful for CI. `--personas` flag mitigates during development.
- **Staging DB noise.** Failed teardowns leave orphan users. Mitigated by email namespace + periodic cleanup script (not part of this suite).
- **LLM judge drift.** Judge scores will shift when Haiku updates. Logging model ID + timestamp makes this investigable but not preventable.
- **Screenshots are subjective.** No automation will tell you "the archetype card looks bad now." A human still reviews.
- **Prompt changes can cascade.** A prompt tweak can fail 6/8 persona LLM layers at once. That's the point — the suite *is* the feedback loop for prompt iteration.

## Success criteria for the suite itself

- A clean `npm run test:onboarding` completes in under 15 min, deletes its test users, and produces an HTML report.
- Running with `--personas drifter-expat` completes a single persona in under 3 min.
- All 8 personas pass functional + LLM + visual layers on current `main`. If any fail on first run, those failures are **real bugs** — document them and fix before declaring the suite baseline-clean.
- Adding a 9th persona requires writing one new TypeScript file and no runner changes.
