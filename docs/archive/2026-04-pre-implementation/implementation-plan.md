Vision
A hybrid chat + dashboard personal finance app that builds a psychological and financial portrait of each user through progressive conversation, delivering increasingly personalised advice powered by Claude via AWS Bedrock — with structured data, system-computed analytics, and proactive nudges supporting the LLM where it can't be trusted alone.

Total estimated build time: 17 days across 13 sessions.

Architecture Overview
text
┌─────────────────────────────────────────────────┐
│                  Vercel (Frontend)               │
│  Next.js App Router + Vercel AI SDK (useChat)    │
│  Dashboard views + Chat interface                │
│  CSV upload + Progressive onboarding UI          │
│  Value Map (/demo route — public)                │
└─────────────┬───────────────────────┬────────────┘
              │                       │
              ▼                       ▼
┌─────────────────────┐  ┌─────────────────────────┐
│   AWS Bedrock       │  │   Supabase              │
│   Claude Sonnet 4.6 │  │   Auth / DB / Storage   │
│   (Intelligence)    │  │   Edge Functions        │
│                     │  │   - Scheduled jobs      │
│   - Chat responses  │  │   - Transaction parser  │
│   - Analysis        │  │   - Analytics engine    │
│   - Advice          │  │   - Nudge system        │
│   - Profile writes  │  │                         │
└─────────────────────┘  └─────────────────────────┘
Key principle: The LLM interprets. The system computes.

Claude never does arithmetic, date calculations, or budget tracking. Supabase Edge Functions compute all financial metrics and inject them as structured context into Claude's system prompt. Claude's job is to understand the user, explain the numbers, and give personalised advice.

Tech Stack
Layer	Technology	Why
Framework	Next.js 14+ App Router	SSR, API routes, file-based routing
Hosting	Vercel	Seamless Next.js deployment, edge functions
Auth	Supabase Auth (email + Google)	Multi-tenant from day one, RLS
Database	Supabase PostgreSQL	Structured financial data, RLS policies
Storage	Supabase Storage	CSV uploads, screenshots, document storage
Chat	Vercel AI SDK (useChat) + AWS Bedrock	Streaming, conversation management
LLM	Claude Sonnet 4.6 via Bedrock	Enterprise-grade routing, single AWS auth
Cron/Background	Supabase Edge Functions + pg_cron	Scheduled analytics, nudges
Styling	Tailwind CSS	Fast, utility-first
State	React state + SWR/React Query	Server state management
Bedrock Provider Setup
typescript
// lib/ai/provider.ts
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';

export const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

export const chatModel = bedrock('anthropic.claude-sonnet-4-6-20250514-v1:0');
export const analysisModel = bedrock('anthropic.claude-sonnet-4-6-20250514-v1:0');
The Vercel AI SDK supports Bedrock as a provider via @ai-sdk/amazon-bedrock. Chat UI, streaming, and tool calling all work identically to a direct API connection — only the backend credentials change. Environment variables are AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY.

⚠️ Test Bedrock streaming and tool calling in Session 2 before building anything that depends on them.

Design Principles → Technical Decisions
1. "Ask late, ask little"
Technical: Email + password only at signup. No registration form. Everything else gathered through conversation or inferred from data.

Schema: user_profiles has mostly nullable columns. Fields populate over time.

Chat: The system tracks which profile fields are empty and prompts only when contextually relevant.

2. "Deliver value before depth"
Technical: Two "aha moments" in the first 5 minutes: Value Map → archetype reveal → CSV/screenshot upload → The Gap analysis.

Implementation: Parser runs instantly. First dashboard render shows spending breakdown before the user has answered a single question.

Chat: First message after upload is Claude presenting the key finding, not asking more questions.

3. "Be explicit about why data is needed"
Technical: Every data collection touchpoint shows a why_needed explanation.

Chat: When Claude asks a question, the system injects what the answer unlocks.

Schema: profile_questions table includes a rationale field shown to users.

4. "Don't rely on the LLM alone"
Technical: All financial calculations happen in SQL/Edge Functions and are injected as structured context.

Categories: Transaction categorization uses a rules engine first, LLM second.

Validation: All Claude profile writes are validated before saving.

Guardrails: Budget alerts, balance tracking, and bill comparisons are system-computed.

5. "Make every interaction trust-building"
Technical: Every chat message shows what Claude knows. The user can always see and correct their profile.

UI: A "What Claude knows about me" panel accessible from any screen. An accuracy score that improves with corrections.

Dual Categorisation System
Every transaction gets two classifications. This is the core differentiator.

Traditional Category (objective, auto-assigned)
Groceries, Dining, Transport, Travel, Entertainment, Shopping, Health, Bills, etc.

Assigned by rules engine first, LLM fallback for unmatched

Used for: budget tracking, month-over-month comparison, spending breakdown

Value Category (subjective, user-influenced)
Category	Meaning
Foundation	Essential to daily functioning
Burden	Necessary but resented
Investment	Builds future value (financial, personal, relational)
Leak	Wasteful or regretted
Unclassified	Not yet categorised
The value category is what makes this app different from every competitor.

