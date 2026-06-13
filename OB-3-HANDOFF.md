# OB-3 Handoff — Statement-check mission + reality-check Read

Self-contained plan for a fresh session. Branch `claude/nifty-carson-4jzdl2`.
Delete this file in OB-5.

## Where things stand

- **OB-1** (`4debb0c`) — schema (migrations 074/075, **staging-only, unapplied**; prod needs Lewis), deterministic engines (`bands`, `derive`, `deltas`, `knows-you`), content config (door/composite/goal), frozen main baseline harness.
- **OB-2** (`c11a319`) — the estimates-first flow is **the default onboarding**: door → context → composite → goal → income → sketch → verdicts → **estimate Read** (stamps `first_read_delivered` = onboarding complete, **before any upload**). All green; reviewed (8 findings fixed).
- Branch is **2 commits ahead of origin** (OB-1+OB-2 not pushed). Push + PR happen **after OB-3 lands** (Lewis's instruction).

OB-3 turns the optional "Check my numbers" CTA into a real mission and delivers the **reality-check Read** (estimate-vs-reality deltas), then converges into the existing VM-3 → VM-4 → recompose arc.

## The state machine (already in `types.ts` / `in-sheet-steps.ts`)

```
… estimate_read_pending → first_read_delivered (completion; estimate Read delivered)
   ── user taps [CTA:start_statement_check] (StatementCheckActionButton → advanceStep('check_upload_pending')) ──
→ check_upload_pending → check_processing → check_confirm_pending → reality_check_delivered
→ (reality-check Read closes on [CTA:start_value_map_real]) → value_map_offered → VM-3 → … → complete
```

`check_*` steps are already in `IN_SHEET_BEAT_STEPS` and the layout's `LEGACY_HOST_STEPS`, so they render via **`OnboardingBeatHost`** (the legacy/check host), not the estimate host. `resume.ts` already routes `reality_check_delivered`/`value_map_offered` correctly. **No new migration** (steps are freeform text; `onboarding_estimates.verification` jsonb exists).

## CRITICAL: replace the OB-2 interim card

`src/components/onboarding-v2/in-sheet/onboarding-beat-host.tsx` currently has an **OB-2 interim branch** for `check_upload_pending|check_processing|check_confirm_pending` — a "You're all set / Back to my office" card (→ `advanceStep('complete')`). **OB-3 replaces this branch** with the real beats below. (It exists only so OB-2 didn't strand users on a spinner.)

## Verified ground truth (gathered during OB-2→OB-3 recon — trust these, spot-check if editing)

### `deltas.ts` engine (OB-1, done) — `src/lib/onboarding-v2/estimates/deltas.ts`
- `computeDeltas(estimateBands: EstimateBands, actuals: BandActuals): DeltaResult` — **pure over PRE-FETCHED actuals** (you fetch the reals; it compares to pinned midpoints).
- `BandActuals` = `{ housing, subscriptions, bills, foodOut, saveReach: number|null, saveReachIsProxy?: boolean }`.
- `DeltaResult` = `{ engine_version:'v1', bands: BandDelta[], verifiedCount, sharpest: BandDelta|null, held: BandDelta[] }`. `sharpest` = largest `|delta|` among **verified-but-not-held** bands (what the Read opens on). `held` = bands where the guess held (`|delta| ≤ max(30, 0.15×estimate)`).
- `BandDelta` = `{ band, state:'verified'|'estimated', estimate, actual, delta, held, note }`. Unverifiable bands → `state:'estimated'` (named as estimates in the Read).
- `toVerificationJson(result): VerificationJson` → the shape for `onboarding_estimates.verification` (timestamp-free; stamp `verified_at` inside json or skip — there's no separate column). `SAVE_REACH_PROXY_NOTE` is a pinned quotable note.

### `onboarding_estimates` columns (migration 074)
`housing_band, subs_band, bills_band, food_out_band, save_reach_band` (band ids), `income_monthly`, `top_value`, `verdicts` (jsonb `{subscriptions,food_out,drift}`), `derived` (jsonb), `verification` (jsonb), `currency`. Map band columns → typed `EstimateBands` like `compose-estimate-read.ts:toBands()` does (housing `a|b|c|d`, subs `low|mid|high`, bills `a|b|c`, foodOut `a|b|c`, saveReach `a|b|c|d`).

### `compose-first-read.ts` — `src/lib/ai/compose-first-read.ts`
- `ComposeFirstReadMode = 'default' | 'value_first' | 'value_first_recompose'`. **Add `'reality_check'`.**
- `composeFirstRead({userId, supabase?, mode?, priorReadSummary?, valueMapCardKeys?})`. **Add a `deltas?: DeltaResult` param** for reality_check.
- Already fetches the full transaction stack (reality_check needs it): `getFinancialFacts` (net_monthly_income, monthly_rent, total_fixed_costs, free_cash_flow, currency, income_shape, t3m), `getSpendingBreakdown`, `reconcileFixedCosts`, `deriveLevers`, `getDataWindowCoverage`→`effectiveMonths`, `selectHookCandidates` (gate on `mode==='value_first'` → extend to include `'reality_check'` so CLARIFIERS get hooks).
- generateText shape: `bedrock(COMPOSE_MODEL)`, temp 0.5, `maxOutputTokens 700`, `AbortSignal.timeout(20_000)`.
- System-prompt select (line ~191): add a `reality_check` branch → `FIRST_READ_SYSTEM_PROMPT_REALITY_CHECK`.
- `buildFirstReadUserPrompt` (in prompts/first-read.ts): add an **ESTIMATE VS REALITY** section rendered from `deltas` (only when present).

### `prompts/first-read.ts`
- Types reused: `FirstReadComposeOutput {composedMessage, metadata}`, `FirstReadMetadata` (mode union now includes `'estimate_first'`; OB-2 added `knows_you_pct`, `estimate_action_branch` — **add `'reality_check'` to the mode union**), `PriorReadSummary {layer1Stated, goalStatedAsReveal, merchantsAlreadyNamed[], hookMerchantsUsed[], firstSentence?}`.
- Existing prompts: `FIRST_READ_SYSTEM_PROMPT`, `_VALUE_FIRST`, `_RECOMPOSE` — clone the structure for `FIRST_READ_SYSTEM_PROMPT_REALITY_CHECK`:
  1. **DELTAS** — open on `sharpest` verbatim ("You guessed ≈€150 eating out. The real number was €287."); ≤2–3 deltas, both directions; where the guess `held`, say so; `estimated` bands stay named as estimates (quote `SAVE_REACH_PROXY_NOTE` verbatim for the proxy save-reach).
  2. **CORRECTED POSITION** — real free cash / goal pace verbatim from FINANCIAL FACTS; reference the estimate Read figures only as "your sketch said ≈X".
  3. **CLARIFIERS** — either/or questions on HOOK CANDIDATES (existing value_first contract).
  4. **HANDOFF** — the habits half is now fillable; the Value Map is where intent attaches; `[CTA:start_value_map_real]Tell me what these mean[/CTA]`; knows-you line verbatim (now **past 70** — `statementChecked:true` → 72).
- Honesty carried over: only cite data given; no invented merchants/dates; estimate figures stay ≈ and referenced as the prior sketch.

### Actuals fetcher (NEW — `src/lib/onboarding-v2/estimates/reality-actuals.ts`, or inside compose-first-read)
Fetch `BandActuals`: **housing** ← `user_profiles.monthly_rent` else reconciled housing fixed-cost; **subscriptions** ← `recurring_expenses` subscription-ish rows (monthly sum); **bills** ← reconciled fixed total − housing; **foodOut** ← spending-breakdown eating-out total ÷ `effectiveMonths` (reuse the coverage logic); **saveReach** ← detected savings transfers else `income − tracked spend` proxy with `saveReachIsProxy:true`. Sources: `src/lib/analytics/reconcile-fixed-costs.ts`, `spending-breakdown.ts`, `recurring_expenses`. (Read those for exact shapes.)

### ⚠️ GOTCHA: `confirmFixedCosts` stamps `details_confirmed`
`src/app/onboarding-v2/confirm/confirm-actions.ts:186` ends with `advanceStep('details_confirmed')` + `redirectTo:/onboarding-v2/first-read`. **`ConfirmBeatBlock` CANNOT be reused as-is** for `check_confirm_pending` — `details_confirmed` triggers the legacy value-first Read via `OnboardingBeatHost`'s `details_confirmed` effect (POST `/api/insights/post-upload`). The reconcile/persist logic (steps 1–4: dismissals, banked edits, declared rows, `syncTotalFixedCosts`) IS needed (it verifies housing/bills). **Fix:** parameterize — give `confirmFixedCosts` an optional `nextStep`/`mode` (default `details_confirmed`; check mission passes nothing-or-`check_confirm_done`), OR a thin check-confirm action that calls the same reconcile then does NOT advance to details_confirmed. `ConfirmBeatBlock` calls `confirmFixedCosts` internally then `onConfirmed()` — pass a variant so it calls the check action, then the host's `onConfirmed` triggers the reality-check route. (Don't let the step pass through `details_confirmed`.)

### `UploadBeatBlock` — props `{onImported, onDone, goal}`
Fixed copy + a goal-bridge `UploadIntro` intro phase. For `check_upload_pending`, **add a `mode`/`variant` prop** to reframe copy ("One month of statements checks the maths") and likely skip the goal bridge (user already onboarded). `onDone` fires after the autoImport lands; the host then `advanceStep('check_processing')`.

### `check_processing` — progress-only (NO income/rent form)
`EssentialsBeatBlock`/`processing-form.tsx` host the income+rent form during the legacy wait — **not needed** (income/rent on file). Build a progress-only block that waits for the import aggregation (merchant_aggregates refresh) then `advanceStep('check_confirm_pending')`. **READ `essentials-beat-block.tsx` + `processing-form.tsx`** to model the wait/advance mechanism (how it knows the import finished).

### Read-delivery race-fix (mirror exactly)
`OnboardingBeatHost`'s `details_confirmed` effect: POST → `advanceStep(...)` → `openSheet()` + `loadConversation(id)` + **lone** `router.refresh()` (no competing navigation). Replicate for the reality-check trigger at `check_confirm_pending`'s `onConfirmed`.

### reality-check route (NEW — `src/app/api/insights/reality-check/route.ts`)
Mirror `post-upload`/`estimate-read` routes. Steps:
1. Refresh `merchant_aggregates` (service client) — same as post-upload.
2. Load estimates bands + fetch `BandActuals` → `computeDeltas` → `toVerificationJson` → persist `onboarding_estimates.verification`.
3. `composeFirstRead({mode:'reality_check', deltas})`.
4. **Append** the assistant message to the EXISTING estimate-read conversation (find `type='first_read'`, `metadata->>estimate_read='true'`); add `reality_check_metadata` to its metadata.
5. `advanceStep('reality_check_delivered')`; return `conversationId`.
Idempotent: if a reality-check message already exists on the conversation, return it. (`reality_check_delivered` is NOT in `markComplete`'s terminal list — fine, the user is already completed by the estimate Read.)

### `recompose-first-read/route.ts` — **READ + adjust**
Build `PriorReadSummary` from **BOTH** prior assistant messages (estimate Read + reality-check Read); the repeated-opening probe should use the **reality-check's** first sentence (it's the most recent). `post-upload/route.ts` keeps `value_first` for legacy mid-pipeline stamps — no behaviour change.

### knows-you at reality_check
Compute `knowsYou({...statementChecked:true})` → past 70 (72). The reality-check Read's knows-you HANDOFF line reflects it. (Engine: `src/lib/onboarding-v2/knows-you.ts`, `statementChecked` weight +16.)

## OB-3 build order

1. **Parameterize the confirm action** (`confirm-actions.ts`) for the check path (the `details_confirmed` gotcha).
2. **OnboardingBeatHost**: replace the interim `check_*` card with real beats — `check_upload_pending`→`UploadBeatBlock(mode:'check')`→`check_processing`; `check_processing`→progress-only→`check_confirm_pending`; `check_confirm_pending`→`ConfirmBeatBlock(check variant)`→reality-check trigger→`reality_check_delivered`.
3. **Actuals fetcher** + **`deltas` wiring**.
4. **`reality_check` compose mode** + **`FIRST_READ_SYSTEM_PROMPT_REALITY_CHECK`** + **ESTIMATE VS REALITY** user-prompt section.
5. **reality-check route**.
6. **recompose route** two-prior-reads change.
7. Verify green → adversarial review → fix → commit OB-3 → **push (OB-1+OB-2+OB-3)** → **open PR**.

## Verification + environment gotchas (LEARNED — obey)

- **cwd is the REPO ROOT** (`/Users/lewislonsdale/Documents/CFO-V2`), NOT `cfos-office/`. Run every npm command as `(cd cfos-office && npm run X)`.
- **Never read an exit code through `| tail`** — `npm` ENOENT at repo root once masked as "exit 0". Capture explicitly: `(cd cfos-office && npm run X) > /tmp/x.log 2>&1; echo "EXIT=$?"; tail -n 20 /tmp/x.log`.
- **`git add -A` HANGS** (walks the 76 MB `.next`). Stage scoped: `git add cfos-office/src` (+ `git add OB-3-HANDOFF.md` etc.). Clear a stale `.git/index.lock` if a backgrounded git hangs; git ops may need `dangerouslyDisableSandbox`.
- **vitest**: `npx vitest` is broken — use `(cd cfos-office && ./node_modules/.bin/vitest run <path>)` for scoped, `(cd cfos-office && npm run test)` for the full CI gate (122 files / 1393 tests at OB-2).
- **Gates (all must pass, real exit codes):** `typecheck` · `lint` (0 errors; ~39 pre-existing warnings OK) · `knip` · full `test` · `build`.
- **Design lock**: tokens only (ESLint bans raw hex), no `dark:`, mobile-first (`h-dvh`, 44 px targets, no autofocus on mobile, safe-area), office fonts (DM Sans / JetBrains Mono / Cormorant). Beats: `data-testid` on every tappable; **never surface internal vocabulary** (`growth|security|agency|candor|archetype|confidence|L1|L2`) as visible text.
- **Supabase**: migrations 074/075 staging-only-unapplied; **OB-3 needs no migration**. Staging project `qlbhvlssksnrhsleadzn`; prod needs Lewis.
- After OB-3 commits green: **push the branch and open a PR** (carries OB-1+OB-2+OB-3). Use `gh`. The no-arg local branch has a GitHub remote (`origin/claude/nifty-carson-4jzdl2`).

## Phase-0 reads for the fresh session (before editing)
1. This file.
2. `cfos-office/src/app/onboarding-v2/confirm/confirm-actions.ts` (the `details_confirmed` gotcha).
3. `cfos-office/src/components/onboarding-v2/in-sheet/onboarding-beat-host.tsx` (interim card to replace; the `details_confirmed` effect to mirror).
4. `cfos-office/src/components/onboarding-v2/in-sheet/essentials-beat-block.tsx` + `processing-form.tsx` (model `check_processing`).
5. `cfos-office/src/app/api/insights/recompose-first-read/route.ts` (two-prior-reads change).
6. `cfos-office/src/lib/ai/compose-first-read.ts` + `cfos-office/src/lib/ai/prompts/first-read.ts` (the compose mode + prompt; reuse `buildFirstReadUserPrompt`).
7. `cfos-office/src/lib/onboarding-v2/estimates/deltas.ts` (engine — summarised above).
8. `cfos-office/src/lib/analytics/reconcile-fixed-costs.ts` + `spending-breakdown.ts` (actuals sources).
9. `cfos-office/src/app/api/insights/estimate-read/route.ts` + `cfos-office/src/lib/ai/compose-estimate-read.ts` (OB-2 route/composer to mirror).
