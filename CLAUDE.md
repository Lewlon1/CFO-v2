# CLAUDE.md — The CFO's Office

## What This Is

A trust-first personal finance advisor that combines chat (Claude via Bedrock) with a structured dashboard to help users understand and optimise their financial lives. Users share data gradually through conversation and CSV uploads, receiving increasingly personalised advice powered by an AI "CFO" that knows their numbers, understands their psychology, and gives honest strategic advice.

The product name is **The CFO's Office**. The metaphor: walking into a startup CFO's office for a chat about your personal finances.

---

## CFO Constitution

`CFO-CONSTITUTION.md` is the source document for the CFO's identity, voice, capabilities, and boundaries. All system prompts in `cfos-office/src/lib/ai/` derive from it. When prompts and the Constitution conflict, the Constitution wins and the prompt is rewritten. Read the Constitution before any prompt change.

---

## Versioning

The CFO's Office uses MAJOR.MINOR versioning, tied to architectural epochs and shipping milestones — not chronology or session count.

- **MAJOR** — Architectural shifts: new product surface, new monetisation tier, fundamental data model change
- **MINOR** — Each session that lands a meaningful, deployable change
- **PATCH** (.x.y) — Hotfixes only, between planned sessions

### Current

- **v2.6** — Audit Zero: codebase + database consolidation + doc reconciliation (current)
- **v2.0** — Office filesystem architecture, onboarding flow merged (baseline)

### Roadmap

| Version | Description | Status |
|---|---|---|
| v2.1–v2.5 | Phases A–C + Sessions 26–32 (chat intelligence, folder fix-up, primitives, layered Read, value-first onboarding, bill benchmark) | Shipped |
| v2.6 | Audit Zero — codebase + DB consolidation + doc reconciliation | Shipped (this session) |
| v2.7 | Phase D — Mobile/a11y polish | Planned |
| v2.8 | Sessions 28–30 — Confidence / Prediction / Value Map Retake | Designed |
| v2.9 | Phase E — Brand continuity (auth + landing) | Planned |
| v3.0 | Premium tier launch (~August 2026) | Future |

### Conventions

- **Versions ship, sessions don't.** A version exists once its work is merged and deployed. v2.1 does not exist until Phase A is on main.
- **Skipped sessions still consume version numbers.** If v2.4 ships before v2.3, v2.3 stays reserved.
- **Each version is git-tagged** on main: `git tag v2.X && git push --tags`
- **Each version updates `package.json`** to match (write as full semver: `2.1.0`).
- **Each version gets a `SESSION-LOG.md` entry** with the version as the heading.
- **Session prompts reference their target version** in the header (e.g. "Session v2.1 — Phase A").

---

## Repo layout

Source code lives in `cfos-office/`. All file paths in this document (e.g. `lib/...`, `app/...`, `components/...`) are relative to that directory. When Claude Code is invoked from the repo root, prefix paths with `cfos-office/` to access the actual files.

Other top-level directories:
- `docs/audits/` — current audit snapshots (V2 branch state, dead code, component consolidation, lessons learned)
- `docs/decisions/` — open decision records
- `docs/design/` — design mockups
- `docs/archive/` — historical: pre-implementation specs, superseded audits, completed cleanup tracks

---

## Architecture

```
Frontend:  Next.js App Router on Vercel
Auth:      Supabase Auth (email + Google OAuth)
Database:  Supabase PostgreSQL with RLS
Storage:   Supabase Storage (CSV uploads, bill images)
Chat:      Vercel AI SDK (@ai-sdk/amazon-bedrock) → Claude Sonnet 4.6
Background: Vercel cron (cfos-office/vercel.json → /api/cron/*)
Styling:   Tailwind CSS
```

### Core Architectural Rule

**The LLM interprets. The system computes.**

Claude never does arithmetic, date calculations, budget tracking, or financial projections in its head. All numbers are computed by Edge Functions or SQL queries and injected into Claude's context as structured data. Claude's job is to understand the user, explain the numbers, and give personalised advice.

When Claude needs a calculation, it calls a tool. The tool executes against the database and returns the result. Claude then presents and interprets that result.

---

## Design Principles

These are not aspirational. They are implementation constraints.

### 1. Ask late, ask little
- Registration is email + password only. Nothing else.
- Profile fields are nullable. They populate over time through conversation.
- The profiling engine suggests 1-2 questions per conversation, never more.
- Questions only appear when contextually relevant.
- If the conversation doesn't naturally lead to a question, don't force it.

### 2. Deliver value before depth
- The first "aha moment" happens within 5 minutes of CSV upload.
- The Value Map delivers value before signup even happens.
- Every conversation should leave the user with at least one actionable insight.
- Don't gate value behind data collection. Show what you can with what you have.