How Value Categories Get Assigned
Layer 1 — Value Map seed: When the user completes the Value Map, their categorization patterns create initial rules. If they called gym spending "Investment" and coffee "Foundation", those become baseline mappings.

Layer 2 — Auto-inference: For imported transactions, the system checks value_category_rules first. "Aldi" maps to whatever the user's grocery value category is (typically "Foundation").

Layer 3 — User refinement: In the transaction view, users can tag or re-tag any transaction's value category. These corrections feed back into the rules.

Layer 4 — Claude insight: During monthly reviews, Claude surfaces behavioral shifts. "You tagged 80% of your dining as Investment last month, but this month it's split 50/50 Investment and Leak. What changed?"

Dashboard Views
The dashboard has a toggle: Spending View (traditional categories) | Values View (Foundation/Burden/Investment/Leak)

Spending View: "You spent €416 on dining, €274 on groceries..."

Values View: "62% Foundation (essentials), 18% Investment (things building your future), 12% Leak (things you'd cut if you could), 8% Burden (things you resent but can't avoid)."

The Values View is where the emotional resonance lives. Seeing that 12% of your money is "Leak" is far more motivating than "Entertainment: €535".

The Gap — Feature Specification
The Gap is the feature no other finance app has.

What it is: A comparison between the user's self-reported relationship with money (from the Value Map) and their actual spending behaviour (from CSV/screenshot data).

When it appears:

First time: immediately after the first upload, if Value Map was completed

Ongoing: in monthly reviews when value category patterns shift

On demand: "Show me my gap" in chat

What it looks like:

text
THE GAP — What you believe vs what you do

You said gym is an Investment (confidence: 3/5)
→ Reality: You spent €0 on fitness last month. Your last gym charge was 47 days ago.

You said coffee is Foundation (confidence: 5/5)
→ Reality: €87 on coffee shops this month. It IS your foundation — you weren't wrong.

You said Deliveroo is a Leak (confidence: 5/5)
→ Reality: €0 on delivery apps. You've already eliminated this leak. Well done.

You said dining is an Investment
→ Reality: 21 dining transactions, but 14 were under €12 (quick/solo meals).
   Only 7 were the intentional, relationship-building meals you had in mind.
   Your "Investment" dining is actually 33% Investment, 67% Foundation.
Technical implementation:

Store Value Map categorizations and confidence scores in value_map_results

After import, map real transactions to Value Map categories via value_category_rules

Compare patterns: frequency, amount, trend direction

Claude generates the narrative comparison

Insights stored in financial_portrait with source: 'gap_analysis'

Value Map as Onboarding Funnel
text
┌─────────────────────────────────────────────┐
│  Marketing / Sharing                        │
│  "Take the Value Map → share your archetype"│
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│  Value Map Experience (no signup required)   │
│  10 transactions → personality reading      │
│  Captures: categories, confidence, timing   │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│  Conversion prompt                          │
│  "Want to see what your real spending says? │
│   Upload a statement and find out."         │
└──────────────────┬──────────────────────────┘
                   │ (signup happens here)
                   ▼
┌─────────────────────────────────────────────┐
│  CSV / Screenshot Upload → Auto-analysis    │
│  Traditional + Value categorisation         │
│  "The Gap" — self-perception vs reality     │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│  Full app experience                        │
│  Chat + Dashboard + Progressive profiling   │
└─────────────────────────────────────────────┘
Implementation: Value Map results are stored in value_map_results linked to an anonymous session. When the user signs up, the session is linked to their account and seeds their financial_portrait and value_category_rules.

Porting the Value Map
The Value Map is the only code being carried over from the existing codebase. Everything else is built fresh. The existing implementation already uses Bedrock and saves sessions to Supabase, so this is a straightforward copy-and-update-imports job.

Step 1 — Identify the files to copy
Run this in the existing repo to get the full file list:

bash
# From the root of the existing repo
find . -type f \( -name "*.ts" -o -name "*.tsx" \) | \
  grep -iE "(value.?map|archetype|demo)" | \
  grep -v node_modules | \
  grep -v .next
You should expect to find roughly:

text
app/(public)/demo/page.tsx          ← or app/demo/page.tsx
app/api/value-map/route.ts          ← Bedrock API route
components/value-map/ValueMapFlow.tsx
components/value-map/ArchetypeResult.tsx
components/value-map/TransactionCard.tsx
lib/value-map/transactions.ts       ← sample transaction data
lib/value-map/archetypes.ts         ← archetype definitions
lib/value-map/types.ts              ← TypeScript interfaces
Also check for any Supabase queries or session-handling utilities the Value Map depends on:

bash
grep -r "value_map\|valueMap\|archetype" --include="*.ts" --include="*.tsx" . | \
  grep -v node_modules | \
  grep -v .next | \
  cut -d: -f1 | sort -u
