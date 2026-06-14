# ONBOARDING-MAP.md

**Purpose:** A review artifact mapping the full onboarding flow of The CFO's Office,
so onboarding can be reviewed and (in a later session) isolated/hardened without
breaking the rest of the app.

**Branch:** `claude/onboarding-isolation-verify-yhP1t` — cut off the visual-consistency
phase-3b base (`5fa91fd`) with `claude/bank-statement-upload-myqNB` (`e0601b4`) merged in,
because the recent onboarding substance lived only on the upload branch (see
SESSION-LOG entry for this session). Integration verified: `tsc --noEmit` clean,
927 unit tests green.

**Scope note:** This is a *map*, not a refactor. No onboarding source was rewritten.
The current flow is the **value-first layered Read** — since the 2026-06-10
legacy removal it is unconditional (the `LAYERED_READ_DISABLED` kill-switch and
the pre-layered path no longer exist). Legacy-path references below this point
describe code that has since been deleted; the archetype surface survives for
users stamped mid-flow on the old surface.

---

## A. Flow narrative (end to end)

The flow has two entry styles that converge on the same DB state. The **default**
is the value-first sequence under `app/onboarding-v2/*`. The Value Map can be taken
pre-signup (anonymous demo) *or* post-Read (opt-in deepening).

### A0. Value Map — pre-signup (anonymous demo)
- **Trigger:** unauthenticated user lands on `/demo`.
- **User sees:** welcome → explainer → 10 sample-transaction sort into
  Foundation/Burden/Investment/Leak/Don't-Know with confidence; timing captured
  (`card_time_ms`, `first_tap_ms`, `deliberation_ms`).
- **Writes:** `demo_sessions` (+`responses` payload), `demo_question_responses`; on
  email capture `demo_waitlist` (+ `demo_sessions.waitlist_joined`). A client-side
  `session_token` (UUID) is generated and carried to signup via localStorage
  (`cfos_demo_session_token`).
- **Reading:** `/api/demo/reading` calls Bedrock for a personality reading. This is
  the pre-signup "aha"; nothing account-owned is written yet.

### A1. Signup / auth → anonymous-session linking
- **Trigger:** signup form (`app/(auth)/signup/page.tsx`); Supabase `auth.signUp`.
- **Writes:** `auth.users`; `user_profiles` (`display_name`, `country`,
  `primary_currency`, `profile_completeness`).
- **Linking:** post-signup the page POSTs `cfos_demo_session_token` to
  `/api/value-map/link-session`, which (service client, demo has no RLS for the
  new user) reads `demo_sessions`, recomputes personality, and migrates the
  anonymous responses into account-owned rows:
  - `value_map_sessions` (1 summary row, `is_real_data = false`)
  - `value_map_results` (≤10 per-card rows)
  - `value_category_rules` (category-precise cards only → `source='value_map'`,
    `match_type='category'`, `confidence = card.confidence/5`)
  - `user_events` (`value_map_session_linked` analytics).

### A2. Goal beat (goal-only)
- **Trigger:** `app/onboarding-v2/page.tsx` routes a fresh user into the struggle/goal
  beat. `completeGoalBeat` / `skipGoalBeat` (`goal-beat-actions.ts`) confirm or skip a
  goal and stamp `onboarding_step='upload_pending'`, routing to `/onboarding-v2/upload`.
- **Note:** Essentials are NOT collected here; neither beat stamps
  `onboarding_completed_at`. Skip routes forward to upload (no Marcus bifurcation).

### A3. First bank-statement / CSV upload → parse → dual categorisation
- **Trigger:** `/onboarding-v2/upload`. Client parses the file
  (`format-detect-client` → `universal-csv` / `ofx` / `qif` / `xlsx-to-csv`) into
  `ParsedTransaction[]`, POSTs to `/api/upload` (`action:'preview'`).
- **Dual categorisation (preview + import):** every txn gets a **primary category**
  (`rules-engine` keyword/merchant/recurring match, LLM fallback for misses) **and** a
  **value category** (`value-categoriser` hierarchical chain). On `action:'import'`,
  `lib/upload/pipeline.ts` inserts into `transactions` with both categories +
  confidence + `prediction_source`, and learns `user_merchant_rules` from user picks.
- **Post-import (fire-and-forget):** `refreshMonthlySnapshots` (writes
  `monthly_snapshots`), `detectAndFlagRecurring` (writes `recurring_expenses`
  `status='detected'`), holiday/payday/retake signals, location enrichment.
