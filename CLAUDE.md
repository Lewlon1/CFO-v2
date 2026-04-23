# CLAUDE.md — The CFO's Office

## What This Is

A trust-first personal finance advisor that combines chat (Claude via Bedrock) with a structured dashboard to help users understand and optimise their financial lives. Users share data gradually through conversation and CSV uploads, receiving increasingly personalised advice powered by an AI "CFO" that knows their numbers, understands their psychology, and gives honest strategic advice.

The product name is **The CFO's Office**. The metaphor: walking into a startup CFO's office for a chat about your personal finances.
---

## Architecture

```
Frontend:  Next.js App Router on Vercel
Auth:      Supabase Auth (email + Google OAuth)
Database:  Supabase PostgreSQL with RLS
Storage:   Supabase Storage (CSV uploads, bill images)
Chat:      Vercel AI SDK (@ai-sdk/amazon-bedrock) → Claude Sonnet 4.6
Background: Supabase Edge Functions + pg_cron
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

### Environment Variables Required

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AWS Bedrock
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# App
NEXT_PUBLIC_APP_URL=
```

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

### The Gap

The killer feature. Compares what users believe about their spending (from Value Map) with what their actual transactions show.

Example: "You called gym spending an Investment (confidence 3/5). Reality: you haven't been charged by a gym in 47 days."

This appears after the first document upload (if Value Map was completed), in monthly reviews when patterns shift, and on demand in chat.

### Progressive Profiling

A priority queue that determines which profile questions to ask and when. See the full specification in the intelligence layer document. Key rules:
- Maximum 1-2 questions per conversation
- Questions have triggers (context keywords, dependencies, minimum conversation count)
- Three input methods: structured (inline components), conversational (Claude function calling), inferred (Claude extracts from natural speech)
- Confidence thresholds determine auto-save vs confirmation vs explicit ask

### The CFO Persona

Direct, knowledgeable, strategic. Knows the user's numbers. Pushes back when needed. Remembers everything. Adjusts tone based on user preference (gentle/direct/blunt). A CFO advises — they don't decide for you.

Key persona rules:
- Use actual numbers, not generic ranges
- Never lecture — explain once, then move to action
- When spending contradicts values, name it without judgement
- Acknowledge limitations honestly (not a licensed advisor, can't do tax)
- Reference past conversations naturally

---

## File Structure

```
/app
  /api
    /chat/route.ts                    # Vercel AI SDK chat handler with Bedrock
    /upload/route.ts                  # CSV upload + parse + categorise
    /tools/[tool]/route.ts            # Claude function call execution
    /cron/daily/route.ts              # Daily nudge check
    /cron/monthly/route.ts            # Monthly snapshot generation
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

```
1. Base CFO persona (always included, ~300 tokens)
2. Profile context — what we know about this user (~200 tokens)
3. Financial summary — system-computed numbers (~400 tokens)
4. Financial portrait — behavioral traits + Value Map (~300 tokens)
5. Goals and action items (~200 tokens)
6. Profiling questions — what to ask if natural (~150 tokens)
7. Conversation type instructions (~200 tokens)
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
Edge Function runs after conversation ends. Sends transcript to Claude for behavioral trait extraction. Results written to financial_portrait.

Use for: spending patterns, behavioral traits, value shifts, contradictions.

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

## Common Pitfalls (Learned from MVP)

1. **Don't let Claude do maths.** It will get cash flow wrong. Every number comes from a query or Edge Function.

2. **Don't assume billing frequency.** Gas and water in Spain are often bi or tri monthly. Always check and flag.

3. **Save data progressively.** If a form or chat collects 5 pieces of data, save each one as it's confirmed. Never wait for a "submit all" action.

4. **Don't over-collect upfront.** The impulse is to ask everything during onboarding. Resist it. Ask late, ask little. A profile that fills up over 5 conversations is better than an onboarding wall that users abandon.

5. **The LLM will confidently extract wrong data.** Always validate. A confidence threshold below 0.6 should trigger an explicit question, not a silent save.

6. **Holiday spending distorts averages.** Tag foreign merchant clusters as holiday spending and show baseline vs holiday spending separately.

7. **Token budget is real.** A fully populated profile + 6 months of snapshots + portrait + goals can easily hit 4000+ tokens of context. Prioritise ruthlessly. Current month data > historical. Active goals > completed.

---
## Playwright tests
End-to-end tests live in `cfos-office/tests/onboarding/` (personas, runner, unit tests, and runtime output under `test-output/`).
`.claude/settings.json` excludes this directory from Claude Code's
auto-discovery to preserve context budget during normal dev sessions.

When editing a spec or debugging a failing test, explicitly read the file in
the session prompt's Phase 0 — for example:
`cat cfos-office/tests/onboarding/runner/playwright-driver.ts`

Deny rules only suppress auto-globbing; explicit reads still work.