Step 2 — Copy into the new repo
bash
OLD_REPO="../your-old-repo-name"   # adjust to actual path

mkdir -p app/demo
mkdir -p app/api/value-map
mkdir -p components/value-map
mkdir -p lib/value-map

cp -r $OLD_REPO/app/demo/page.tsx ./app/demo/page.tsx
cp -r $OLD_REPO/app/api/value-map/ ./app/api/value-map/
cp -r $OLD_REPO/components/value-map/ ./components/value-map/
cp -r $OLD_REPO/lib/value-map/ ./lib/value-map/
Step 3 — Update import paths only
The existing Value Map already uses Bedrock and already saves results to Supabase. The only change needed is updating import aliases to match the new project's path conventions:

bash
# Find all internal imports in the copied files
grep -rn "from '@/" components/value-map/ app/demo/ app/api/value-map/ lib/value-map/
Remap any paths that don't exist in the new project structure — typically just the Supabase client and any shared utility imports. The AI provider and DB calls should already be correct.

Step 4 — Confirm session_token column exists
The existing implementation saves to value_map_results. Check whether the schema uses a session_token column (for anonymous pre-signup sessions) or links directly to user_id:

bash
grep -rn "session_token\|user_id" app/api/value-map/route.ts
If it links directly to user_id (i.e., required sign-in before the Value Map), add session_token uuid as a nullable column and make user_id nullable too, so anonymous users can complete it before signup. One-line migration change.

Step 5 — Verify
Checklist:

Value Map loads at /demo without auth

Transactions display and are selectable

Archetype result generates via Bedrock

Result is saved to value_map_results

"Upload your statement" CTA at the end routes to signup

This is a 30–60 minute job. The existing implementation already handles the hard parts (Bedrock, Supabase). The only real work is fixing import paths and confirming anonymous session handling.

Porting the Screenshot Upload
The screenshot-to-transactions flow is already working in the existing MVP. Here's how to find all the relevant code and transplant it cleanly.

Step 1 — Find the files
bash
# From the root of the existing repo

# Find API route(s) handling image/vision processing
grep -rl "vision\|screenshot\|image.*base64\|base64.*image\|mediaType\|image_url" \
  --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v .next

# Find Supabase Storage upload calls (images go somewhere before Claude reads them)
grep -rl "storage.*upload\|\.upload(\|storageUrl\|publicUrl" \
  --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v .next

# Find the UI component (file input accepting images)
grep -rl "accept.*image\|image/\|HEIC\|screenshot" \
  --include="*.tsx" . | grep -v node_modules | grep -v .next

# Find where extracted transactions are structured
grep -rn "extracted\|parseStatement\|extractTransactions\|from.*image" \
  --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v .next
You should end up with roughly:

text
app/api/upload/route.ts              ← or a separate /api/screenshot/route.ts
lib/parsers/screenshot.ts            ← Claude vision call + response parsing
components/upload/CSVUploader.tsx    ← already accepts images, or a separate component
Step 2 — Understand the data flow
Before copying, trace the full flow so you know where to plug it into the new pipeline:

bash
# What does the API route return? (transaction array shape)
grep -A 20 "return\|NextResponse" app/api/upload/route.ts | head -40

# How does Claude receive the image? (base64 inline vs presigned URL)
grep -n "base64\|url.*image\|image.*url\|source.*type" lib/parsers/screenshot.ts
The two common patterns are:

Base64 inline: image converted to base64 in the browser → sent in request body → passed directly to Claude

Storage-first: image uploaded to Supabase Storage → presigned URL passed to Claude

Confirm which your MVP uses so you wire the new project identically.

Step 3 — Copy and update imports
bash
OLD_REPO="../your-old-repo-name"

cp $OLD_REPO/lib/parsers/screenshot.ts ./lib/parsers/screenshot.ts
cp $OLD_REPO/app/api/screenshot/route.ts ./app/api/screenshot/route.ts
# — or merge into ./app/api/upload/route.ts if they were combined

cp $OLD_REPO/components/upload/CSVUploader.tsx ./components/upload/CSVUploader.tsx

# Fix import paths
grep -n "from '@/" lib/parsers/screenshot.ts app/api/screenshot/route.ts
Step 4 — Update the Bedrock call (if needed)
If the screenshot parser already uses the Vercel AI SDK + Bedrock, it should work as-is. If it uses the raw Anthropic SDK:

typescript
// BEFORE (raw SDK)
const response = await anthropic.messages.create({
  model: 'claude-...',
  messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', ... } }] }]
});

// AFTER (Vercel AI SDK + Bedrock)
import { analysisModel } from '@/lib/ai/provider';
import { generateText } from 'ai';

const { text } = await generateText({
  model: analysisModel,
  messages: [{
    role: 'user',
    content: [
      { type: 'image', image: base64DataUrl },  // or: image: new URL(presignedUrl)
      { type: 'text', text: extractionPrompt }
    ]
  }]
});
Step 5 — Plug into the shared transaction pipeline
Both CSV and screenshot paths should output the same shape, feeding into the same categorisation and storage logic:

