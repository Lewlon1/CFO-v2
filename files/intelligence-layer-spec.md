# Intelligence Layer Specification
## Progressive Profiling, Context Injection & Conversation Data Extraction

---

## The Problem

When a user says "I earn €2,700 after tax and get double pay in November" during a casual conversation, three things need to happen:

1. **Extract:** The system identifies that net_monthly_income=2700 and bonus_month_details includes November
2. **Store:** Those values are written to user_profiles with a source reference
3. **Reference:** Every future conversation includes this data in Claude's context so it never asks again

If any of these fail, the experience breaks. The user repeats themselves (trust lost), gets wrong advice (trust destroyed), or never gets asked the right follow-up (value lost).

This document specifies how all three work together.

---

## Part 1: Conversation Data Extraction

### The Three Channels

Data enters the system through three channels, each with different reliability:

#### Channel A: Structured Inputs (Highest Reliability)
For critical numeric data where precision matters.

These are interactive components rendered inline in the chat — not a form page, not a modal. They appear as part of the conversation flow when the CFO needs a specific answer.

**When to use:** Salary, rent, age range, currency, country, bill amounts — anything where a wrong number compounds into wrong advice.

**How it works:**
```
CFO: "What's your take-home pay each month?"

[Rendered inline: currency selector + number input]
  € [________] per month

User taps/types: € 2,700

→ Immediately writes to user_profiles.net_monthly_income
→ Claude confirms: "Got it — €2,700 net monthly."
```

**Implementation:**
- Define a `structured_input` tool that Claude can call
- Tool specifies: field_name, input_type, label, options (if select), validation rules
- Frontend renders the appropriate component inline
- On submit: writes to DB via API, returns confirmation to Claude
- Claude acknowledges naturally and continues

```typescript
// Tool definition
{
  name: "request_structured_input",
  description: "Ask the user for a specific piece of information using an appropriate input component",
  parameters: {
    field: "net_monthly_income",
    input_type: "currency_amount", // or "single_select", "number", "text", "slider"
    label: "What's your take-home pay each month?",
    currency: "EUR", // pre-filled from profile
    validation: { min: 0, max: 50000 },
    rationale: "This determines your monthly budget capacity and savings potential"
  }
}
```

#### Channel B: Function Calling (Medium Reliability)
For data that emerges naturally in conversation.

When the user says something that contains profile-relevant information, Claude calls an `update_profile` function to store it. This is the "surgical extraction" from free text.

**When to use:** Relationship status, employment details, behavioral traits, preferences, context clues.

**How it works:**
```
User: "My girlfriend is American, she's between jobs right now and 
       we're thinking about maybe getting a place together next year"

Claude internally calls:
  update_profile({
    relationship_status: "in_relationship",
    partner_nationality: "American",
    partner_employment_status: "unemployed",
    potential_life_events: ["cohabitation"]
  })

CFO: "Got it. With your girlfriend between jobs, you're carrying most 
      of the household costs right now. When she starts working again,
      that changes your savings picture significantly."
```

**Implementation:**
```typescript
// Tool definition
{
  name: "update_user_profile",
  description: "Update the user's financial profile when they share relevant personal or financial information during conversation. Call this whenever the user mentions income, expenses, living situation, relationships, employment, goals, or any other financially relevant details. Always confirm what you've noted with the user.",
  parameters: {
    updates: [
      { field: "relationship_status", value: "in_relationship", confidence: 0.9 },
      { field: "partner_nationality", value: "American", confidence: 0.95 },
      { field: "partner_employment_status", value: "unemployed", confidence: 0.8 }
    ],
    source_summary: "User mentioned girlfriend is American and between jobs"
  }
}
```