### 3. Be explicit about why data is needed
- Every structured input shows a rationale: why this is asked and what it unlocks.
- In chat, Claude explains what answering a question enables.
- The profile page shows what's known, what's missing, and what each gap costs in advice quality.

### 4. Don't rely on the LLM alone
- Financial calculations: Edge Functions, not Claude.
- Transaction categorisation: rules engine first, LLM fallback.
- Profile updates from conversation: validated before saving.
- Budget alerts and bill monitoring: system-computed cron jobs.
- Claude's function calls are validated server-side before writing to the database.

### 5. Make every interaction trust-building
- Users can always see and edit what the system knows about them.
- Confidence scores are visible where the system infers data.
- Claude acknowledges uncertainty. "Based on 3 months of data" not "your spending is..."
- Every correction makes the system more accurate. Corrections are easy and encouraged.

---

## Tech Stack Details

### Package manager

This repo uses **npm**. Do not use pnpm or yarn — they fail on this repo's hoisting expectations. Use `npm ci` for clean installs (lockfile-driven) and `npm run build` / `npm run typecheck` for verification.

### Bedrock Configuration

```typescript
// lib/ai/provider.ts
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

export const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION!,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
});

export const chatModel = bedrock('anthropic.claude-sonnet-4-6-20250514-v1:0');
```

### Model Routing

- `chatModel` (Sonnet) — CFO chat, scenario planning, monthly reviews, all user-facing conversation.
- `analysisModel` (Sonnet) — retained for any analysis calls that need Sonnet quality.
- `utilityModel` (Haiku) — structured extraction where personality/nuance doesn't matter: transaction categorisation fallback (`lib/categorisation/llm-categoriser.ts`) and post-conversation portrait analysis (`app/api/analyze-conversation/route.ts`). ~¼ the cost of Sonnet at equivalent quality for classification tasks.

Model IDs resolve from `BEDROCK_CLAUDE_MODEL` / `BEDROCK_CLAUDE_UTILITY_MODEL` env vars, falling back to `eu.anthropic.claude-sonnet-4-6` and `eu.anthropic.claude-haiku-4-5` respectively. EU inference profiles only — no data leaves EU.

### Prompt Caching

The chat route system prompt is sent as a system-role message with `providerOptions.bedrock.cachePoint: { type: 'default' }` so it is cached across turns within a 5-minute TTL. First turn writes the cache (~1.25x cost on that segment); subsequent turns read it (~0.1x). Cache hit/write metrics land in `[bedrock-usage]` console logs via `lib/ai/usage-logger.ts`.

### Environment Variables Required

```
# Supabase — Claude can apply migrations to staging but never to production.
# All SQL migrations to production require approval by Lewis.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AWS Bedrock
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# Bedrock model overrides
BEDROCK_OPUS_MODEL=        # Bedrock model id for archetype generation (value-map/reveal)

# External services
BRAVE_SEARCH_API_KEY=      # Bill optimisation web search (lib/bills/brave-search.ts)
RESEND_API_KEY=            # Transactional email + alerting

# Cron + alerting
CRON_SECRET=               # Bearer token validated by all /api/cron/* handlers
ALERT_EMAIL=               # Recipient address for error alert webhook
ALERT_WEBHOOK_URL=         # Resend webhook URL for error alerts

# App
NEXT_PUBLIC_APP_URL=
```

### Feature flags

Active branch-scoped flags:

- **`isLayeredReadEnabled()`** in [cfos-office/src/lib/feature-flags/layered-read.ts](cfos-office/src/lib/feature-flags/layered-read.ts) — **default-ON since #55**: returns `true` unless `LAYERED_READ_DISABLED=true` (a runtime kill-switch). Gates the layered Read tools (`get_cluster_behaviour`, `get_conversation_signals`), the layered system-prompt section, the `chat_signals` extractor hook, and the value-first onboarding sequence. The `!isLayeredReadEnabled()` branches + the legacy `computeFirstInsight` path are retained as rollback and slated for removal once the layered flow is proven in prod.

---

## Key Concepts

### Dual Categorisation

Every transaction gets TWO classifications:

**Traditional category** (objective, auto-assigned):
Groceries, Dining, Transport, Travel, Entertainment, Shopping, Health, Bills, etc.
Assigned by rules engine (pattern matching on description), with LLM fallback for unmatched.
Used for: budget tracking, month-over-month comparison, spending breakdown.

**Value category** (subjective, user-influenced):
- **Foundation**: essential to daily functioning
- **Burden**: necessary but resented
- **Investment**: builds future value (financial, personal, relational)
- **Leak**: wasteful or regretted
- **Unclassified**: not yet categorised