typescript
type ParsedTransaction = {
  date: string;
  description: string;
  amount: number;
  currency: string;
  source: 'csv_revolut' | 'csv_santander' | 'screenshot';
  raw_description: string;
};

// Both paths call the same function downstream:
await categoriseAndStore(parsedTransactions, userId, accountId);
If the existing MVP has CSV and screenshot outputs in different shapes, normalise them here rather than maintaining two separate storage paths.

Step 6 — Verify
Image file accepted in upload UI (PNG, JPG, HEIC)

Image routes to screenshot parser, CSV routes to CSV parser

Claude extracts transactions with reasonable accuracy

Extracted transactions appear in the preview step before confirmation

Confirmed transactions go through the same dual-categorisation pipeline

Source field set to 'screenshot' for traceability

Database Schema (Supabase)
Core Tables
sql
-- Users and profiles (progressive, mostly nullable)
create table user_profiles (
  id uuid primary key references auth.users(id),
  display_name text,
  country text,
  city text,
  primary_currency text default 'EUR',
  age_range text,
  employment_status text,
  gross_salary numeric,
  net_monthly_income numeric,
  pay_frequency text,
  has_bonus_months boolean,
  bonus_month_details jsonb,
  housing_type text,
  monthly_rent numeric,
  relationship_status text,
  partner_employment_status text,
  partner_monthly_contribution numeric,
  dependents integer default 0,
  values_ranking jsonb,
  spending_triggers jsonb,
  risk_tolerance text,
  financial_awareness text,
  advice_style text,
  nationality text,
  residency_status text,
  tax_residency_country text,
  years_in_country integer,
  onboarding_completed_at timestamptz,
  profile_completeness integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Accounts
create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  name text not null,
  type text not null, -- 'spending', 'current', 'savings', 'credit_card', 'investment', 'crypto', 'pension'
  provider text,
  currency text default 'EUR',
  current_balance numeric,
  is_primary_spending boolean default false,
  metadata jsonb,
  created_at timestamptz default now()
);

-- Transactions (with dual categorisation)
create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  account_id uuid references accounts(id),
  date timestamptz not null,
  description text not null,
  amount numeric not null,
  currency text default 'EUR',
  -- Traditional category
  category_id uuid references categories(id),
  auto_category_confidence numeric,
  user_confirmed boolean default false,
  -- Value category
  value_category text, -- 'foundation', 'burden', 'investment', 'leak', null
  -- Context
  is_recurring boolean default false,
  is_shared_expense boolean default false,
  is_holiday_spend boolean default false,
  tags text[],
  notes text,
  source text, -- 'csv_revolut', 'csv_santander', 'screenshot', 'manual'
  import_batch_id uuid,
  raw_description text,
  created_at timestamptz default now()
);

-- Spending categories
create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  name text not null,
  icon text,
  color text,
  monthly_budget numeric,
  is_fixed boolean default false,
  is_essential boolean default true,
  sort_order integer,
  matching_rules jsonb
);

-- Value Map results (supports anonymous pre-signup session)
create table value_map_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  session_token uuid, -- anonymous session, linked to user_id on signup
  responses jsonb not null,
  -- [{
  --   transaction: "PureGym Monthly",
  --   category: "investment",
  --   confidence: 3,
  --   time_to_decide_ms: 4200,
  --   changed_mind: false,
  --   original_category: null
  -- }]
  archetype_name text,
  archetype_subtitle text,
  full_analysis text,
  certainty_areas jsonb,
  conflict_areas jsonb,
  comfort_patterns jsonb,
  country text,
  completed_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Value category rules (learned over time)
create table value_category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  match_type text not null, -- 'traditional_category', 'merchant', 'description_pattern'
  match_value text not null,
  value_category text not null,
  confidence numeric default 0.5,
  source text, -- 'value_map', 'user_explicit', 'inferred'
  created_at timestamptz default now()
);

-- Recurring bills/expenses
create table recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  account_id uuid references accounts(id),
  category_id uuid references categories(id),
  name text not null,
  provider text,
  amount numeric not null,
  currency text default 'EUR',
  frequency text not null,
  billing_day integer,
  current_plan_details jsonb,
  contract_end_date date,
  has_permanencia boolean default false,
  last_optimisation_check timestamptz,
  potential_saving_monthly numeric,
  switch_recommendation text,
  created_at timestamptz default now()
);

-- Financial goals
create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  name text not null,
  description text,
  target_amount numeric,
  current_amount numeric default 0,
  target_date date,
  priority text,
  status text default 'active',
  monthly_required_saving numeric,
  on_track boolean,
  created_at timestamptz default now()
);

-- Investment holdings
create table investment_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  account_id uuid references accounts(id),
  ticker text,
  name text not null,
  asset_type text,
  quantity numeric,
  current_value numeric,
  cost_basis numeric,
  currency text default 'GBP',
  gain_loss_pct numeric,
  allocation_pct numeric,
  last_updated timestamptz default now()
);

