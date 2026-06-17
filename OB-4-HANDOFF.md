# OB-4 Handoff — Repoint the persona harness at the estimates-first flow

Self-contained plan for a fresh session. Branch `claude/nifty-carson-4jzdl2`
(or cut a new branch off it). Delete this file in OB-5.

## Where things stand

- **OB-1 → OB-3** shipped on this branch (PR #70, draft, base `main`): the
  **estimates-first onboarding** is the default — chat-first beats (door →
  context → composite → goal → income → sketch → verdicts) → **estimate Read**
  (stamps completion *before any upload*) → optional **statement-check mission**
  (upload → processing → confirm) → **reality-check Read** (estimate-vs-reality
  deltas) → converges into the VM-3 → recompose arc.
- **The problem OB-4 fixes:** the Playwright **persona harness**
  (`cfos-office/tests/onboarding/`) still drives the **legacy value-first flow**
  (`struggle → goal → upload → essentials → confirm → first_read`). It no longer
  exercises the live default. Baselines (`baselines/main-2026-06-12/`), the
  driver, the personas, the stage enum, and the DB assertions are all legacy.
  The estimate Read and reality-check Read are completely uncovered E2E.

**OB-4 = repoint the harness at the estimates-first flow** and add coverage for
the statement-check → reality-check path. No product code changes (except one
small judge allow-list fix, below). No migration.

## ⚠️ The harness is excluded from Claude Code auto-discovery

`.claude/settings.json` denies globbing `tests/onboarding/**` to save context. You
MUST `Read` each harness file explicitly (deny only blocks auto-glob; explicit
reads work). Phase-0 reads are listed at the bottom.

## The live flow + the selector map (the gold — every beat has a stable testid)

Sign in → fresh user lands at `/office`, the chat sheet auto-opens
(`initialSheetOpen` because `needsEstimateOnboarding`), and `ChatSheet` renders
`EstimateBeatHost` (NOT the legacy `OnboardingBeatHost`). Beats advance by
`onboarding_step` via `router.refresh()` — no URL changes. Selectors confirmed in
`src/components/onboarding-v2/in-sheet/estimate/*`:

| Step (`onboarding_step`) | Beat | Drive it via |
|---|---|---|
| `estimate_door` | DoorBeatBlock | name `[data-testid="door-name-input"]`; pick `[data-testid="door-chip-<family>"]` (families: `growth\|security\|agency\|candor` — map from persona via `struggleToFamily`, see `door/door-config.ts`) **or** type `[data-testid="door-freetext"]`; `[data-testid="door-continue"]`; then a reflection beat → `[data-testid="door-reflection-continue"]` |
| `estimate_context` | ContextBeatBlock | `[data-testid="context-country-<GB\|ES>"]`, `[data-testid="context-age-<band>"]`, `[data-testid="context-continue"]` |
| `estimate_composite` | CompositeBeatBlock | `[data-testid="composite-relate-<spot_on\|close\|not_me>"]`; optional `[data-testid="composite-repick-<family>"]`, `[data-testid="composite-truer-line"]`; `[data-testid="composite-continue"]` |
| `estimate_goal` | GoalBeatBlock | `[data-testid="goal-deadline-<id>"]`; optional `[data-testid="goal-show-alts"]` + `[data-testid="goal-alt-<family>"]`; `[data-testid="goal-continue"]` |
| `estimate_income` | IncomeBeatBlock | `[data-testid="income-input"]` → `[data-testid="income-continue"]` → pace screen → `[data-testid="income-pace-continue"]` |
| `estimate_sketch` | SketchBeatBlock | five bands: `[data-testid="sketch-<key>-<bandId>"]` where key ∈ `housing\|subs\|bills\|foodOut\|saveReach`; band ids per `estimates/bands.ts` (housing `a\|b\|c\|d`, subs `low\|mid\|high`, bills `a\|b\|c`, foodOut `a\|b\|c`, saveReach `a\|b\|c\|d`); `[data-testid="sketch-continue"]` |
| `estimate_verdicts` | VerdictsBeatBlock | optional top-value `[data-testid="verdict-value-<value>"]`; per-row `[data-testid="verdict-<row.key>-<opt.id>"]`; `[data-testid="verdicts-continue"]` |
| `estimate_read_pending` | (compose) | EstimateBeatHost POSTs `/api/insights/estimate-read`, stamps `first_read_delivered` (completion), loads the Read into the sheet. **Poll the messages table** for the first assistant message (reuse `pollFirstAssistantMessage(..., 'first_read')`). |

**Estimate Read close** → `[CTA:start_statement_check]` renders
`StatementCheckActionButton` (button text "Check my numbers against a real
month") → `advanceStep('check_upload_pending')`. The optional statement-check
mission (hosted by `OnboardingBeatHost`, the legacy host):

| Step | Beat | Drive it via |
|---|---|---|
| `check_upload_pending` | UploadBeatBlock `mode="check"` (no goal bridge) | `input[type="file"]` (set the persona CSV) |
| `check_processing` | CheckProcessingBeatBlock | **auto-advances** (~3.2s, no interaction) → `check_confirm_pending` |
| `check_confirm_pending` | ConfirmBeatBlock `mode="check"` | `button:has-text("Looks right — check it against my sketch")` → `confirmFixedCosts({mode:'check'})` → `check_confirm_done` |
| `check_confirm_done` | (compose) | OnboardingBeatHost POSTs `/api/insights/reality-check`, appends the reality-check Read to the SAME estimate-read conversation, stamps `reality_check_delivered`. **Poll for the SECOND assistant message** on that conversation. |

**Reality-check Read close** → `[CTA:start_value_map_real]` →
`ValueMapActionButton variant="real"` (text "Value-map these so I learn what your
spending really means") → `/onboarding-v2/value-map?hook=1` (VM territory — OB-4
can stop at the reality-check Read; covering the VM recompose is optional/stretch).

## Files to change

1. **`runner/playwright-driver.ts`** — the core rewrite. Replace `runOnboarding`'s
   legacy walk (struggle/goal-fast-forward/upload/essentials/confirm) with the
   estimates-first walk above. Notes:
   - **No goal fast-forward.** The estimate goal beat is a normal in-sheet beat
     (`goal-continue`), not the 90s-gated goal-chat. Delete `fastForwardGoalBeat`
     usage; tap the beat instead. (The goal is captured by the beat; if a persona
     needs a seeded goal row for goal-aware assertions, the goal beat writes it.)
   - `signIn` already lands at `/office`; change the first wait from
     `text=/what brought you in/i` to a door-beat selector (`[data-testid="door-continue"]`).
   - Keep the DB-poll capture pattern (`pollFirstAssistantMessage`) — reuse it for
     BOTH the estimate Read (`first_read`, 1st assistant msg) and the reality-check
     Read (2nd assistant msg on the same conversation).
   - Keep `driveStage` + screenshots; just change the stage list.
2. **`personas/types.ts`** — extend `Persona`/`PersonaExpectations` for the new
   flow: door family (or derive from `entryStruggle` via `struggleToFamily`),
   `ageBand`, `compositeRelate`, the five **sketch band ids**, optional
   `topValue`, the three **verdicts** (`subscriptions`/`food_out`/`drift` →
   `worth_it`/`leak`/`unsure`), and a `runStatementCheck: boolean` flag (whether
   the persona walks the optional reality-check). Add the new `OnboardingStage`
   values (see #4).
3. **`personas/*.ts` + `personas/index.ts`** — convert the 10 personas to the new
   shape (band picks + verdicts + age + relate). Keep the spread of archetypes.
   At least 2-3 personas should set `runStatementCheck: true` (with a CSV) to
   cover the reality-check; the rest stop at the estimate Read.
4. **`runner/types.ts`** — replace the `OnboardingStage` union with the
   estimates-first stages: `door_done → context_done → composite_done →
   goal_done → income_done → sketch_done → verdicts_done → estimate_read`
   (+ optional `check_upload_done → check_confirm_done → reality_check`).
5. **`runner/judge.ts`** — **CONCRETE BUG:** `ALLOWED_CTA_TYPES` (line ~140) is
   `['supply_input','set_goal','start_value_map_real','cut_lever']` — it does NOT
   include `start_statement_check`, so judging the estimate Read fails R8. Add
   `start_statement_check`. Also: the judge calls `checkReadHardRules(content,
   {mode:'default'})`; that's fine for both new Reads (H1 signoff, H2 ≤250 words,
   H3 one CTA, H5 no question close, H6 no emoji, H7 voice all apply). Consider an
   `outputType`-aware tweak if you want estimate-Read-specific rules (e.g. assert
   the `≈` convention, or that no merchant/date is invented in the estimate Read).
6. **`runner/db-assertions.ts`** — `snapshotDbState` should also snapshot
   `onboarding_estimates` (bands, `verdicts`, `derived`, `verification`). Add
   estimates-first invariants: terminal `onboarding_step='first_read_delivered'` +
   `onboarding_completed_at` set for non-check personas; `reality_check_delivered`
   + `onboarding_estimates.verification` populated (engine_version `v1`, ≥1
   `verified` band) for check personas.
7. **`runner/persona-runner.ts` + `reporter.ts`** — follow the renamed stages /
   capture points (estimate Read + reality-check Read). Mostly mechanical.
8. **`fixtures/reads/*` + `baselines/`** — the captured Reads + baseline
   screenshots are legacy value-first. **Re-capture** against the estimates-first
   flow (run the suite with `--keep-users` once it's green, then snapshot a new
   `baselines/main-<date>/`). The `bad-*.txt` fixtures (hallucination/voice
   regression cases) stay valid — they test the judge, not the flow.
9. **`unit/*.test.ts`** — `unit/personas.test.ts`, `unit/judge.test.ts`,
   `unit/db-invariants.test.ts` validate the harness and **run inside
   `npm run test`** (the CI gate) — keep them green as you change the shapes.
   Update them to the new persona/stage/assertion shapes.
10. **`README.md`** — update the flow diagram, stages, and persona table.

## Gotchas (obey)

- **cwd is the REPO ROOT.** Run npm as `(cd cfos-office && npm run X)`. Never read
  an exit code through `| tail` — capture: `(cd cfos-office && npm run X) >
  /tmp/x.log 2>&1; echo "EXIT=$?"; tail -n 20 /tmp/x.log`.
- **`git add -A` HANGS** (walks `.next`). Stage scoped: `git add cfos-office/src
  cfos-office/tests` (+ this file if you commit it).
- **The persona runner hits live infra**, not CI: it needs `.env.local` →
  **Staging** Supabase (`qlbhvlssksnrhsleadzn`), AWS Bedrock (EU profiles, real
  cost — judge + Read composition), and a free **port 3000** (it auto-starts the
  dev server). `npm run test:onboarding -- --personas <id> --skip-judge` for cheap
  iteration. It leaves one orphaned staging user per run (known FK teardown bug).
- **The persona suite is NOT in `npm run test`.** `npm run test` runs the harness's
  `unit/` tests + the app's vitest tree (1395 tests at OB-3 tip). The persona
  *runner* is on-demand. So the OB-4 CI-gate verification is: typecheck · lint ·
  knip · `npm run test` (unit tests updated + green) · build. The persona-suite
  green run against staging is a separate, manual confirmation.
- **Design lock still applies** to any UI you touch (you shouldn't need to): tokens
  only, no `dark:`, mobile-first 44px, no internal vocabulary
  (`growth\|security\|agency\|candor\|archetype\|confidence\|L1\|L2`) as visible
  text. The harness drives existing UI; don't add product copy.
- **Don't re-introduce the legacy walk.** `OnboardingBeatHost` + the struggle/
  essentials beats still exist (the check mission reuses upload/confirm), but the
  ENTRY is the estimate flow. A fresh user never sees the struggle beat.

## Build order

1. `runner/types.ts` stage enum + `personas/types.ts` shape (+ update `unit/personas.test.ts`).
2. Convert one persona (e.g. `drifter-expat`) + rewrite `playwright-driver.ts` to
   walk the estimate beats; get a single `--personas drifter-expat --skip-judge`
   run green against staging.
3. `judge.ts` (`start_statement_check` allow-list) + `db-assertions.ts`
   (snapshot + invariants) + `unit/judge.test.ts` / `unit/db-invariants.test.ts`.
4. Add the statement-check → reality-check leg to the driver; one check-persona green.
5. Convert the remaining personas; full `--skip-judge` suite green, then a full
   judged run; re-capture `fixtures/reads/*` + `baselines/main-<date>/`.
6. README. Verify CI gates green. Adversarial review. Commit OB-4. Push (updates PR #70).

## Phase-0 reads (before editing)

1. This file.
2. `cfos-office/tests/onboarding/README.md` + `runner/playwright-driver.ts` (the legacy walk to replace).
3. `cfos-office/tests/onboarding/runner/persona-runner.ts` + `runner/types.ts` + `runner/cli.ts` + `runner/args.ts` (orchestration, stages, flags).
4. `cfos-office/tests/onboarding/personas/types.ts` + `personas/drifter-expat.ts` (shape to extend; example).
5. `cfos-office/tests/onboarding/runner/judge.ts` + `runner/db-assertions.ts` (+ `src/lib/ai/read-judge.ts` for `checkReadHardRules`).
6. `cfos-office/src/components/onboarding-v2/in-sheet/estimate/estimate-beat-host.tsx` + every `estimate/*-beat-block.tsx` (the live beats + their `data-testid`s) + `estimate/beat-chrome.tsx`.
7. `cfos-office/src/components/onboarding-v2/in-sheet/onboarding-beat-host.tsx` (the check mission host) + `upload-beat-block.tsx` / `confirm-beat-block.tsx` / `check-processing-beat-block.tsx`.
8. `cfos-office/src/lib/onboarding-v2/door/door-config.ts` (`struggleToFamily`, families), `estimates/bands.ts` (band ids), `knows-you.ts`.
9. `cfos-office/src/app/(office)/layout.tsx` + `src/components/chat/ChatSheet.tsx` (how the estimate vs legacy host is selected) + `lib/onboarding-v2/in-sheet-steps.ts`.

## Verification

- CI gates (real exit codes, machine quiet — run sequentially; `tsc` can block
  under concurrent load): `typecheck` · `lint` (0 errors) · `knip` · `npm run
  test` (harness `unit/` tests green) · `build`.
- Manual: `npm run test:onboarding -- --personas <id>` green against staging for a
  non-check persona AND a check persona; then the full suite. Re-capture baselines.
- Adversarial multi-agent review over the diff; fix confirmed findings.