- **Step:** `upload-orchestrator` stamps `onboarding_step='upload_processing'`.

### A4. Processing (income + rent) → reconcile fixed costs
- **Trigger:** `/onboarding-v2/processing` hosts an income + rent form alongside the
  parse wait (`IMPORT_GRACE_MS`).
- **Writes:** `submitIncome` → `user_profiles.net_monthly_income` (income blur fires an
  instant goal-pace line); `submitRent` → `user_profiles.monthly_rent`.
- **`advanceToConfirm`** runs `syncTotalFixedCosts` (first real write of
  `monthly_snapshots.total_fixed_costs` via `reconcileFixedCosts`) and stamps
  `onboarding_step='details_pending'`.

### A5. Confirm / reconcile fixed costs
- **Trigger:** `/onboarding-v2/confirm`. Server-side read-only passes:
  `reconcileFixedCosts` (dedupes rent vs declared vs detected on amount-band ±10% +
  cadence), `computeRecurringCandidates` (loose pass, never persisted at load),
  `assessCategoryCoverage` (missing-category gaps). **(This is the
  bank-statement-upload branch's fixed-cost-confidence rework — `7ec58c0`.)**
- **Writes on confirm (`confirmFixedCosts`):** dismiss `recurring_expenses` /
  `user_declared_fixed_costs`; INSERT confirmed `user_declared_fixed_costs`
  (`source='candidate_confirm'|'gap_capture'`); UPSERT skipped candidates as
  `recurring_expenses status='dismissed'` (suppress re-detection); re-run
  `syncTotalFixedCosts`; stamp `onboarding_step='details_confirmed'`.

### A6. First Read (the completion gate)
- **Trigger:** `/onboarding-v2/first-read` mounts → POST `/api/insights/post-upload`
  (idempotent). With `onboarding_step='details_confirmed'`, `composeFirstRead` runs in
  `value_first` mode: leads with Layer-1 facts, closes on a HOOK selected by
  `selectHookCandidates` (`compose-first-read-hooks`, refined by `e0601b4` to exclude
  income/rent/transfers).
- **Writes:** `conversations` (type `'first_insight'`, `metadata.layered_read=true`,
  `metadata.first_read_metadata.hook_candidates=[…]`) + a pre-written assistant
  `messages` row. The orchestrator fires `advanceStep('first_read_delivered')` —
  **this is the completion gate.** `markOnboardingCompleteIfReady` stamps
  `onboarding_completed_at`.

### A7. Value Map on real data (optional upgrade)
- **Trigger:** user clicks the hook CTA → `/onboarding-v2/value-map?hook=1`.
  `getHookCandidatesForUser` + `buildRealTransactionsFromHooks` turn the hooked
  clusters into real merchant cards (90-day window). Page stamps `value_map_offered`.
- **On completion:** new `value_map_sessions` (`is_real_data=true`),
  `value_map_results`, `value_category_rules` (`source='value_map_personal'`,
  `match_type='merchant'`). `/api/insights/value-map-complete` runs `analyseGap`
  (stated rules vs actual `transactions.value_category`) and writes gap data into
  conversation metadata; `recompose-first-read` appends a Layer-2-aware follow-up.
- Skipping leaves the user fully onboarded (Read already stamped completion).

### A8. Archetype (legacy / generate-archetype path)
- The dedicated archetype reveal (`/onboarding-v2/archetype` →
  `/api/onboarding/generate-archetype`) calls Bedrock, UPDATEs `value_map_sessions`
  archetype fields, UPSERTs `financial_portrait` (1 archetype + 3 trait rows,
  `source='value_map'`), and calls `markOnboardingCompleteIfReady`. This is the
  Value-Map-led completion route; in the value-first default the Read gates completion
  and this is the deepening branch.

### A9. "First meeting" conversation type & progressive profiling
- `getConversationInstructions('onboarding')` (`context-builder.ts` ~L2386) is the
  **legacy** First Meeting chat prompt (sample Value Map + "upload your transactions"
  pivot). The value-first path skips this chat narration and uses the pre-composed
  Read instead; the `'first_insight'`/`'post_upload'` instruction case (~L2480) governs
  the Read conversation.
- After completion, `lib/profiling/engine.ts:getNextQuestions` ranks 1–2 questions from
  `question-registry.ts`, boosting fields tied to burden/leak merchants
  (`value_map_sessions.merchants_by_quadrant`); asked/answered tracked in
  `profiling_queue`.

---

## B. File inventory

`SHARED` = imported by non-onboarding surfaces too (cannot be stripped without breaking
the rest of the app — see §D). `ONB-ONLY` = only onboarding imports it.

### Pages / orchestrators / actions
| path (under `cfos-office/src/`) | role | reads | writes | scope |
|---|---|---|---|---|
| `app/(public)/demo/page.tsx` | demo entry, skip if already done | value_map_sessions, user_profiles | — | SHARED (auth+anon) |
| `app/(public)/demo/layout.tsx` | demo wrapper | — | — | demo |
| `components/demo/demo-flow.tsx` | demo UX state machine | — | — | demo |
| `components/demo/demo-reveal.tsx` / `demo-email-capture.tsx` | reveal + email capture | — | — | demo |
| `lib/demo/use-demo-session.ts` | client session_token + timings | — | — | demo |
| `app/(auth)/signup/page.tsx` | signup, link session, consent | user_profiles | user_profiles | ONB-ONLY |
| `app/(auth)/login/page.tsx` | login (not in segment) | — | — | SHARED auth |
| `app/onboarding-v2/page.tsx` | post-signup router/resume | user_profiles | — | ONB-ONLY |
| `app/onboarding-v2/goal-beat-actions.ts` | confirm/skip goal, stamp upload_pending | user_profiles, goals | user_profiles, goals | ONB-ONLY |
| `app/onboarding-v2/upload/page.tsx` + `upload-orchestrator.tsx` | upload gate + wizard, stamp upload_processing | categories, user_profiles | user_profiles (step) | ONB-ONLY |
| `app/onboarding-v2/processing/page.tsx` + `processing-orchestrator.tsx` | income+rent form host | user_profiles | — | ONB-ONLY |
| `app/onboarding-v2/processing/processing-actions.ts` | submitIncome/submitRent/advanceToConfirm | user_profiles, goals, monthly_snapshots, recurring_expenses, user_declared_fixed_costs | user_profiles (income, rent, step), monthly_snapshots (total_fixed_costs) | ONB-ONLY |
| `app/onboarding-v2/confirm/page.tsx` + `confirm-orchestrator.tsx` | reconcile/candidate/coverage UI | user_profiles, transactions, user_declared_fixed_costs, recurring_expenses, monthly_snapshots | — | ONB-ONLY |
| `app/onboarding-v2/confirm/confirm-actions.ts` | confirmFixedCosts (dismiss/insert/upsert/sync/step) | user_profiles, user_declared_fixed_costs, recurring_expenses, monthly_snapshots | user_declared_fixed_costs, recurring_expenses, monthly_snapshots, user_profiles (step) | ONB-ONLY |
| `app/onboarding-v2/first-read/page.tsx` + `first-read-orchestrator.tsx` | compose trigger + Read display, stamp first_read_delivered | user_profiles, conversations, messages | user_profiles (step) | ONB-ONLY |
| `app/onboarding-v2/value-map/page.tsx` + `value-map-orchestrator.tsx` | real-data VM (hook), stamp value_map_offered | user_profiles, conversations, value_map_sessions, transactions | user_profiles (step), value_map_* | ONB-ONLY |
| `app/onboarding-v2/archetype/page.tsx` + `archetype-orchestrator.tsx` | archetype reveal, advance complete | user_profiles, value_map_sessions, value_map_results | user_profiles (step) | ONB-ONLY |
| `app/onboarding-v2/actions-step.ts` (`advanceStep`) | generic step ratchet + markComplete | — | user_profiles (step, onboarding_completed_at) | SHARED (onb routes) |
| `components/onboarding-v2/*` (processing-form, confirm-fixed-costs, candidate-bills, missing-costs, fixed-cost-display, goal-beat-watcher, goal-pace-inline, struggle-question, chat-opener-trigger) | onboarding UI | — | — | ONB-ONLY |
| `components/value-map/value-map-flow.tsx` | VM exercise (multi-mode) | value_map_sessions, transactions, categories | value_map_sessions, value_map_results, value_category_rules, transactions | SHARED (onb+checkin+personal) |

### API routes
| path | role | reads | writes | scope |
|---|---|---|---|---|
| `app/api/demo/session/route.ts` | persist demo session (POST/PATCH) | — | demo_sessions, demo_question_responses | demo |
| `app/api/demo/reading/route.ts` | Bedrock reading | — | — | demo |
| `app/api/demo/signup/route.ts` | waitlist capture | — | demo_waitlist, demo_sessions | demo |
| `app/api/value-map/link-session/route.ts` | anon→account migration + seed rules | demo_sessions, value_map_sessions, categories | value_map_sessions, value_map_results, value_category_rules, user_events | ONB-ONLY |
| `app/api/upload/route.ts` | parse+preview+import pipeline | categories, value_category_rules, user_merchant_rules, recurring_expenses, merchant_history | transactions, monthly_snapshots, recurring_expenses, conversations (markComplete) | SHARED (onb import + bulk upload) |
| `app/api/onboarding/generate-archetype/route.ts` | archetype LLM + portrait seed | value_map_sessions, value_map_results | value_map_sessions, financial_portrait, user_profiles (markComplete) | ONB-ONLY |
| `app/api/onboarding/essentials-status/route.ts` | essentials/goal-deferral status | user_profiles | — | ONB-ONLY |
| `app/api/onboarding-v2/free-text-opener/route.ts` | chat opener gen | user_profiles, conversations | conversations/messages | ONB-ONLY |
| `app/api/insights/post-upload/route.ts` | First Read composition + persist | user_profiles, conversations, messages | conversations, messages | SHARED (upload + onb) |
| `app/api/insights/recompose-first-read/route.ts` | Layer-2 follow-up Read | conversations, value_category_rules, transactions | conversations/messages | ONB-ONLY |
| `app/api/insights/value-map-complete/route.ts` | gap analysis post-VM | value_map_results, value_category_rules, monthly_snapshots, transactions | conversations.metadata | ONB-ONLY |

### Lib modules
| path | role | reads | writes | scope |
|---|---|---|---|---|
| `lib/parsers/*` (format-detect-client, universal-csv, ofx, qif, xlsx-to-csv, fingerprint, types) | file → ParsedTransaction[], dedupe | — | — | SHARED |
| `lib/categorisation/rules-engine.ts` | primary category | categories, user_merchant_rules, recurring_expenses | — | SHARED |
| `lib/categorisation/value-categoriser.ts` | value category chain | value_category_rules, categories | — | SHARED |
| `lib/categorisation/{categorise-transaction,context-signals,llm-categoriser,normalise-merchant,value-classification}.ts` | categorisation support | merchant_history (RPC) | — | SHARED |
| `lib/upload/pipeline.ts` | import orchestrator (insert+learn) | categories, value_category_rules, user_merchant_rules, recurring_expenses | transactions, user_merchant_rules | SHARED |
| `lib/analytics/monthly-snapshot.ts` | aggregate + syncTotalFixedCosts | transactions, monthly_snapshots, user_profiles, user_declared_fixed_costs, recurring_expenses | monthly_snapshots (incl. total_fixed_costs) | SHARED |
| `lib/analytics/recurring-detector.ts` | strict recurring detection | transactions | recurring_expenses | SHARED |
| `lib/analytics/recurring-candidates.ts` | loose candidate pass (confirm) | transactions, recurring_expenses, user_declared_fixed_costs | — | ONB-ONLY |
| `lib/analytics/category-coverage.ts` | missing-category detection (confirm) | transactions | — | ONB-ONLY |
| `lib/analytics/fixed-cost-classify.ts` | discretionary-regular hold-out | — | — | ONB-ONLY |
| `lib/analytics/reconcile-fixed-costs.ts` | merge/dedupe fixed costs | user_profiles, user_declared_fixed_costs, recurring_expenses, benchmark_reference | — | SHARED (processing+confirm+snapshot) |
| `lib/analytics/gap-analyser.ts` | stated vs actual gap | value_map_results, value_category_rules, transactions, monthly_snapshots | — | SHARED (VM flow) |
| `lib/ai/compose-first-read.ts` | Read composition (layers) | user_profiles, goals, merchant_aggregates, transactions, monthly_snapshots, value_map_sessions | — | SHARED (upload+onb) |
| `lib/ai/compose-first-read-hooks.ts` | hook selection | value_category_rules (via value-profile) | — | SHARED |
| `lib/ai/context-builder.ts` | system prompt + getConversationInstructions | many (profile/portrait/goals/VM/etc.) | — | SHARED (every chat) |
| `lib/value-map/value-profile.ts` (`buildUserValueProfile`) | Layer-2 distribution | value_category_rules, transactions, value_map_sessions | — | SHARED |
| `lib/value-map/{personalities,types,hook-transactions,constants,copy,format,observations}.ts` | VM calc + hook cards + copy | conversations.metadata, transactions | — | SHARED |
| `lib/value-map/regenerate-archetype*.ts` | archetype regen (post-onb) | value_map_* | value_map_sessions | SHARED |
| `lib/onboarding/markComplete.ts` | onboarding_completed_at ratchet | user_profiles, value_map_sessions | user_profiles (onboarding_completed_at) | SHARED (upload/chat/VM/archetype/advanceStep) |
| `lib/onboarding/archetype-prompt.ts` | archetype prompt builder | — | — | SHARED (onb + regen) |
| `lib/onboarding-v2/{bridge,resume,types,labels}.ts` | step routing + VM-offer plumbing | — | — | mixed (resume ONB-ONLY; bridge SHARED chat) |
| `lib/onboarding-v2/goal-deferral-quickcheck.ts` / `value-map-decline-quickcheck.ts` / `value-map-decline-classifier.ts` | goal/VM decline classification | — | — | ONB-ONLY |
| `lib/onboarding-v2/free-text-opener-{generator,prompt}.ts` | chat opener | — | — | ONB-ONLY |
| `lib/profiling/engine.ts` (`getNextQuestions`) | next-question ranking | user_profiles, conversations, profiling_queue, value_map_sessions | — | SHARED (all chat) |
| `lib/profiling/question-registry.ts` | question definitions | — | — | SHARED |

---

## C. DB surface (tables / columns touched during onboarding)

**Written:**
- `auth.users` — email, password_hash (signup).
- `user_profiles` — `display_name`, `country`, `primary_currency`, `profile_completeness`
  (signup); `net_monthly_income`, `monthly_rent` (processing); `onboarding_step` (every
  transition); **`onboarding_completed_at`** (one-way ratchet via `markComplete`).
- `transactions` — INSERT on import: `category_id`, `auto_category_confidence`,
  `value_category`, `value_confidence`, `prediction_source`, `user_confirmed`,
  `value_confirmed_by_user`, `import_batch_id`, `dedupe_hash`.
- `monthly_snapshots` — `total_income`, `total_spending`, `spending_by_category`,
  `largest_txn`, `avg_txn_size`, `income_shape`, `posture`, `closing_balance`, and
  **`total_fixed_costs`** (written at advanceToConfirm + confirmFixedCosts via
  `syncTotalFixedCosts`).
- `recurring_expenses` — INSERT `status='detected'` (post-import); UPDATE/UPSERT
  `status='dismissed'` (confirm dismissals + skipped candidates).
- `user_declared_fixed_costs` — INSERT `status='confirmed'`
  (`source='candidate_confirm'|'gap_capture'`); UPDATE `status='dismissed'`.
- `user_merchant_rules` — learned from preview picks (pipeline).
- `value_map_sessions` — summary row + archetype fields (link/VM/archetype).
- `value_map_results` — per-card rows.
- `value_category_rules` — UPSERT: `source='value_map'` (category, sample) /
  `'value_map_personal'` (merchant, real-data).
- `financial_portrait` — UPSERT archetype + 3 traits (`source='value_map'`,
  generate-archetype only).
- `conversations` — INSERT type `'first_insight'`, `metadata.layered_read`,
  `metadata.first_read_metadata.hook_candidates`, `metadata.gap_analysis`.
- `messages` — pre-written assistant Read message.
- `profiling_queue` — asked/answered tracking.
- `demo_sessions`, `demo_question_responses`, `demo_waitlist` — pre-signup demo.
- `user_events` — `value_map_session_linked` analytics.

**Read-only (notable):** `categories`, `merchant_aggregates`, `goals`,
`benchmark_reference`, `merchant_history` (RPC), `bank_accounts`.

---

## D. Shared-module flags (the real isolation boundary)

These modules are imported by onboarding **and** other surfaces. They define what
*cannot* be stripped when isolating onboarding. Stripping or rewriting any of these
breaks dashboard / chat / bills / values surfaces:

1. **`lib/ai/context-builder.ts`** — assembles every chat system prompt and houses
   `getConversationInstructions` for all conversation types. Onboarding uses the
   `'onboarding'` / `'first_insight'` cases; every other surface uses the rest.
2. **`lib/ai/compose-first-read.ts`** — used by both the upload path and onboarding.
3. **`lib/parsers/*`** — every upload surface (onboarding, cash-flow, net-worth, bills).
4. **`lib/categorisation/*`** + **`lib/upload/pipeline.ts`** — all transaction imports.
5. **`lib/analytics/{monthly-snapshot,recurring-detector,reconcile-fixed-costs,gap-analyser}.ts`**
   — feed dashboard, bills, values, monthly review.
6. **`lib/value-map/value-profile.ts`** (`buildUserValueProfile`) + `personalities.ts`
   + `hook-transactions.ts` — Layer-2 used by chat and values surfaces.
7. **`lib/profiling/engine.ts` + `question-registry.ts`** — progressive profiling runs in
   every chat, not just onboarding.
8. **`lib/onboarding/markComplete.ts`** — fired from upload API, chat API, VM insert,
   archetype, and `advanceStep` (5 call sites).
9. **`app/api/upload/route.ts`** + **`app/api/insights/post-upload/route.ts`** — shared
   between onboarding and the standalone upload/insight surfaces.

**Genuinely onboarding-only** (safe to isolate): everything under `app/onboarding-v2/*`
(pages/orchestrators/*-actions), `components/onboarding-v2/*`, `lib/onboarding-v2/{resume,
goal-deferral-quickcheck,value-map-decline-*,free-text-opener-*}.ts`,
`app/api/onboarding*/*`, `app/api/value-map/link-session`,
`app/api/insights/{recompose-first-read,value-map-complete}`, the demo surface, and
`lib/analytics/{recurring-candidates,category-coverage,fixed-cost-classify}.ts`.

---

## E. Known defect register (verified on this branch)

### E1. "5 write-only `user_profiles` columns" — **PARTIALLY STALE / mostly fixed**
The original defect: `values_ranking`, `spending_triggers`, `financial_awareness`,
`capability_preferences`, `savings_rate_target` collected but never injected into
context-builder.

**Current state on this branch:**
- `values_ranking`, `spending_triggers`, `financial_awareness` → **now injected**.
  `context-builder.ts:1365-1367` writes them as flat facts, and a "Psychological lens"
  block (`context-builder.ts:1413-1445`, added in Session 32 / `8d309ee`) makes them
  load-bearing (interpretation + advice-style switching). **No longer a defect.**
- `capability_preferences` → **orphaned**: declared only in
  `migrations/030_onboarding_state.sql` + `lib/supabase/types.ts`. Zero readers, zero
  writers anywhere in `src`. Not collected, not used. Dead column.
- `savings_rate_target` → declared in `migrations/014_nudge_system.sql`; **read only by**
  `lib/nudges/evaluators/payday-savings.ts:36` (defaults to `0.1`), **never written** in
  code and **not** in context-builder.

**Revised defect:** of the original 5, three are fixed; the remaining two are *orphaned
schema* (no collection site at all), not "collected-but-unused". The accurate framing is
"2 dead/under-wired columns", not "5 write-only".

### E2. `wow_assessments.predicted_wow_score` clobber — **CONFIRMED**
- No code anywhere writes a non-null `predicted_wow_score` (grep across `src`).
- `app/api/cron/wow-aggregate/route.ts:172` upserts `predicted_wow_score: null` with
  `onConflict: 'first_insight_message_id'` — so even a hypothetical predicted value would
  be clobbered to null nightly. The admin views (`app/admin/wow/*`) read it but it is
  always null. Confirmed exactly as described.

### E3. Read judge calibrated against the retired first-insight format — **CONFIRMED**
- `tests/onboarding/runner/judge-first-insight.ts` carries a fixed rubric calibrated to
  the **retired** first-insight format: H6 body **100-180 words**, H5 **"— C." signoff**,
  H8 **[OPTIONS] chips** — these are first-insight-era artifacts, not the current Read.
- That judge is **orphaned from the suite**: it is imported only by
  `scripts/compare-first-insight.ts`, **not** by `persona-runner.ts`.
- The persona suite instead judges via generic `judgeOutput(persona, 'insight', …)`
  (`runner/judge.ts`) against whatever `playwright-driver` captured by polling a
  conversation of type `'first_insight'`. So a "green" suite is green against a *generic*
  rubric + per-persona expectations, **not** the current Read-format rubric — and the
  dedicated (stale) rubric isn't exercised at all. Either way, green ≠ "Read format
  validated".

### E4. Naming drift across the measurement layer — **CONFIRMED (multiple)**
- **Persona drift:** the session brief calibrates against "Marcus / James / Sofia". Only
  **Sofia** exists (`personas/sofia-chaotic.ts`). **Marcus** survives only as a code
  comment (`playwright-driver.ts:14` "the first-insight conversation (Marcus path)");
  **James** does not exist at all. Actual personas: aiko-low-transaction, anchor-debt,
  builder-classic, drifter-expat, fortress-saver, skip-csv-upload, skip-value-map,
  sofia-chaotic, time-saver-expert, tom-long-history, truth-teller-balanced, zane-spain.
- **Artifact drift:** the current **Read** (`compose-first-read.ts`,
  `first_read_delivered`) is stored under the legacy conversation type **`'first_insight'`**
  and captured by `pollFirstInsightAssistantMessage`. The DB type label and the
  product term diverge: "first_insight" the type == the current Read the artifact.

---

## F. Open questions for Lewis

1. **Branch naming.** The session brief names the new branch `claude/onboarding-isolation`,
   but the harness assigned `claude/onboarding-isolation-verify-yhP1t` and forbids pushing
   elsewhere without permission. I used the assigned branch. Want me to also create/push
   `claude/onboarding-isolation` as an alias, or keep the verify-suffixed name?
2. **Integration base.** I merged `bank-statement-upload-myqNB` into the visual-3b base
   (your choice) on this review branch. Should the *hardening* session also adopt this
   merged base, or do you want the upload branch landed on `main` first so both tracks
   reconcile there?
3. **Defect E1 reframing.** Given 3 of 5 columns are now wired, do you want the hardening
   session to (a) drop `capability_preferences` as a dead column (staging migration +
   `prod-backfill` companion, not auto-applied), and (b) wire `savings_rate_target`
   collection, or leave it nudge-only with its `0.1` default?
4. **Judge realignment (E3).** Should the hardening session recalibrate `judge.ts` /
   retire `judge-first-insight.ts` to assert against the **current Read** rubric (layers
   cited, hook present, no [OPTIONS]/word-count rules), and rename the `'first_insight'`
   conversation type → `'first_read'` (E4)? The rename touches ~10 call sites + a
   migration.
5. **`predicted_wow_score` (E2).** Wire a real predicted score at compose time and stop the
   cron clobber, or drop the column from `wow_assessments` entirely if prediction isn't on
   the roadmap?
6. **Persona coverage.** Do you want Marcus/James personas authored (to match the brief's
   calibration trio), or should the brief be updated to the actual persona set?

---

## G. Test/judge baseline (staging) — BLOCKED in this environment

Phase 3 (running the persona + archetype suites on staging) **could not run here**:

- `tests/onboarding/runner/preflight.ts` hard-requires `NEXT_PUBLIC_SUPABASE_URL`
  (must contain staging ref `qlbhvlssksnrhsleadzn`), `SUPABASE_SERVICE_ROLE_KEY`,
  `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. None are present in this
  remote environment (no secrets, no `.env.local`), and the staging guard refuses any
  non-staging URL.
- The suite also needs a live dev server (`ensureDevServer`) and EU Bedrock access.

**What did run:** the harness's own unit tests —
`npx vitest run tests/onboarding/unit` → **28/28 passed** (args, csv-summariser,
calculate-personality, preflight). The machinery is sound; only the live persona run is
gated on secrets.

**Calibration caveat (loud):** even if the persona suite *had* run green here, per E3 it
asserts via a generic judge against a `'first_insight'`-typed capture, **not** against a
current-Read rubric — and the dedicated first-insight rubric (calibrated to the retired
100-180-word/"— C."/[OPTIONS] format) isn't wired into the suite at all. **A green run
would be a baseline, not a sign-off on Read quality.**

**To run later (hardening session):** supply the 5 env vars pointing at staging
(`qlbhvlssksnrhsleadzn`) + EU Bedrock creds, then
`npm run test:onboarding -- --personas sofia-chaotic,…` (CLI in
`tests/onboarding/runner/cli.ts`). Primary staging verification user: Dorcas
`c6b1dd54-0c90-47ab-b098-d724d27471f7`.