Value categories are initially seeded from the Value Map (if the user completed it), then refined through user interaction. The dashboard toggles between "Spending View" (traditional) and "Values View" (Foundation/Burden/Investment/Leak).

### The Value Map

A pre-signup experience where The user categorises 10 sample transactions into Foundation/Burden/Investment/Leak/Don't Know, with a confidence rating. The system also tracks decision time and changes of mind.

The results are sent to Claude which generates a personality archetype (e.g. "The Drifter — your money moves without a plan") with a detailed analysis of what the categorisation patterns reveal about their relationship with money.

**Integration flow:**
1. User completes Value Map (no account required)
2. Results stored with anonymous session ID
3. User signs up → session linked to account
4. Value Map results seed: financial_portrait, value_category_rules
5. After CSV upload → "The Gap" analysis compares self-perception with reality

### The layered Read (current architecture)

The CFO composes natural-language insight by drawing from five layers:

1. **Transactions** — the facts (counts, totals)
2. **Stated Intent (Value Map)** — what the user said categories mean to them
3. **Behavioural Features** — recurrence, trend, time pattern, amount profile, lifecycle, derived per merchant or category cluster
4. **Conversational Signals** — regret, enjoyment, context (who / event / situation) mined from prior chat
5. **Goals & Life Context** — what the user is trying to do, as the relevance filter

The CFO never names the layers or uses internal vocabulary ("verdict", "joy signal", "the Gap"). It cites specific facts and asks sharp questions.

"The Gap" — comparing stated intent vs actual behaviour — survives as a *capability* the CFO invokes when Layer 2 and Layer 3 diverge. It is no longer a separate feature surface.

**Source of truth:** [cfos-office/docs/the-layers.md](cfos-office/docs/the-layers.md). See also: [`buildUserValueProfile`](cfos-office/src/lib/value-map/value-profile.ts) (Layer 2), `cfos-office/src/lib/analytics/cluster-behaviour/` (Layer 3 — Session 32 A), `cfos-office/src/lib/analytics/chat-signals/` (Layer 4 — Session 32 A).

### Progressive Profiling

A priority queue that determines which profile questions to ask and when. See the full specification in the intelligence layer document. Key rules:
- Maximum 1-2 questions per conversation
- Questions have triggers (context keywords, dependencies, minimum conversation count)
- Three input methods: structured (inline components), conversational (Claude function calling), inferred (Claude extracts from natural speech)
- Confidence thresholds determine auto-save vs confirmation vs explicit ask

### Onboarding completion

A user is considered onboarded when `user_profiles.onboarding_completed_at` is non-null. **Either the first Read or the Value Map can stamp the timestamp.** Under the value-first flow (the default — see the layered-read flag below), the first Read is the completion gate; the Value Map is an opt-in deepening move that also satisfies completion when the user takes it.

The value-first onboarding sequence (`app/onboarding-v2/*`):

1. **Goal chat (goal-only).** `completeGoalBeat` / `skipGoalBeat` in `app/onboarding-v2/goal-beat-actions.ts` confirm or skip a goal and stamp `onboarding_step = 'upload_pending'`, routing to `/onboarding-v2/upload`. Essentials are NOT collected here, and neither beat stamps `onboarding_completed_at`. There is no Marcus bifurcation — the skip path routes to upload like the confirm path.
2. **Upload → processing.** On import the step advances to `upload_processing`; the `/onboarding-v2/processing` screen hosts an income + rent form alongside the parse wait (income blur fires an instant goal-pace line via a server action). On submit: `details_pending`.
3. **Confirm / reconcile.** `/onboarding-v2/confirm` dedupes user-declared vs detected fixed costs and writes `monthly_snapshots.total_fixed_costs`. On confirm: `details_confirmed`.
4. **First Read.** Composed in `value_first` mode, leading with the Layer-1 picture and closing on a HOOK + `[CTA:start_value_map_real]`. Delivery stamps `first_read_delivered` — **this is the completion gate**; the Value Map is now pure upgrade.
5. **Value Map (optional).** Runs on the real flagged transactions named by the hook, then `/api/insights/recompose-first-read` appends a Layer-2-aware follow-up Read into the same conversation. Skipping leaves the user fully onboarded.

Legacy stamps (`essentials_done`, `goal_set`, `goal_skipped`) are retained so users mid-flow are not stranded; they route forward to `/upload`.

Two paths can set the completion timestamp:

1. **Modal path** (legacy onboarding-modal surface) — seeded `financial_portrait` via `seedFromOnboarding`. **The `POST /api/onboarding/complete` route has been removed** (post-onboarding-v2; Audit Zero confirmed zero callers and it is absent from the route inventory).
2. **Permissive path** (`markOnboardingCompleteIfReady(supabase, userId)` in `lib/onboarding/markComplete.ts`) — fires from the upload API, chat API, Value Map session insert, archetype generation, and from `advanceStep` when reaching read-terminal states.