-- Conversations
create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  title text,
  type text default 'general', -- 'onboarding', 'monthly_review', 'trip_planning', 'scenario', 'general'
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role text not null,
  content text not null,
  profile_updates jsonb,
  actions_created jsonb,
  insights_generated jsonb,
  tools_used text[],
  created_at timestamptz default now()
);

-- Action items
create table action_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  conversation_id uuid references conversations(id),
  title text not null,
  description text,
  category text,
  priority text,
  status text default 'pending',
  due_date date,
  last_nudge_at timestamptz,
  nudge_count integer default 0,
  completed_at timestamptz,
  created_at timestamptz default now()
);

-- Monthly snapshots (system-computed)
create table monthly_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  month date not null,
  total_income numeric,
  total_fixed_costs numeric,
  total_discretionary numeric,
  total_spending numeric,
  surplus_deficit numeric,
  spending_by_category jsonb,
  value_breakdown jsonb, -- {foundation: 0.62, burden: 0.08, investment: 0.18, leak: 0.12}
  transaction_count integer,
  dining_out_count integer,
  avg_transaction_size numeric,
  largest_transaction numeric,
  largest_transaction_desc text,
  vs_previous_month_pct numeric,
  vs_budget_pct numeric,
  created_at timestamptz default now(),
  unique(user_id, month)
);

-- Financial portrait (LLM-generated, system-validated)
create table financial_portrait (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  trait_type text not null, -- 'behavioral', 'pattern', 'preference', 'insight', 'gap_analysis'
  trait_key text not null,
  trait_value text not null,
  confidence numeric default 0.5,
  evidence text,
  source text, -- 'value_map', 'csv_analysis', 'gap_analysis', 'conversation'
  source_conversation_id uuid references conversations(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, trait_key)
);

-- Nudges
create table nudges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  action_url text,
  trigger_rule jsonb,
  status text default 'pending',
  scheduled_for timestamptz,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz default now()
);
Row Level Security
sql
alter table user_profiles enable row level security;
create policy "Users can view own profile" on user_profiles
  for select using (auth.uid() = id);
create policy "Users can update own profile" on user_profiles
  for update using (auth.uid() = id);
-- Same pattern for all user-scoped tables
Migrations
text
/supabase/migrations/
  001_initial_schema.sql
  002_rls_policies.sql
  003_default_categories.sql
  004_functions.sql
  005_value_map.sql        ← value_map_results, value_category_rules, session_token
  006_value_breakdown.sql  ← adds value_breakdown to monthly_snapshots
Session-Based Implementation Plan
Session 1: Foundation + Value Map (Day 1–2)
Goal: Deployable shell with auth, clean schema, and Value Map running at /demo.

text
Tasks:
├── Create new Next.js project (App Router, TypeScript, Tailwind)
├── Create new Supabase project
│   ├── Run all migrations (001–006)
│   ├── Enable RLS on all tables
│   └── Configure auth (email + Google OAuth)
├── Configure Vercel deployment
│   ├── Environment variables (Supabase + AWS credentials)
│   └── Preview deploys from Git
├── Build layout shell
│   ├── Auth pages (sign in, sign up)
│   ├── Authenticated layout with sidebar navigation
│   ├── Routes: /demo (public), /chat, /dashboard, /profile
│   └── Mobile-responsive navigation
├── Seed default categories trigger on user creation
├── Integrate Value Map at /demo (see "Porting the Value Map" section)
│   ├── Copy component files from existing repo
│   ├── Update import paths
│   ├── Confirm anonymous session handling
│   └── Wire conversion CTA → signup
└── Verify: /demo loads, archetype generates, result saves to DB, signup works
Session 2: Chat Foundation on Bedrock (Day 2–3)
Goal: Working chat interface connected to Claude via Bedrock with conversation persistence.

text
Tasks:
├── Install @ai-sdk/amazon-bedrock
├── Build lib/ai/provider.ts (chatModel, analysisModel)
├── Build /api/chat route with Bedrock streaming
├── Build chat UI
│   ├── Message list with user/assistant styling
│   ├── Input field with streaming response indicator
│   ├── Conversation history sidebar
│   └── Mobile-optimised layout
├── Conversation persistence
│   ├── Create conversation on first message
│   ├── Save messages to Supabase after each exchange
│   └── Load conversation history on page load
├── System prompt architecture
│   ├── Base financial advisor persona
│   ├── Context injection: user_profiles, monthly_snapshots, goals, action_items
│   ├── Context injection: financial_portrait, value_map archetype (if exists)
│   └── Token budget management
└── Verify: multi-turn conversation streams correctly, persists across page loads
⚠️ Test tool calling with Bedrock here before Session 7 depends on it.

System prompt structure:

text
[Base persona and rules]
[User profile: {injected from user_profiles}]
[Financial summary: {injected from monthly_snapshots}]
[Active goals: {injected from goals}]
[Recent action items: {injected from action_items}]
[Financial portrait traits: {injected from financial_portrait}]
[Value Map archetype: {injected if value_map_results exists}]
[Available tools: {function definitions}]
[Current conversation context]
Session 3: CSV Engine + Dual Categorisation (Day 3–5)
Goal: Upload a CSV or screenshot → parse → assign both traditional and value categories → store.

text
Tasks:
├── Upload UI (CSV + Screenshot)
│   ├── Drag-and-drop zone accepting CSV files and image files (PNG/JPG/HEIC)
│   ├── Format auto-detection (Revolut CSV, Santander XLSX, or screenshot)
│   ├── Upload progress indicator
│   └── Transaction preview before confirming import
├── Screenshot upload (port from existing MVP — see "Porting Screenshot Upload" section)
│   ├── Image uploaded to Supabase Storage
│   ├── Image passed to Claude vision via Bedrock (base64 or presigned URL)
│   ├── Claude extracts transactions: date, description, amount, currency
│   ├── Extracted transactions fed into same pipeline as CSV-parsed transactions
│   └── User reviews extracted rows before confirming (accuracy varies)
├── CSV parsers (Edge Function)
│   ├── Revolut: Type, Date, Description, Amount, Fee, Balance columns
│   ├── Santander: Spanish XLSX format, comma decimals
│   ├── Generic fallback with column mapping UI
│   └── Duplicate detection (same date + amount + description)
├── Auto-categorisation engine
│   ├── Rules-based first pass (pattern matching on description)
│   │   ├── Default rules: Aldi|Mercadona|Caprabo → Groceries
│   │   ├── User-defined rules (learned from corrections)
│   │   └── Confidence scoring (exact match = 1.0, fuzzy = 0.6)
│   └── LLM second pass for unmatched (batched, lower confidence score)
├── Value category assignment layer
│   ├── Check value_category_rules for user
│   ├── If Value Map completed: apply seed rules from value_map_results
│   ├── If no rules: leave value_category null
│   └── Confidence scoring for both category types
├── Transaction storage with dual categories
├── Post-import Edge Function
│   ├── Compute monthly_snapshots (including value_breakdown)
│   ├── Detect recurring transactions
│   ├── Flag potential shared/holiday expenses
│   └── Identify holiday spending clusters (foreign merchants)
└── User correction flow
    ├── Click to recategorize any transaction (traditional or value)
    ├── "Apply to all similar" option
    └── Corrections feed back into value_category_rules
Session 4: The Double Aha Moment (Day 5–6)
Goal: After upload, trigger the first insight conversation — including The Gap if Value Map was completed.

text
Tasks:
├── Post-upload chat trigger (auto-starts after import completes)
│   ├── Inject spending_by_category + value_breakdown as structured context
│   ├── If Value Map completed: run Gap analysis
│   │   ├── Compare value_map_results categorizations vs actual spend
│   │   ├── Claude narrates the comparison ("You said gym is Investment...")
│   │   └── Insights saved to financial_portrait (source: 'gap_analysis')
│   └── If no Value Map: standard spending insight (biggest category, surprises)
├── Structured follow-up questions (2–3 max, tappable options)
├── Answers update user_profiles and financial_portrait
├── Profile completeness tracking
│   ├── Calculate % based on filled fields
│   └── Show progress indicator in sidebar (no pressure, just visibility)
└── Verify: upload → double aha moment fires → profile partially seeded
Session 5: Dashboard with Dual Views (Day 6–8)
Goal: Clean dashboard with toggle between Spending View and Values View.

text
Tasks:
├── Spending View (traditional categories)
│   ├── Monthly summary cards (income, expenses, surplus/deficit)
│   ├── Month selector
│   ├── Spending by category (horizontal bar chart)
│   ├── Weekly breakdown and trend line
│   └── Category detail: click → all transactions + month comparison
├── Values View (Foundation/Burden/Investment/Leak)
│   ├── Proportional breakdown visualisation
│   ├── "Your money is..." summary statement
│   ├── Drill-down into each value category
│   └── Uncategorised transactions queue
├── View toggle (Spending ↔ Values)
├── Recurring expenses panel
│   ├── Auto-detected recurring charges with monthly total
│   └── Flag if a charge changed amount
├── Transaction list
│   ├── Filterable by month, category, amount range
│   ├── Searchable by description
│   ├── Inline recategorisation (both traditional and value)
│   └── Flag as shared/holiday/recurring
└── Charts: spending over time, category donut, income vs expenses stacked bar
Session 6: Progressive Profiling Engine (Day 8–10)
Goal: A system that knows what data is missing and collects it naturally through conversation.

Value Map conflict areas inform question priority — if the Value Map showed high uncertainty around "Investment" spending, the profiling engine asks about goals first.