**Validation layer (critical):**
- The API endpoint validates each update before writing
- Numeric fields: range checks (salary can't be negative or €1M)
- Enum fields: value must be in allowed list
- Confidence threshold: updates below 0.6 confidence are queued for confirmation rather than auto-saved
- The system NEVER silently overwrites a user-confirmed value with an inferred one

**Confirmation pattern:**
- For high-confidence extractions (>0.8): save and mention naturally. "Noted that you're based in Barcelona."
- For medium-confidence (0.6-0.8): save but flag. "I've noted you're renting — is that right?"
- For low-confidence (<0.6): don't save, ask explicitly. "Are you renting or do you own your place?"

#### Channel C: Post-Conversation Analysis (Supplementary)
For behavioral insights and patterns that emerge over multiple conversations.

After each conversation, an Edge Function runs a lightweight analysis pass that looks for:
- Behavioral traits (spending triggers, risk attitudes, decision patterns)
- Life changes (new job, relationship change, move)
- Goal refinements (more specific about vague goals)
- Contradictions (said they're disciplined but data shows otherwise)

**When to use:** Financial portrait traits, behavioral patterns, confidence adjustments.

**How it works:**
```
After conversation ends:

Edge Function sends conversation transcript + current financial_portrait to Claude:
"Review this conversation. Identify any new behavioral traits, pattern changes, 
 or profile updates that should be recorded. Return structured JSON."

Claude returns:
{
  "new_traits": [
    {
      "trait_key": "social_spending_pattern",
      "trait_value": "Spends more when friends suggest plans, but rarely initiates expensive outings",
      "confidence": 0.7,
      "evidence": "User said 'my dining is mostly when friends suggest going out'"
    }
  ],
  "profile_corrections": [],
  "suggested_follow_ups": ["Ask about typical monthly social commitments in next conversation"]
}
```

**Implementation:** Supabase Edge Function triggered by conversation status change to 'completed'. Runs asynchronously. Results written to financial_portrait and profiling_queue tables.

---

## Part 2: Progressive Profiling Engine

### Architecture

The profiling engine is a priority queue that knows:
1. What the system doesn't know yet (empty profile fields)
2. What would be most valuable to learn next (unlocks better advice)
3. When it's appropriate to ask (contextual triggers)
4. How to ask (structured input vs conversational vs inferred)

### The Profile Question Registry

Every collectible data point is registered with metadata:

```typescript
// lib/profiling/question-registry.ts

type ProfileQuestion = {
  field: string;                    // user_profiles column
  priority: number;                 // 1-10, higher = ask sooner
  input_method: 'structured' | 'conversational' | 'inferred';
  input_config?: StructuredInputConfig;
  
  // When to ask
  triggers: {
    on_signup: boolean;             // ask during initial onboarding?
    on_csv_upload: boolean;         // ask after first CSV analysis?
    context_keywords: string[];     // ask if user mentions these topics
    depends_on: string[];           // only ask if these fields are filled
    min_conversations: number;      // don't ask until N conversations
  };
  
  // Trust building
  rationale: string;                // shown to user: why we need this
  value_unlocked: string;           // what becomes possible with this data
  
  // Grouping
  category: 'basics' | 'income' | 'expenses' | 'housing' | 'goals' | 
            'behavior' | 'investments' | 'relationships' | 'tax';
};
```

### The Question Priority Queue

```typescript
// Ordered by when they should be asked in a typical user journey

const PROFILE_QUESTIONS: ProfileQuestion[] = [

  // === PHASE 1: Immediate (signup + first CSV) ===
  
  {
    field: "primary_currency",
    priority: 10,
    input_method: "structured",
    input_config: { type: "single_select", options: ["EUR", "GBP", "USD"] },
    triggers: { on_signup: true },
    rationale: "So I show amounts in the right currency",
    value_unlocked: "All financial displays use your currency",
    category: "basics"
  },
  {
    field: "country",
    priority: 10,
    input_method: "structured",
    // Note: this is already captured by the Value Map if they came through that flow
    triggers: { on_signup: true },
    rationale: "Tax rules and financial products vary by country",
    value_unlocked: "Country-specific advice and optimisations",
    category: "basics"
  },
  
  // === PHASE 2: After first CSV upload ===
  
  {
    field: "net_monthly_income",
    priority: 9,
    input_method: "structured",
    input_config: { type: "currency_amount", label: "Monthly take-home pay" },
    triggers: { on_csv_upload: true },
    rationale: "I need to know what comes in to understand what goes out",
    value_unlocked: "I can calculate your real surplus and budget capacity",
    category: "income"
  },
  {
    field: "has_bonus_months",
    priority: 8,
    input_method: "conversational",
    triggers: { depends_on: ["net_monthly_income"], context_keywords: ["salary", "pay", "bonus"] },
    rationale: "Irregular income changes how we plan",
    value_unlocked: "I can build a cash flow plan around your pay cycle",
    category: "income"
  },
  {
    field: "housing_type",
    priority: 8,
    input_method: "structured",
    input_config: { type: "single_select", options: ["Renting", "Mortgage", "Own outright", "Living with family"] },
    triggers: { on_csv_upload: true },
    rationale: "Housing is usually your biggest expense",
    value_unlocked: "I can separate fixed costs from discretionary spending",
    category: "housing"
  },
  {
    field: "monthly_rent",
    priority: 8,
    input_method: "structured",
    input_config: { type: "currency_amount" },
    triggers: { depends_on: ["housing_type"], condition: "housing_type === 'renting'" },
    rationale: "Rent determines your fixed cost baseline",
    value_unlocked: "Accurate monthly budget calculation",
    category: "housing"
  },

  // === PHASE 3: After initial analysis is delivered ===
  
  {
    field: "age_range",
    priority: 7,
    input_method: "structured",
    input_config: { type: "single_select", options: ["18-25", "26-30", "31-35", "36-40", "41-50", "50+"] },
    triggers: { min_conversations: 1, context_keywords: ["retirement", "pension", "future", "goal"] },
    rationale: "Your age shapes the investment timeline and strategy",
    value_unlocked: "Retirement projections and age-appropriate advice",
    category: "basics"
  },
  {
    field: "employment_status",
    priority: 7,
    input_method: "conversational",
    triggers: { depends_on: ["net_monthly_income"] },
    rationale: "Employment type affects tax, pension, and stability",
    value_unlocked: "Advice on workplace benefits and pension optimisation",
    category: "income"
  },
  {
    field: "values_ranking",
    priority: 7,
    input_method: "structured",
    // If they came through Value Map, we already have a seed for this
    triggers: { min_conversations: 2, context_keywords: ["priorities", "important", "goal", "dream"] },
    rationale: "What matters most to you shapes every recommendation I make",
    value_unlocked: "Truly personalised advice aligned with your values",
    category: "behavior"
  },
  
  // === PHASE 4: Ongoing (ask when contextually relevant) ===
  
  {
    field: "relationship_status",
    priority: 5,
    input_method: "inferred", // usually mentioned naturally
    triggers: { context_keywords: ["partner", "girlfriend", "boyfriend", "wife", "husband", "alone", "single"] },
    rationale: "Shared finances change the picture significantly",
    value_unlocked: "Household-level financial planning",
    category: "relationships"
  },
  {
    field: "partner_monthly_contribution",
    priority: 5,
    input_method: "conversational",
    triggers: { depends_on: ["relationship_status"], condition: "relationship_status !== 'single'" },
    rationale: "Knowing shared costs helps calculate your true personal spending",
    value_unlocked: "Accurate personal vs household expense split",
    category: "relationships"
  },
  {
    field: "risk_tolerance",
    priority: 5,
    input_method: "structured",
    input_config: { type: "slider", min: 1, max: 10, labels: { low: "Very cautious", high: "High risk OK" } },
    triggers: { context_keywords: ["invest", "stocks", "savings", "risk", "crypto"] },
    rationale: "Your comfort with risk determines the right investment approach",
    value_unlocked: "Investment recommendations matched to your psychology",
    category: "behavior"
  },
  {
    field: "spending_triggers",
    priority: 4,
    input_method: "structured",
    input_config: { 
      type: "multi_select", 
      options: ["When money is in my account", "Social pressure from friends", "Stress or boredom", 
                "Feeling I deserve it", "Sales or deals", "Payday excitement"] 
    },
    triggers: { min_conversations: 3, context_keywords: ["spend", "impulse", "budget", "overspend"] },
    rationale: "Understanding your triggers helps me design a system that works with your nature",
    value_unlocked: "Personalised guardrails that actually stick",
    category: "behavior"
  },
  {
    field: "advice_style",
    priority: 4,
    input_method: "structured",
    input_config: { type: "single_select", options: ["Gentle nudges", "Direct and honest", "Blunt — don't sugarcoat it"] },
    triggers: { min_conversations: 2 },
    rationale: "Some people want encouragement, others want the hard truth",
    value_unlocked: "Advice delivered in the way that actually works for you",
    category: "behavior"
  },

  // === PHASE 5: Deep profile (only when the user is engaged) ===
  
  {
    field: "nationality",
    priority: 3,
    input_method: "inferred",
    triggers: { context_keywords: ["passport", "visa", "home country", "moved", "expat"] },
    rationale: "Cross-border finances need special handling",
    value_unlocked: "Tax-efficient strategies for your specific situation",
    category: "tax"
  },
  {
    field: "residency_status",
    priority: 3,
    input_method: "conversational",
    triggers: { depends_on: ["nationality", "country"], condition: "nationality !== country" },
    rationale: "Residency determines which tax regime applies to you",
    value_unlocked: "Accurate tax implications for investments and income",
    category: "tax"
  },
  {
    field: "dependents",
    priority: 2,
    input_method: "inferred",
    triggers: { context_keywords: ["kids", "children", "baby", "family", "school"] },
    rationale: "Children significantly change the financial picture",
    value_unlocked: "Family-appropriate budgeting and long-term planning",
    category: "relationships"
  },
];
```

### How the Engine Runs

Before each conversation starts, the profiling engine runs:

```typescript
// lib/profiling/engine.ts

async function getNextQuestions(userId: string): Promise<ProfileQuestion[]> {
  // 1. Load current profile
  const profile = await getProfile(userId);
  
  // 2. Get empty fields
  const emptyFields = getEmptyFields(profile);
  
  // 3. Filter to questions whose triggers are met
  const eligible = PROFILE_QUESTIONS.filter(q => {
    // Field must be empty
    if (!emptyFields.includes(q.field)) return false;
    
    // Dependencies must be filled
    if (q.triggers.depends_on?.some(dep => emptyFields.includes(dep))) return false;
    
    // Conditions must be met
    if (q.triggers.condition && !evaluateCondition(q.triggers.condition, profile)) return false;
    
    // Min conversations reached
    const convCount = await getConversationCount(userId);
    if (q.triggers.min_conversations > convCount) return false;
    
    return true;
  });
  
  // 4. Sort by priority (highest first)
  eligible.sort((a, b) => b.priority - a.priority);
  
  // 5. Return top 1-2 (never overwhelm)
  return eligible.slice(0, 2);
}
```

The engine's output is injected into the system prompt as "questions to weave in if natural."

---

## Part 3: System Prompt & Context Injection

### The CFO Persona

```typescript
// lib/chat/system-prompt.ts

const BASE_PERSONA = `
You are the user's personal CFO — a sharp, experienced financial advisor who 
works exclusively for them. Your name is not important; what matters is that 
you know their numbers inside out and you give advice that's honest, 
personalised, and actionable.

Your style:
- Direct and confident. You don't hedge when the data is clear.
- You use their actual numbers, not generic ranges.
- You push back when they're being unrealistic, but you respect their values.
- You never lecture. You explain once, clearly, then move to action.
- You remember everything from past conversations.
- When you don't know something, you say so. When you need more data, you explain why.
- You're not a therapist, but you understand that money is emotional.
  When someone's spending contradicts their stated values, you name it without judgement.

Your limitations (be honest about these):
- You are not a licensed financial advisor. For tax, legal, and regulated 
  investment advice, recommend they consult a specialist.
- Your calculations are provided by the system. You interpret and explain them, 
  you don't compute them yourself.
- You don't have access to real-time market data unless you search for it.

${adviceStyle === 'blunt' ? 
  'The user has asked you to be blunt. Don\'t soften bad news. Say it straight.' : 
  adviceStyle === 'direct' ? 
  'The user prefers directness. Be clear and honest, but not harsh.' :
  'The user prefers a gentler approach. Be encouraging while still being truthful.'}
`;
```

### Dynamic Context Assembly

The system prompt is assembled fresh for each conversation from multiple sources:

```typescript
// lib/chat/context-builder.ts

async function buildSystemPrompt(userId: string, conversationType: string): Promise<string> {
  
  const sections: string[] = [BASE_PERSONA];
  
  // === Section 1: What we know about this person ===
  const profile = await getProfile(userId);
  
  if (hasAnyProfileData(profile)) {
    sections.push(buildProfileContext(profile));
  }
  
  // === Section 2: Their financial numbers (SYSTEM-COMPUTED) ===
  const latestSnapshot = await getLatestSnapshot(userId);
  const recurringExpenses = await getRecurringExpenses(userId);
  
  if (latestSnapshot) {
    sections.push(buildFinancialContext(latestSnapshot, recurringExpenses, profile));
  }
  
  // === Section 3: Their financial portrait (behavioral) ===
  const traits = await getFinancialPortrait(userId);
  const valueMapResults = await getValueMapResults(userId);
  
  if (traits.length > 0 || valueMapResults) {
    sections.push(buildPortraitContext(traits, valueMapResults));
  }
  
  // === Section 4: Active goals and action items ===
  const goals = await getActiveGoals(userId);
  const actions = await getPendingActions(userId);
  
  if (goals.length > 0 || actions.length > 0) {
    sections.push(buildGoalsContext(goals, actions));
  }
  
  // === Section 5: Questions to ask (from profiling engine) ===
  const nextQuestions = await getNextQuestions(userId);
  
  if (nextQuestions.length > 0) {
    sections.push(buildProfilingContext(nextQuestions));
  }
  
  // === Section 6: Conversation-type-specific instructions ===
  sections.push(getConversationInstructions(conversationType));
  
  // === Section 7: Tool definitions ===
  // (handled by Vercel AI SDK tool configuration, not in prompt text)
  
  return sections.join('\n\n---\n\n');
}
```

### Context Section Templates

#### Profile Context
```typescript
function buildProfileContext(profile: UserProfile): string {
  // Only include what we actually know — never fabricate
  const facts: string[] = [];
  
  if (profile.display_name) facts.push(`Name: ${profile.display_name}`);
  if (profile.city && profile.country) facts.push(`Lives in: ${profile.city}, ${profile.country}`);
  if (profile.age_range) facts.push(`Age: ${profile.age_range}`);
  if (profile.primary_currency) facts.push(`Currency: ${profile.primary_currency}`);
  if (profile.employment_status) facts.push(`Employment: ${profile.employment_status}`);
  if (profile.net_monthly_income) facts.push(`Net monthly income: ${profile.primary_currency} ${profile.net_monthly_income}`);
  if (profile.housing_type) facts.push(`Housing: ${profile.housing_type}`);
  if (profile.monthly_rent) facts.push(`Monthly rent: ${profile.primary_currency} ${profile.monthly_rent}`);
  if (profile.relationship_status) facts.push(`Relationship: ${profile.relationship_status}`);
  if (profile.partner_employment_status) facts.push(`Partner: ${profile.partner_employment_status}`);
  if (profile.advice_style) facts.push(`Preferred advice style: ${profile.advice_style}`);
  
  if (profile.bonus_month_details) {
    const bonuses = profile.bonus_month_details.map(
      (b: any) => `Month ${b.month}: ${profile.primary_currency} ${b.amount}`
    ).join(', ');
    facts.push(`Bonus/double pay months: ${bonuses}`);
  }
  
  if (facts.length === 0) return '';
  
  return `## What you know about this person
${facts.join('\n')}

Profile completeness: ${profile.profile_completeness}%
${profile.profile_completeness < 50 ? 'Many fields are still unknown. Gather more context naturally through conversation.' : ''}`;
}
```

#### Financial Context (System-Computed Numbers)
```typescript
function buildFinancialContext(
  snapshot: MonthlySnapshot, 
  recurring: RecurringExpense[], 
  profile: UserProfile
): string {
  const fixedTotal = recurring
    .filter(r => r.frequency === 'monthly')
    .reduce((sum, r) => sum + r.amount, 0);
  
  const bimonthlyTotal = recurring
    .filter(r => r.frequency === 'bimonthly')
    .reduce((sum, r) => sum + r.amount / 2, 0);
    
  const monthlyFixedCosts = fixedTotal + bimonthlyTotal;
  const disposableAfterFixed = (profile.net_monthly_income || 0) - monthlyFixedCosts;
  
  return `## Financial summary (system-computed — use these numbers, don't calculate yourself)

### Monthly cash flow
- Net income: ${profile.primary_currency} ${profile.net_monthly_income || 'UNKNOWN'}
- Fixed costs: ${profile.primary_currency} ${monthlyFixedCosts.toFixed(0)}
- Available for spending + saving: ${profile.primary_currency} ${disposableAfterFixed.toFixed(0)}

### Latest month: ${snapshot.month}
- Total spending: ${profile.primary_currency} ${snapshot.total_spending}
- Spending by category: ${JSON.stringify(snapshot.spending_by_category)}
- Transaction count: ${snapshot.transaction_count}
- vs previous month: ${snapshot.vs_previous_month_pct > 0 ? '+' : ''}${snapshot.vs_previous_month_pct}%
- Surplus/deficit: ${profile.primary_currency} ${snapshot.surplus_deficit}

### Recurring expenses
${recurring.map(r => `- ${r.name} (${r.provider}): ${profile.primary_currency} ${r.amount}/${r.frequency}${r.potential_saving_monthly ? ` — potential saving: ${profile.primary_currency} ${r.potential_saving_monthly}/mo` : ''}`).join('\n')}

IMPORTANT: Always use these system-provided numbers. Never attempt to add, subtract, or 
calculate financial figures yourself. If you need a calculation that isn't provided, 
use the calculate tool.`;
}
```

#### Portrait Context
```typescript
function buildPortraitContext(
  traits: FinancialTrait[], 
  valueMap: ValueMapResults | null
): string {
  let context = '## Financial personality\n\n';
  
  if (valueMap) {
    context += `### Value Map archetype: "${valueMap.archetype_name}" — ${valueMap.archetype_subtitle}\n`;
    context += `Key patterns from Value Map:\n`;
    if (valueMap.certainty_areas) {
      context += `- Certain about: ${JSON.stringify(valueMap.certainty_areas)}\n`;
    }
    if (valueMap.conflict_areas) {
      context += `- Conflicted about: ${JSON.stringify(valueMap.conflict_areas)}\n`;
    }
    if (valueMap.comfort_patterns) {
      context += `- Comfort spending: ${JSON.stringify(valueMap.comfort_patterns)}\n`;
    }
    context += '\n';
  }
  
  if (traits.length > 0) {
    context += '### Observed behavioral traits\n';
    traits
      .sort((a, b) => b.confidence - a.confidence)
      .forEach(t => {
        context += `- ${t.trait_value} (confidence: ${(t.confidence * 100).toFixed(0)}%)\n`;
      });
  }
  
  context += `\nUse these traits to personalise your advice. Reference them naturally — 
don't list them back to the user. For example, if they have "spends when money is 
visible," suggest automating transfers rather than relying on willpower.`;
  
  return context;
}
```

#### Profiling Context (Questions to Ask)
```typescript
function buildProfilingContext(questions: ProfileQuestion[]): string {
  if (questions.length === 0) return '';
  
  let context = `## Information to gather (if natural)

The following profile fields are empty and would improve your advice. 
DO NOT ask these as a list. DO NOT ask more than one per conversation 
unless the user is clearly in an information-sharing mode. 
Weave them in naturally when the topic is relevant.
If the conversation doesn't naturally lead to these topics, don't force it.

`;
  
  questions.forEach(q => {
    context += `- ${q.field}: ${q.rationale}`;
    if (q.input_method === 'structured') {
      context += ` → Use the request_structured_input tool for this.`;
    }
    context += '\n';
  });
  
  context += `\nRemember: ask late, ask little. One question, naturally placed, 
is better than a checklist. The user should feel like they're having a conversation, 
not filling out a form.`;
  
  return context;
}
```

#### Conversation Type Instructions
```typescript
function getConversationInstructions(type: string): string {
  switch (type) {
    case 'onboarding':
      return `## Conversation type: First meeting
This is your first conversation with this person. Your goals:
1. Acknowledge what you already know (from Value Map if applicable)
2. Present the key insight from their CSV data (if uploaded)
3. Ask 2-3 questions to establish their baseline
4. End by telling them one specific, actionable thing they can do this week
Keep it under 5 exchanges. Leave them wanting to come back.`;

    case 'monthly_review':
      return `## Conversation type: Monthly review
The user is reviewing their latest month's spending. Your goals:
1. Lead with the headline: surplus or deficit, and how it compares
2. Call out the biggest win and biggest concern
3. Show how value categories shifted (Foundation/Burden/Investment/Leak)
4. Check progress on active goals
5. Update or create action items
Be structured but conversational. Use the financial tools to get accurate numbers.`;

    case 'trip_planning':
      return `## Conversation type: Trip planning
Help the user plan and budget for a trip. Your goals:
1. Understand: where, when, how long, who with, travel style
2. Research: flights, accommodation, daily costs, specific tips
3. Budget: detailed breakdown with cost-saving opportunities
4. Plan: how to fund it from their current cash flow
Use web search for current prices. Be specific — real airlines, real prices, real tips.`;

    case 'scenario':
      return `## Conversation type: Scenario modelling
The user wants to explore a "what if." Your goals:
1. Understand the scenario clearly
2. Use the model_scenario tool for calculations
3. Present the impact on their current position, goals, and timeline
4. Compare with the status quo
5. Give your honest assessment — is this realistic? What needs to change?
Be thorough with numbers but accessible with explanations.`;

    default:
      return `## Conversation type: General
This is an open conversation. Follow the user's lead.
If they ask a question, answer it directly using their actual data.
If there are pending action items, you may mention them if relevant.
If the profiling engine suggests a question, weave it in if the moment is right.`;
  }
}
```

### Token Budget Management

The assembled context can get large. Here's the priority order for what to include when approaching limits:

```
Priority 1 (always include):
  - Base persona (~300 tokens)
  - Profile context (~200 tokens)
  - Financial summary (~400 tokens)
  - Conversation type instructions (~200 tokens)
  Total: ~1,100 tokens