**Eligibility predicate (permissive path):** `user_profiles` row exists, `anonymised_at IS NULL`, `onboarding_completed_at IS NULL`, AND either (a) a `value_map_sessions` row exists for `profile_id = userId`, OR (b) `onboarding_step` is in `{'first_read_shown', 'first_read_delivered', 'archetype_shown', 'complete'}`.

The timestamp is a one-way ratchet (the UPDATE is gated by `.is('onboarding_completed_at', null)`). The Value Map is not mandatory for completion; users who skip it complete via the Read.

**Layered-read flag / kill-switch.** The value-first layered Read is on by default (`isLayeredReadEnabled()` in `lib/feature-flags/layered-read.ts` returns true). Set `LAYERED_READ_DISABLED=true` (env / Vercel) to instantly revert every user to the legacy pre-layered onboarding with no redeploy — kept as a runtime rollback through the first live cohort. The dead pre-layered path is slated for removal in a follow-up once the layered flow is proven in prod. Going live requires migrations `062`–`069` applied in the target environment.

### The CFO Persona

Warm, sharp, and conversational — like a smart mate who happens to be brilliant with money. Knows the user's numbers inside out. Pushes back when needed but never lectures. Uses real numbers and tangible comparisons ("that's a weekend in Lisbon every month") instead of financial jargon. Adjusts tone based on user preference (gentle/direct/blunt).

A CFO guides — they don't decide for you.