text
Tasks:
├── Profile gap analyser (Edge Function)
│   ├── Priority ranking: which gaps block the most valuable advice?
│   ├── Context rules for each question
│   │   ├── "Ask about partner only if shared expenses detected"
│   │   ├── "Ask about goals only after baseline spending is established"
│   │   └── "Ask about investments only if savings surplus exists"
│   └── Value Map conflict areas used to set question priority
├── Chat-integrated data collection
│   ├── Structured input components in chat (single select, slider, number input)
│   ├── User response → function call → update user_profiles
│   └── Claude explains what each answer unlocks
├── Value exchange messaging
│   └── "Knowing your rent lets me calculate your true discretionary income"
├── Profile corrections flow
│   ├── "What do you know about me?" command renders profile as editable cards
│   └── Corrections update profile + recalculate analytics
└── Verify: 3–4 questions appear naturally over first two conversations
Session 7: Function Calling + Tools (Day 10–12)
Goal: Give Claude the ability to call system-computed functions for all data and calculations.

text
Tasks:
├── Define Claude tools
│   ├── calculate_monthly_budget (income, fixed costs, discretionary target)
│   ├── get_spending_summary (total, count, avg, top merchants, vs_budget)
│   ├── compare_months (category-by-category comparison)
│   ├── model_scenario (salary_increase, property_purchase, children)
│   ├── search_bill_alternatives (web search for better deals)
│   ├── update_user_profile (validated field write)
│   ├── create_action_item
│   ├── get_action_items
│   ├── get_value_breakdown (Foundation/Burden/Investment/Leak split)
│   ├── compare_values_vs_perception (The Gap on demand)
│   └── suggest_value_recategorisation
├── Tool execution API route (authenticated, error-handled)
└── Verify: "How did my spending compare last month?" → tool call → accurate answer
Design principle applied: Every number Claude presents comes from a system-computed tool, not from Claude doing mental maths.

Session 8: Monthly Review Flow (Day 12–13)
Goal: A structured monthly review including value category shifts.

text
Tasks:
├── Monthly review conversation type
│   ├── Triggered on new month's upload or manual "Start review" button
│   └── Structured flow: summary → highlights → concerns → value shifts → actions
├── Review content
│   ├── Month overview (income, spending, surplus/deficit)
│   ├── Category performance vs budget
│   ├── Value category shifts month-over-month
│   │   └── "Foundation dropped to 55%, Leak increased to 19%. The shift
│   │       happened mostly in dining — from 70% Investment to 50% Leak."
│   ├── Progress toward goals
│   ├── Recurring bill changes detected
│   └── Updated action items (completed + new)
├── Review output
│   ├── Chat-based walkthrough with inline charts
│   ├── Summary saved to monthly_snapshots (with value_breakdown)
│   ├── New action items created
│   └── Financial portrait traits updated if patterns shift
└── Verify: new month uploaded → review fires → value shifts surfaced → actions created
Session 9: Bill Optimisation Engine (Day 13–15)
text
Tasks:
├── Bill detection from transactions
│   ├── Auto-detect recurring charges by pattern
│   ├── Match to known providers (Iberdrola, Digi, Sanitas, etc.)
│   └── Extract plan details from uploaded bills (PDF/image)
├── Optimisation research
│   ├── Claude web search for alternatives (tariff comparison)
│   └── Results stored with potential_saving_monthly
├── Contract monitoring (nudge when expiry approaching)
└── Verify: upload Iberdrola bill → details extracted → alternatives researched → saving shown
Session 10: Trip Planning & Scenario Modelling (Day 15–17)
text
Tasks:
├── Trip planning flow
│   ├── Collect: destination, duration, dates, travel style, companions
│   ├── Claude researches flights, accommodation, daily costs
│   ├── Budget breakdown with category-level estimates
│   ├── Funding plan: which months to save, what to cut
│   └── Trip saved as a goal with target amount and date
├── Scenario modelling
│   ├── Salary increase, property purchase, children, career change
│   └── Before/after on key metrics with inline charts
└── Verify: plan a Japan trip → detailed budget → funding plan. Model salary increase → goal impact.
Session 11: Nudge System & Proactive Intelligence (Day 17–19)
text
Tasks:
├── Nudge rules engine
│   ├── Payday transfer reminder (detect salary deposit → remind to save)
│   ├── Budget alert (spending approaching category limit)
│   ├── Bill due date and contract expiry reminders
│   ├── Monthly review prompt (7 days after month end)
│   └── Action item reminder (after N days of inactivity)
├── Nudge delivery (in-app badge, email digest, chat-initiated)
├── Nudge preferences (frequency control, snooze, smart back-off)
└── Scheduled jobs (pg_cron + Edge Functions: daily, weekly, monthly, quarterly)
Session 12: Profile View & Trust Transparency (Day 19–20)
text
Tasks:
├── "What Claude knows about me" page
│   ├── Organised by category (basics, income, expenses, behaviour, goals)
│   ├── Each field shows source: "you told me", "inferred from data", "uploaded"
│   ├── Edit any field inline, delete any data point
│   └── Profile completeness visualisation
├── Financial portrait view
│   ├── Behavioural traits with evidence and confidence scores
│   └── "Is this accurate?" feedback buttons
├── Data management (export JSON/CSV, delete account, import history log)
└── Trust indicators: data freshness, "Based on X months of data" labels
Session 13: Polish, Testing & Deploy (Day 20–22)
text
Tasks:
├── Error handling
│   ├── CSV/screenshot parsing failures (graceful feedback)
│   ├── Bedrock API failures (fallback messages)
│   └── Network errors and validation messages
├── Performance
│   ├── Indexes on user_id + date for dashboard queries
│   ├── Lazy load chart components
│   └── Edge caching for static assets
├── Mobile responsiveness
│   ├── Chat-first on mobile
│   ├── Touch-friendly category selection
│   └── Responsive charts
├── Security review
│   ├── RLS policies tested on every table
│   ├── All API routes authenticated
│   ├── AWS credentials server-side only
│   └── No PII in client-side logs
└── Seed real data and run full end-to-end verification
Product Metrics to Track
Activation
Value Map completion rate