Priority 2 (include if room):
  - Financial portrait / Value Map (~300 tokens)
  - Active goals + action items (~200 tokens)
  - Profiling questions (~150 tokens)
  Total: ~650 tokens

Priority 3 (include for specific conversation types):
  - Investment holdings detail (~400 tokens)
  - Full recurring expenses list (~300 tokens)
  - Historical snapshots for comparison (~400 tokens)
  Total: ~1,100 tokens

Maximum context target: ~3,000 tokens
Leaves room for: conversation history + user message + response
```

---

## Part 4: Data Flow Diagram

```
User speaks in chat
        │
        ▼
┌─────────────────────┐
│   Vercel AI SDK     │ ← System prompt assembled by context-builder
│   sends to Bedrock  │ ← Includes profile, financials, portrait, questions
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   Claude processes   │
│   and may call:      │
│   - update_profile   │ ← Extracts data from conversation (Channel B)
│   - request_input    │ ← Asks for structured data (Channel A)
│   - calculate_*      │ ← Gets system-computed numbers
│   - search_web       │ ← Researches external information
│   - create_action    │ ← Creates action items
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   Tool execution     │
│   (API routes)       │ ← Validates, writes to Supabase, returns results
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   Claude continues   │ ← With tool results in context
│   response streams   │
│   to user            │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   Message saved      │ ← Full message + profile_updates + actions_created
│   to conversations   │
└────────┬────────────┘
         │
         ▼ (async, after conversation)
┌─────────────────────┐
│   Post-conversation  │ ← Channel C: behavioral analysis
│   Edge Function      │ ← Updates financial_portrait
│   analysis           │ ← Queues follow-up questions
└─────────────────────┘
```

---

## Summary

The three systems work together:

**Progressive Profiling** decides WHAT to ask and WHEN. It's a priority queue that respects the user's journey and never asks more than needed.

**Context Injection** ensures Claude KNOWS everything the system has learned. Every conversation starts with the full picture, so the user never repeats themselves.

**Conversation Extraction** captures WHAT the user reveals — through structured inputs (reliable), function calling (medium), and post-conversation analysis (supplementary). Every interaction makes the profile richer.

The result: a system that gets smarter with every conversation, asks less over time, and delivers advice that feels like it comes from someone who genuinely knows you — because it does.