Key persona rules:
- Use actual numbers and tangible comparisons, never generic ranges or jargon
- Never lecture — explain once, then move to action
- When spending contradicts values, name it once without judgement, then help
- Acknowledge limitations honestly and specifically (not a licensed adviser, can't do tax)
- Reference past conversations naturally
- Never use the product name "The CFO's Office" in conversation — you are "your CFO"
- Talk like a person, not a product
- Never say "advice" or "advise" — use "guidance", "suggestion", or just say what you'd do

---

## File Structure

```
/app
  /api
    /chat/route.ts                    # Vercel AI SDK chat handler with Bedrock
    /upload/route.ts                  # CSV upload + parse + categorise
    /tools/[tool]/route.ts            # Claude function call execution
    /cron/portrait-extraction/route.ts # Daily 06:00 UTC sweep of completed conversations
    /cron/daily-bills/route.ts        # Daily 08:00 UTC bill monitoring
    /cron/nudges-daily/route.ts       # Daily 07:00 UTC nudge evaluation
    /cron/nudges-weekly/route.ts      # Monday 08:00 UTC weekly nudges
    /cron/nudges-monthly/route.ts     # 1st of month 08:00 UTC monthly snapshot
  /(public)
    /demo/page.tsx                    # Value Map (pre-signup)
    /demo/result/page.tsx             # Value Map personality result
  /(auth)
    /login/page.tsx
    /signup/page.tsx
  /(app)
    /layout.tsx                       # Authenticated layout with sidebar nav
    /chat/page.tsx                    # New conversation
    /chat/[id]/page.tsx               # Existing conversation
    /dashboard/page.tsx               # Financial overview (dual view toggle)
    /transactions/page.tsx            # Transaction list with filters
    /bills/page.tsx                   # Recurring expenses + optimisation
    /goals/page.tsx                   # Goal tracker
    /profile/page.tsx                 # "What your CFO knows" — view/edit profile
    /settings/page.tsx                # Preferences, data management, export
/lib
  /ai
    /provider.ts                      # Bedrock client setup
    /system-prompt.ts                 # Base CFO persona
    /context-builder.ts               # Assembles dynamic system prompt
    /tools.ts                         # Claude tool definitions
    /tool-executor.ts                 # Validates and executes tool calls
  /profiling
    /question-registry.ts             # All profile questions with metadata
    /engine.ts                        # Priority queue logic
  /parsers
    /index.ts                         # Format auto-detection
    /revolut.ts                       # Revolut CSV parser
    /santander.ts                     # Santander XLSX parser (Spanish format)
    /generic.ts                       # Generic CSV with column mapping
  /categorizer
    /rules-engine.ts                  # Pattern-matching categorisation
    /llm-categorizer.ts              # Claude fallback for unmatched
    /value-categorizer.ts             # Value category assignment
  /analytics
    /monthly-snapshot.ts              # Compute monthly summary
    /recurring-detector.ts            # Find recurring transactions
    /holiday-detector.ts              # Cluster foreign merchant spending
    /gap-analyser.ts                  # Compare Value Map vs actual spending
  /nudges
    /rules.ts                         # Nudge trigger definitions
    /scheduler.ts                     # Evaluation and scheduling logic
  /supabase
    /client.ts                        # Supabase client (browser + server)
    /queries.ts                       # Reusable query functions
    /types.ts                         # Generated from schema
/components
  /chat
    /ChatInterface.tsx                # Main chat container
    /MessageBubble.tsx                # User and assistant messages
    /StructuredInput.tsx              # Inline form components in chat
    /ConversationList.tsx             # Sidebar conversation history
  /dashboard
    /SpendingView.tsx                 # Traditional category breakdown
    /ValuesView.tsx                   # Foundation/Burden/Investment/Leak view
    /MonthlyCards.tsx                 # Summary metric cards
    /TrendChart.tsx                   # Spending over time
    /ViewToggle.tsx                   # Switch between Spending/Values
  /transactions
    /TransactionList.tsx
    /CategoryBadge.tsx                # Traditional category pill
    /ValueBadge.tsx                   # Value category pill
    /RecategoriseModal.tsx            # Change category (both types)
  /upload
    /CSVUploader.tsx                  # Drag-and-drop with format detection
    /TransactionPreview.tsx           # Preview before confirming import
  /profile
    /ProfileCard.tsx                  # Grouped profile fields
    /TraitDisplay.tsx                 # Financial portrait traits
    /CompletenessIndicator.tsx        # Visual progress
    /EditableField.tsx                # Inline edit any field
  /value-map
    /ValueMapFlow.tsx                 # The 10-transaction experience
    /ArchetypeResult.tsx              # Personality reading display
    /TransactionCard.tsx              # Individual transaction to categorise
/supabase
  /migrations
    /001_initial_schema.sql
    /002_rls_policies.sql
    /003_indexes.sql
    /004_triggers_and_functions.sql
    /005_seed_data.sql
```

---

## System Prompt Architecture

The system prompt is assembled dynamically per conversation. See `lib/ai/context-builder.ts`.

### Assembly Order

Assembled in `lib/ai/context-builder.ts:buildSystemPrompt()`. Sections joined with `\n\n---\n\n`; empty sections are filtered out before joining.

```
 1. Base persona + style modifier      (system-prompt.ts: BASE_PERSONA)
 2. Current date context
 3. Profile context
 4. Onboarding entry context
 5. Value Map bridge context
 6. Financial context
 7. Country benchmarks
 8. Conversation instructions
 9. Portrait context
10. Balance sheet context
11. Goals context
12. Trips context
13. Tool usage instructions
14. Value mapping context
15. Value check-in nudge context
16. Retake suggestion context
17. Prediction quality context
18. Profiling context
```

### Critical Instructions in System Prompt

```
IMPORTANT RULES:
- Always use the system-provided financial numbers. Never calculate yourself.
- If you need a number that isn't provided, call the appropriate tool.
- When the user shares personal or financial information, call update_user_profile
  to store it. Always confirm what you've noted.
- Maximum 1-2 profile questions per conversation. Don't force them.
- Use the request_structured_input tool when you need precise numeric data.
- Reference the user's Value Map archetype and traits naturally, don't list them.
- When spending contradicts their stated values, name it without judgement.
```

### Tool Definitions

```typescript
const tools = {
  update_user_profile: {
    description: "Update the user's profile when they share relevant information. Call this whenever they mention income, expenses, living situation, relationships, goals, or preferences. Validate with the user what you've noted.",
    parameters: {
      updates: "Array of {field, value, confidence} objects",
      source_summary: "Brief description of what the user said"
    }
  },
  
  request_structured_input: {
    description: "Ask for specific data using an appropriate input component (number, select, slider, currency amount). Use this for critical numeric data where precision matters.",
    parameters: {
      field: "Profile field name",
      input_type: "currency_amount | single_select | multi_select | number | slider",
      label: "Question to display",
      options: "For select types: array of options",
      rationale: "Why this is needed (shown to user)",
      validation: "Min/max/required constraints"
    }
  },
  
  get_spending_summary: {
    description: "Get spending data for a date range, optionally filtered by category.",
    parameters: {
      date_from: "Start date",
      date_to: "End date",
      category: "Optional traditional category filter",
      value_category: "Optional value category filter"
    }
  },
  
  compare_months: {
    description: "Compare spending between two months.",
    parameters: { month_a: "YYYY-MM", month_b: "YYYY-MM" }
  },
  
  get_value_breakdown: {
    description: "Get the Foundation/Burden/Investment/Leak breakdown for a period.",
    parameters: { date_from: "Start date", date_to: "End date" }
  },
  
  model_scenario: {
    description: "Model a financial what-if scenario.",
    parameters: {
      scenario_type: "salary_increase | property_purchase | children | career_change | investment_growth",
      parameters: "Scenario-specific parameters"
    }
  },
  
  search_bill_alternatives: {
    description: "Research better deals for a recurring bill.",
    parameters: {
      bill_type: "electricity | gas | internet | phone | insurance",
      current_provider: "Provider name",
      current_amount: "Monthly cost",
      usage_details: "kWh, speed, plan details"
    }
  },
  
  create_action_item: {
    description: "Create a tracked action item for the user.",
    parameters: {
      title: "Action title",
      description: "Details",
      category: "bill_switch | savings_transfer | investment | admin | research",
      priority: "high | medium | low",
      due_date: "Optional due date"
    }
  },
  
  analyse_gap: {
    description: "Compare Value Map self-perception with actual spending data.",
    parameters: { months: "Number of months of data to analyse" }
  }
};
```

---

## Data Extraction from Conversation

Three channels with different reliability:

### Channel A: Structured Inputs (Highest Reliability)
For critical numeric data. Claude calls `request_structured_input` → frontend renders inline component → user submits → writes to DB immediately.

Use for: salary, rent, bill amounts, age range, currency, country.

### Channel B: Function Calling (Medium Reliability)  
Claude calls `update_user_profile` when it detects relevant information in conversation.

Validation rules:
- Confidence > 0.8: auto-save, mention naturally in response
- Confidence 0.6-0.8: save but confirm with user
- Confidence < 0.6: don't save, ask explicitly
- Never silently overwrite a user-confirmed value with an inferred one

Use for: relationship status, employment details, behavioral observations, preferences.

### Channel C: Post-Conversation Analysis (Supplementary)
The post-conversation extractor reads a completed conversation's transcript and writes behavioural traits to `financial_portrait` with `source = 'post_conversation'`. Implementation lives at `lib/ai/portrait-extraction.ts` (Haiku via `utilityModel`).

Use for: spending patterns, behavioral traits, value shifts, contradictions.

**Trigger conditions.** Portrait entries are written from the following sources:

- **`balance_sheet`** — when `updateAssetPortrait()` runs after an asset/liability upsert (`lib/balance-sheet/portrait.ts`).
- **`gap_analysis`** — when `analyseGap()` runs after Value Map completion or check-in (`lib/analytics/gap-analyser.ts`).
- **`post_conversation`** — when a previously active conversation transitions to `status = 'completed'` (which happens when a user starts a new conversation or a new monthly review). Both call sites — `app/api/chat/route.ts` and `app/api/review/start/route.ts` — wrap the work in Next.js `after()` so it runs after the response is sent. The daily cron at `/api/cron/portrait-extraction` (06:00 UTC) sweeps any completed conversations from the last 7 days where `analysed_at IS NULL` to catch transient failures. Both paths stamp `conversations.analysed_at` on terminal outcomes (success or "too few messages") so neither double-processes.
- **`manual_reextraction`** — ad-hoc backfill via `scripts/reextract-portrait.ts`. Outputs SQL inserts to stdout; never auto-applied.

**Failure handling.** Bedrock or DB failures throw out of `extractFromConversation`, leaving `analysed_at` NULL so the cron retries. The throw triggers `sendAlert({ severity: 'critical', event: 'portrait_extraction_after_failed' | 'portrait_extraction_cron_failures' })` via the standard `lib/alerts/notify.ts` webhook. Silent pipeline failures are the failure mode this whole layer exists to prevent — historical context: S-W1.5-11 was triggered by zero `post_conversation` entries existing in prod for three weeks despite 28 completed conversations.

**Operational alarm.** A user with `≥10` user messages and zero portrait entries from `source = 'post_conversation'` is a red flag. Cross-check `llm_usage_log` for `call_type = 'post_conversation_analysis'` rows and `conversations.analysed_at` for unprocessed completed rows to localise the failure.

---

## Session Implementation Order

### Session 1: Foundation + Value Map (Day 1-2)
New project, schema, auth, layout, Value Map from MVP.

### Session 2: Chat on Bedrock (Day 2-3)
Vercel AI SDK + Bedrock streaming, conversation persistence, system prompt.

### Session 3: Document upload + Dual Categorisation (Day 3-5)
Build document upload system, build categorisation pipeline with both category types.

### Session 4: The Aha Moment + The Gap (Day 5-6)
Post-doc analysis, Value Map comparison, first profile seeding.

### Session 5: Dashboard with Dual Views (Day 6-8)
Spending View + Values View, charts, transaction list.

### Session 6: Progressive Profiling (Day 8-10)
Question registry, profiling engine, structured inputs in chat.

### Session 7: Function Calling + Tools (Day 10-12)
All Claude tools, validation layer, tool execution.

### Session 8: Monthly Review (Day 12-13)
Structured review flow with value category shifts.

### Session 9: Bill Optimisation (Day 13-15)
Recurring expense detection, bill upload, alternative research.

### Session 10: Trip Planning + Scenarios (Day 15-17)
Trip budgeting, scenario modelling, web search integration.

### Session 11: Nudge System (Day 17-19)
Rules engine, scheduled jobs, delivery.

### Session 12: Profile Transparency (Day 19-20)
"What your CFO knows" page, edit/delete, data export.

### Session 13: Polish + Deploy (Day 20-22)
Error handling, performance, security review, seed user #1 data.

---

## Mobile-First Design

**This is a mobile-first product.** Chat is the primary interface and most users will be on their phones. Every screen must be fully functional on mobile before adding desktop enhancements.

### Rules

- **Viewport height**: Always use `h-dvh` (dynamic viewport height), never `h-screen`. On iOS Safari, `100vh` doesn't shrink when the URL bar hides — `100dvh` does.
- **Sidebars are desktop-only**: Use `hidden md:flex` (not `flex md:flex`). The mobile layout is a single full-width column.
- **Touch targets**: All interactive elements must be at least 44×44px (`min-h-[44px]`, `min-w-[44px]`).
- **No auto-focus on mobile**: Auto-focusing a textarea pops the keyboard immediately, covering content. Guard with `window.matchMedia('(pointer: fine)')` to focus only on mouse-driven devices.
- **Input anchored at bottom**: Chat input is always at the bottom of the flex column — never scrolls with content. Achieved via `flex flex-col` on the container with `flex-1 overflow-y-auto` on the messages area.
- **Overflow discipline**: Chat layout uses `overflow-hidden` so scrolling is scoped to the messages container, not the page.
- **Safe area insets**: When adding bottom-anchored UI (chat input, tab bars), account for `env(safe-area-inset-bottom)` on iPhone X+.

### Tailwind Pattern

```
Mobile (base)          → no prefix
Tablet (768px+)        → md:
Desktop (1024px+)      → lg:
```

Write styles for the smallest screen first, then layer in larger-screen overrides.

---

## Design system — folder accent palette

The four office folders each have an accent colour applied as a left border + icon tint on the home folder card. All four live in [`cfos-office/src/lib/tokens.ts`](cfos-office/src/lib/tokens.ts) as `folderColors`. Single-value (not theme-aware) — accents preserve folder identity across light and dark themes.

| Folder | Token | Hex | Notes |
|---|---|---|---|
| Goals | `folderColors.goals` | `#9C7B2C` | Deeper brass — anchors as the prime folder |
| Cash Flow | `folderColors.cashflow` | `#22C55E` | Green |
| Values | `folderColors.values` | `#7C4D9E` | Royal purple (retoned from amber in v2.5) |
| Net Worth | `folderColors.networth` | `#06B6D4` | Cyan |

**Rule:** never hardcode these hex values inline. Import `folderColors` from `@/lib/tokens` and reference the token. The four-folder palette is the load-bearing visual identity of the office home — divergence creates inconsistency.

History: Goals' provisional accent (Session 11) was `#D4A24C`, too close to the old Values amber; Session 14 shifted Goals to `#9C7B2C`. **v2.5** dropped the **Scenarios** folder (What-If moved into chat via the `model_scenario` tool; `/scenarios` → `/office/goals`) and retoned **Values** from `#E8A84C` amber to `#7C4D9E` royal purple, cleanly separating it from Goals' brass.

---

## Visual consistency enforcement — the lock (Visual Consistency Phase 4)

The colour + radius consolidation is **CI-enforced**. The full spec (exhaustive exception
list, token tables) lives in [`cfos-office/UI-DIRECTION.md`](cfos-office/UI-DIRECTION.md);
the non-negotiable rule:

- **Every colour and radius reads from a token.** A raw hex, an `rgb()/rgba()` literal, an
  arbitrary Tailwind colour bracket (`(bg|text|border|ring|fill|stroke|from|to|via)-[#…]`),
  or an arbitrary `rounded-[…]` of **4px+** is an **ESLint error → CI failure**.
  `rounded-[≤3px]` is permitted for thin chart bars (no named token exists below
  `rounded-control` 8px). Type sizes (`text-[…]`) and spacing brackets (`p-[…]`, `gap-[…]`)
  are **NOT** enforced yet — that's a tracked **wave two** (type + spacing tokenisation); do
  not assume they're locked.
- **`globals.css` (`:root` + `:root[data-theme="light"]` + `@theme inline`) is the single
  colour source of truth.** `src/lib/tokens.ts` is a typed `var()` accessor over it. **Never
  introduce a third source** (this is why the Gap's `quadrant-tokens.ts` palette was moved
  onto `--gap-quadrant-*` vars). Radius scale: `rounded-control` (8) · `rounded-card` (14) ·
  `rounded-pill` (full).
- **`dark:` utilities are inert** — the only theme switch is the `data-theme` attribute
  (`.dark` is statically pinned in `app/layout.tsx`). Never use `dark:`.
- **Fonts of record (F1 — Cormorant kept), 6 families:** root (`app/layout.tsx`) — Instrument
  Serif · Instrument Sans · Geist Mono; office subtree (`app/(office)/layout.tsx`) — DM Sans ·
  JetBrains Mono · Cormorant Garamond (briefing serif + "CFO's Office" wordmark).

**Drift-proofing prongs.** The first two run automatically in CI
([`.github/workflows/ci.yml`](.github/workflows/ci.yml) — `npm ci` → `typecheck` → `lint` →
`knip` → `test`, on every push to `main` and every PR); the third is a manual dev surface:

1. **ESLint guards** — `cfo/visual-token-guards` in `cfos-office/eslint.config.mjs` (colour +
   radius bans, scoped to `src/**`). Enforced in CI via `npm run lint`.
2. **knip** — `cfos-office/knip.json` gates unused-file + unused-dependency drift. Enforced in
   CI via `npm run knip`. (Unused `exports`/`types`/`duplicates` checks are relaxed: those
   findings are Audit-Zero-verified false positives — registry dispatch, named+default pairs,
   generated `supabase/types.ts`. Tightening them is a follow-up requiring feature-code cleanup.)
3. **`/styleguide`** — `cfos-office/src/app/styleguide/` (dev-only via `notFound()` in
   production) is the canonical visual-regression surface: every primitive, every state, both
   themes. **Manual / eyeball only — NOT run in CI** (automated snapshot testing is an optional
   later follow-up).

Documented exceptions (brand marks, html2canvas share-cards, the ChatSheet shadow, DB-coupled
`CATEGORY_COLORS`, merchant-code/entity/test false positives, thin bar radii) carry a
site-level `eslint-disable` with a reason — see UI-DIRECTION.md for the full list.

---

## Common Pitfalls (Learned from MVP)

1. **Don't let Claude do maths.** It will get cash flow wrong. Every number comes from a query or Edge Function.

2. **Don't assume billing frequency.** Gas and water in Spain are often bi or tri monthly. Always check and flag.

3. **Save data progressively.** If a form or chat collects 5 pieces of data, save each one as it's confirmed. Never wait for a "submit all" action.

4. **Don't over-collect upfront.** The impulse is to ask everything during onboarding. Resist it. Ask late, ask little. A profile that fills up over 5 conversations is better than an onboarding wall that users abandon.

5. **The LLM will confidently extract wrong data.** Always validate. A confidence threshold below 0.6 should trigger an explicit question, not a silent save.

6. **Holiday spending distorts averages.** Tag foreign merchant clusters as holiday spending and show baseline vs holiday spending separately.

7. **Token budget is real.** A fully populated profile + 6 months of snapshots + portrait + goals can easily hit 4000+ tokens of context. Prioritise ruthlessly. Current month data > historical. Active goals > completed.

---

## Known data limitations

### Message audit trail

The `messages.tools_used`, `messages.profile_updates`, `messages.actions_created`,
and `messages.insights_generated` columns are populated on a forward basis only,
starting from the deploy of S-W1.5-10 (2026-05-03 — adjust if deploy slips).

Messages created before that date have these four columns as NULL by design — they
predate the parser fix. The previous parser looked for `tool-call` / `tool-result`
part types that don't exist in AI SDK v6 UIMessage format, so it silently wrote NULL
for every assistant message.

When running disclosure analytics across historical conversations, treat pre-cutoff
messages as data-unavailable, not data-empty. The dedicated tables (`action_items`,
`user_profiles`, `financial_portrait`, `value_category_rules`, `assets`,
`liabilities`, `goals`) remain the source of truth for what was actually written.
The message audit trail exists to reconstruct *when within a conversation* something
happened.

---
## Playwright tests
End-to-end tests live in `cfos-office/tests/onboarding/` (personas, runner, unit tests, and runtime output under `test-output/`).
`.claude/settings.json` excludes this directory from Claude Code's
auto-discovery to preserve context budget during normal dev sessions.

When editing a spec or debugging a failing test, explicitly read the file in
the session prompt's Phase 0 — for example:
`cat cfos-office/tests/onboarding/runner/playwright-driver.ts`

Deny rules only suppress auto-globbing; explicit reads still work.