Value Map → signup conversion rate

Time to first upload (CSV or screenshot)

Time to first aha moment (Value Map archetype + The Gap)

Engagement
Monthly active conversations

Uploads per month (CSV vs screenshot split)

Value category corrections (signals engagement with the framework)

Action items completed vs created

Retention
Monthly review completion rate

Week-over-week chat sessions

Profile completeness over time

Nudge open/action rate

Trust (most important)
Profile corrections per session (initially high = good; later high = bad)

"What Claude knows about me" page visits

Data deletion requests (should be near zero)

Value category re-categorisation frequency (some = healthy; too much = system is wrong)

Post-MVP Roadmap
Fast Follow (Week 4–5)
Open Banking integration (TrueLayer for EU) — automatic transaction ingestion

Investment tracking — broker API connections or manual portfolio input

Shared expenses — split detection and tracking

Medium Term (Month 2–3)
Mobile app (React Native or PWA)

Push notifications for nudges

Multi-currency dashboard (EUR + GBP unified view)

Tax scenario modelling (cross-border UK/Spain)

Longer Term
Waitlist and onboarding for other users

Partner financial profiles (shared household view)

Bill switching automation (one-click provider switch)

Investment rebalancing suggestions

Key Files Structure
text
/app
  /demo
    /page.tsx                     ← Value Map (public, no auth required)
  /api
    /chat/route.ts                ← Vercel AI SDK + Bedrock handler
    /value-map/route.ts           ← Value Map analysis endpoint (ported)
    /upload/route.ts              ← CSV + screenshot upload (routes to correct parser)
    /screenshot/route.ts          ← Screenshot-specific handler (if separate, ported)
    /tools/[tool]/route.ts        ← Claude function execution
    /cron/[job]/route.ts          ← Scheduled jobs
  /(auth)
    /login/page.tsx
    /signup/page.tsx
  /(app)
    /layout.tsx
    /chat/page.tsx
    /chat/[id]/page.tsx
    /dashboard/page.tsx           ← Spending View + Values View toggle
    /transactions/page.tsx
    /goals/page.tsx
    /bills/page.tsx
    /profile/page.tsx
    /settings/page.tsx
/lib
  /ai
    /provider.ts                  ← Bedrock provider (chatModel, analysisModel)
  /supabase
    /client.ts
    /queries.ts
    /types.ts
  /chat
    /system-prompt.ts
    /context-builder.ts
    /tools.ts
  /value-map
    /transactions.ts              ← Ported
    /archetypes.ts                ← Ported
    /types.ts                     ← Ported
  /parsers
    /revolut.ts
    /santander.ts
    /generic.ts
    /screenshot.ts                ← Claude vision extraction (ported)
  /categorizer
    /rules.ts
    /value-categories.ts          ← Value category assignment layer
    /llm-categorizer.ts
  /analytics
    /monthly-snapshot.ts          ← Includes value_breakdown computation
    /recurring-detector.ts
    /holiday-detector.ts
    /gap-analysis.ts              ← The Gap computation
  /nudges
    /rules.ts
    /scheduler.ts
/components
  /value-map
    /ValueMapFlow.tsx             ← Ported
    /ArchetypeResult.tsx          ← Ported
  /chat
    /ChatInterface.tsx
    /MessageBubble.tsx
    /StructuredInput.tsx
    /TypingIndicator.tsx
  /dashboard
    /SpendingChart.tsx
    /CategoryBreakdown.tsx
    /ValuesBreakdown.tsx          ← Foundation/Burden/Investment/Leak view
    /MonthlyCards.tsx
    /TrendLine.tsx
    /ViewToggle.tsx               ← Spending ↔ Values toggle
  /upload
    /CSVUploader.tsx              ← Accepts CSV + images (ported if modified)
    /TransactionPreview.tsx
  /profile
    /ProfileCard.tsx
    /TraitDisplay.tsx
    /EditableField.tsx
/supabase
  /migrations
    /001_initial_schema.sql
    /002_rls_policies.sql
    /003_default_categories.sql
    /004_functions.sql
    /005_value_map.sql
    /006_value_breakdown.sql
