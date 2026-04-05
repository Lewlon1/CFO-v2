import { createClient } from '@/lib/supabase/server';
import { BASE_PERSONA } from './system-prompt';
import { getNextQuestions } from '@/lib/profiling/engine';
import type { ProfileQuestion } from '@/lib/profiling/question-registry';
import { assembleReviewContext } from './review-context';

export async function buildSystemPrompt(
  userId: string,
  conversationType?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conversationMetadata?: Record<string, any> | null
): Promise<string> {
  const supabase = await createClient();

  // Query all data sources in parallel
  const [
    profileResult,
    snapshotsResult,
    recurringResult,
    portraitResult,
    valueMapResult,
    goalsResult,
    actionsResult,
    tripsResult,
  ] = await Promise.allSettled([
    supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single(),
    supabase
      .from('monthly_snapshots')
      .select('*')
      .eq('user_id', userId)
      .order('month', { ascending: false })
      .limit(6),
    supabase
      .from('recurring_expenses')
      .select('*')
      .eq('user_id', userId),
    supabase
      .from('financial_portrait')
      .select('*')
      .eq('user_id', userId)
      .is('dismissed_at', null)
      .order('confidence', { ascending: false }),
    supabase
      .from('value_map_results')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from('goals')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active'),
    supabase
      .from('action_items')
      .select('*')
      .eq('profile_id', userId)
      .eq('status', 'pending'),
    supabase
      .from('trips')
      .select('name, destination, start_date, end_date, total_estimated, status, currency')
      .eq('user_id', userId)
      .in('status', ['planning', 'booked'])
      .order('start_date', { ascending: true })
      .limit(3),
  ]);

  const profile = profileResult.status === 'fulfilled' ? profileResult.value.data : null;
  const snapshots = snapshotsResult.status === 'fulfilled' ? snapshotsResult.value.data : null;
  const recurring = recurringResult.status === 'fulfilled' ? recurringResult.value.data : null;
  const portrait = portraitResult.status === 'fulfilled' ? portraitResult.value.data : null;
  const valueMap = valueMapResult.status === 'fulfilled' ? valueMapResult.value.data : null;
  const goals = goalsResult.status === 'fulfilled' ? goalsResult.value.data : null;
  const actions = actionsResult.status === 'fulfilled' ? actionsResult.value.data : null;
  const trips = tripsResult.status === 'fulfilled' ? tripsResult.value.data : null;

  // Build advice style modifier
  const adviceStyle = profile?.advice_style || 'direct';
  let styleModifier = '';
  if (adviceStyle === 'blunt') {
    styleModifier = "\nThe user wants you to be blunt. Don't soften bad news. Say it straight.";
  } else if (adviceStyle === 'gentle') {
    styleModifier = '\nThe user prefers a gentler approach. Be encouraging while still being truthful.';
  } else {
    styleModifier = '\nThe user prefers directness. Be clear and honest, but not harsh.';
  }

  const sections = [
    BASE_PERSONA + styleModifier,
    buildProfileContext(profile),
    buildFinancialContext(snapshots, recurring, profile),
    await getConversationInstructions(conversationType, conversationMetadata, userId, snapshots, profile),
    buildPortraitContext(portrait, valueMap),
    buildGoalsContext(goals, actions),
    buildTripsContext(trips, profile),
    buildToolUsageInstructions(),
    await buildProfilingContext(userId, supabase),
  ].filter(Boolean);

  return sections.join('\n\n---\n\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProfileContext(profile: any): string {
  if (!profile) return '';

  const fields: string[] = [];

  if (profile.display_name) fields.push(`Name: ${profile.display_name}`);
  if (profile.country) fields.push(`Country: ${profile.country}`);
  if (profile.city) fields.push(`City: ${profile.city}`);
  if (profile.primary_currency) fields.push(`Currency: ${profile.primary_currency}`);
  if (profile.age_range) fields.push(`Age range: ${profile.age_range}`);
  if (profile.employment_status) fields.push(`Employment: ${profile.employment_status}`);
  if (profile.net_monthly_income) fields.push(`Net monthly income: ${profile.primary_currency || 'EUR'} ${profile.net_monthly_income}`);
  if (profile.gross_salary) fields.push(`Gross salary: ${profile.primary_currency || 'EUR'} ${profile.gross_salary}`);
  if (profile.pay_frequency) fields.push(`Pay frequency: ${profile.pay_frequency}`);
  if (profile.has_bonus_months && profile.bonus_month_details) fields.push(`Bonus months: ${JSON.stringify(profile.bonus_month_details)}`);
  if (profile.housing_type) fields.push(`Housing: ${profile.housing_type}`);
  if (profile.monthly_rent) fields.push(`Monthly rent/mortgage: ${profile.primary_currency || 'EUR'} ${profile.monthly_rent}`);
  if (profile.relationship_status) fields.push(`Relationship: ${profile.relationship_status}`);
  if (profile.partner_employment_status) fields.push(`Partner employment: ${profile.partner_employment_status}`);
  if (profile.partner_monthly_contribution) fields.push(`Partner contribution: ${profile.primary_currency || 'EUR'} ${profile.partner_monthly_contribution}/month`);
  if (profile.dependents) fields.push(`Dependents: ${profile.dependents}`);
  if (profile.nationality) fields.push(`Nationality: ${profile.nationality}`);
  if (profile.risk_tolerance) fields.push(`Risk tolerance: ${profile.risk_tolerance}`);

  if (fields.length === 0) return '';

  const completeness = profile.profile_completeness || 0;
  let completenessNote = `\nProfile completeness: ${completeness}%.`;
  if (completeness < 50) {
    completenessNote += ' Many fields are still unknown. Gather more context naturally through conversation.';
  }

  return `## What you know about this user\n\n${fields.join('\n')}${completenessNote}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFinancialContext(snapshots: any[] | null, recurring: any[] | null, profile: any): string {
  const parts: string[] = [];

  // Monthly snapshots
  if (snapshots && snapshots.length > 0) {
    const latest = snapshots[0];
    const currency = profile?.primary_currency || 'EUR';

    parts.push(`## Financial summary — ${snapshots.length} month${snapshots.length > 1 ? 's' : ''} of data available`);
    if (profile?.net_monthly_income) parts.push(`Net monthly income: ${currency} ${profile.net_monthly_income}`);

    parts.push(`\n### Latest month (${latest.month})`);
    if (latest.total_spending) parts.push(`Total spending: ${currency} ${latest.total_spending}`);
    if (latest.total_income) parts.push(`Total income: ${currency} ${latest.total_income}`);
    if (latest.surplus_deficit) parts.push(`Surplus/deficit: ${currency} ${latest.surplus_deficit}`);
    if (latest.spending_by_category && Object.keys(latest.spending_by_category).length > 0) {
      parts.push(`Spending by category: ${JSON.stringify(latest.spending_by_category)}`);
    }
    if (latest.spending_by_value_category && Object.keys(latest.spending_by_value_category).length > 0) {
      parts.push(`Spending by value category: ${JSON.stringify(latest.spending_by_value_category)}`);
    }
    if (latest.vs_previous_month_pct !== null && latest.vs_previous_month_pct !== undefined) {
      parts.push(`vs previous month: ${latest.vs_previous_month_pct > 0 ? '+' : ''}${latest.vs_previous_month_pct}%`);
    }

    // Historical months
    if (snapshots.length > 1) {
      parts.push('\n### Historical months');
      for (const snap of snapshots.slice(1)) {
        let line = `- ${snap.month}: ${currency} ${snap.total_spending} spending`;
        if (snap.total_income) line += `, ${currency} ${snap.total_income} income`;
        if (snap.surplus_deficit !== null && snap.surplus_deficit !== undefined) {
          line += `, ${snap.surplus_deficit >= 0 ? '+' : ''}${currency} ${snap.surplus_deficit} surplus/deficit`;
        }
        parts.push(line);
      }
    }
  }

  // Recurring expenses
  if (recurring && recurring.length > 0) {
    const recurringLines = recurring.map((r) => {
      const freq = r.frequency === 'monthly' ? '/mo' : `/${r.frequency}`;
      return `- ${r.name}${r.provider ? ` (${r.provider})` : ''}: ${r.currency || 'EUR'} ${r.amount}${freq}`;
    });
    parts.push(`\nRecurring expenses:\n${recurringLines.join('\n')}`);

    // Compute approximate monthly fixed costs
    const monthlyFixed = recurring.reduce((sum, r) => {
      if (r.frequency === 'monthly') return sum + Number(r.amount);
      if (r.frequency === 'bimonthly') return sum + Number(r.amount) / 2;
      if (r.frequency === 'quarterly') return sum + Number(r.amount) / 3;
      if (r.frequency === 'annual' || r.frequency === 'yearly') return sum + Number(r.amount) / 12;
      return sum + Number(r.amount);
    }, 0);
    parts.push(`\nEstimated monthly fixed costs: ${profile?.primary_currency || 'EUR'} ${monthlyFixed.toFixed(2)}`);

    // Bills needing attention (lightweight — drop if token budget tight)
    const attentionBills: string[] = [];
    const now = Date.now();
    for (const r of recurring) {
      if (r.contract_end_date) {
        const daysUntil = Math.ceil((new Date(r.contract_end_date).getTime() - now) / (1000 * 60 * 60 * 24));
        if (daysUntil > 0 && daysUntil <= 60) {
          attentionBills.push(`- ${r.provider || r.name}: contract ends in ${daysUntil} days${r.potential_saving_monthly ? ` (potential saving: ${profile?.primary_currency || 'EUR'} ${r.potential_saving_monthly}/mo)` : ''}`);
        }
      }
      if (!r.contract_end_date && r.potential_saving_monthly && Number(r.potential_saving_monthly) > 0) {
        attentionBills.push(`- ${r.provider || r.name}: potential saving ${profile?.primary_currency || 'EUR'} ${r.potential_saving_monthly}/mo`);
      }
    }
    if (attentionBills.length > 0) {
      parts.push(`\nBills needing attention:\n${attentionBills.slice(0, 3).join('\n')}`);
    }
  }

  if (parts.length === 0) return '';

  parts.push('\nIMPORTANT: Always use these system-provided numbers. Never attempt to add, subtract, or calculate financial figures yourself.');

  return parts.join('\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPortraitContext(portrait: any[] | null, valueMap: any): string {
  const parts: string[] = [];

  // Value Map archetype
  if (valueMap) {
    parts.push('## Financial personality (from Value Map)');
    if (valueMap.archetype_name) {
      parts.push(`Archetype: ${valueMap.archetype_name}${valueMap.archetype_subtitle ? ` — ${valueMap.archetype_subtitle}` : ''}`);
    }
    if (valueMap.certainty_areas && valueMap.certainty_areas.length > 0) {
      parts.push(`Certainty areas: ${JSON.stringify(valueMap.certainty_areas)}`);
    }
    if (valueMap.conflict_areas && valueMap.conflict_areas.length > 0) {
      parts.push(`Conflict areas: ${JSON.stringify(valueMap.conflict_areas)}`);
    }
    if (valueMap.comfort_patterns && valueMap.comfort_patterns.length > 0) {
      parts.push(`Comfort patterns: ${JSON.stringify(valueMap.comfort_patterns)}`);
    }
  }

  // Behavioral traits
  if (portrait && portrait.length > 0) {
    parts.push('\n## Behavioral traits');
    for (const trait of portrait) {
      parts.push(`- ${trait.trait_key}: ${trait.trait_value} (confidence: ${trait.confidence})`);
    }
  }

  if (parts.length === 0) return '';

  parts.push("\nUse these traits to personalise your advice. Reference them naturally — don't list them back to the user.");

  return parts.join('\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildGoalsContext(goals: any[] | null, actions: any[] | null): string {
  const parts: string[] = [];

  if (goals && goals.length > 0) {
    parts.push('## Active goals');
    for (const goal of goals) {
      let line = `- ${goal.name}`;
      if (goal.target_amount) line += `: target ${goal.target_amount}`;
      if (goal.current_amount) line += `, current ${goal.current_amount}`;
      if (goal.target_date) line += `, by ${goal.target_date}`;
      if (goal.monthly_required_saving) line += ` (need ${goal.monthly_required_saving}/mo)`;
      if (goal.on_track !== null) line += goal.on_track ? ' ✓ on track' : ' ✗ off track';
      parts.push(line);
    }
  }

  if (actions && actions.length > 0) {
    parts.push('\n## Pending action items');
    for (const action of actions) {
      let line = `- ${action.title}`;
      if (action.category) line += ` [${action.category}]`;
      if (action.priority) line += ` (${action.priority})`;
      if (action.due_date) line += ` due ${action.due_date}`;
      parts.push(line);
    }
  }

  if (parts.length === 0) return '';
  return parts.join('\n');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTripsContext(trips: any[] | null, profile: any): string {
  if (!trips || trips.length === 0) return '';

  const currency = profile?.primary_currency || 'EUR';
  const lines = trips.map(t => {
    let line = `- ${t.name}`;
    if (t.destination) line += ` (${t.destination})`;
    line += `: ${t.status}`;
    if (t.total_estimated) line += `, budget ${currency} ${t.total_estimated}`;
    if (t.start_date) line += `, ${t.start_date}`;
    return line;
  });

  return `## Upcoming trips\n\n${lines.join('\n')}`;
}

function buildToolUsageInstructions(): string {
  return `## Available tools

When the user asks about spending, budgets, or comparisons, call the appropriate tool. NEVER calculate financial figures yourself — always use a tool.

- **get_spending_summary**: "How much did I spend on X?" or "What did I spend last month?" Always use this for specific date ranges or category filters rather than citing numbers from the system prompt.
- **compare_months**: "How was March vs February?" or any month-over-month comparison.
- **get_value_breakdown**: "Show me my Foundation/Investment/Burden/Leak split" for a period.
- **calculate_monthly_budget**: "What's my budget?" or "How much can I spend?" Also use as context when discussing any spending number relative to income.
- **get_action_items**: "What's on my to-do list?" or "What should I be working on?"
- **create_action_item**: When a conversation produces a concrete next step. Always confirm with the user before creating.
- **model_scenario**: "What if I got a raise?" / "What if I cut dining by 30%?" / "What would a mortgage look like?" / "What if I had kids?" / "What if I changed careers?" / "How would my investments grow?" All 6 scenario types are available. All calculations are server-side.
- **plan_trip**: "Help me plan a trip" — create a trip budget, funding plan, and savings goal. Call this AFTER collecting destination, dates, travel style, and companions, and AFTER researching real costs. All funding calculations are server-side.
- **analyse_gap**: "How does my spending compare to what I said I value?" The Gap analysis between Value Map perception and actual spending.
- **suggest_value_recategorisation**: "Are any of my categories wrong?" Find potentially miscategorised transactions.
- **search_bill_alternatives**: "Can I get a better deal on electricity?" / "Help me switch internet provider." Researches alternatives and compares with the user's current plan.

RULES:
- ALWAYS call a tool when you need a number. Never estimate, recall, or calculate.
- You can call multiple tools in sequence — e.g., get_spending_summary then compare with calculate_monthly_budget.
- If a tool returns an error about missing data, explain what's needed and offer to help collect it.
- When presenting tool results, be conversational — frame numbers in context of the user's goals and values, don't dump raw data.
- After creating an action item, briefly confirm and move on.`;
}

async function buildProfilingContext(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<string> {
  let questions: ProfileQuestion[];
  try {
    questions = await getNextQuestions(userId, supabase);
  } catch {
    return '';
  }

  if (questions.length === 0) return '';

  const lines = questions.map((q) => {
    let line = `- **${q.field}**: "${q.label}"`;
    line += `\n  Rationale: ${q.rationale}`;
    if (q.input_config.input_type === 'single_select' || q.input_config.input_type === 'multi_select') {
      line += ` → Use request_structured_input tool (${q.input_config.input_type})`;
      if (q.input_config.options) {
        line += ` with options: ${q.input_config.options.map(o => o.label).join(', ')}`;
      }
    } else if (q.input_config.input_type === 'currency_amount' || q.input_config.input_type === 'number') {
      line += ` → Use request_structured_input tool (${q.input_config.input_type})`;
    }
    return line;
  });

  return `## Information to gather (if natural)

The following profile fields are empty and would improve your advice.
DO NOT ask these as a list. DO NOT ask more than one per conversation
unless the user is clearly in an information-sharing mode.
Weave them in naturally when the topic is relevant.
If the conversation doesn't naturally lead to these topics, don't force it.

${lines.join('\n\n')}

When asking for precise data (numbers, selections), use the request_structured_input tool
to render an interactive component. For information shared naturally in conversation,
use the update_user_profile tool instead.

Remember: ask late, ask little. One question, naturally placed,
is better than a checklist. The user should feel like they're having a conversation,
not filling out a form.`;
}

async function getConversationInstructions(
  conversationType?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any> | null,
  userId?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  snapshots?: any[] | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile?: any
): Promise<string> {
  switch (conversationType) {
    case 'onboarding':
      return `## Conversation context: Onboarding

This is a new user. Welcome them warmly. If they completed the Value Map, reference their archetype naturally. Your goal is to understand what they're working toward financially. Don't overwhelm — one or two good questions, then listen.`;

    case 'monthly_review':
      return buildMonthlyReviewPrompt(metadata, userId);

    case 'trip_planning':
      return `## Conversation type: Trip planning

Help the user plan and budget for a trip. Follow this flow:

STEP 1 — COLLECT (1-2 exchanges):
Ask about: destination, approximate dates, duration, who's going, travel style (budget/mid-range/luxury).
If they mention a partner, ask if they'll split costs 50/50.
Keep it conversational — don't dump all questions at once.

STEP 2 — RESEARCH (use web search if available):
Estimate current prices for:
- Flights from their location to destination (use real airlines where possible)
- Accommodation ranges for their travel style
- Average daily food costs at destination
- Key activities/experiences and their costs
- Local transport costs
Be specific with real price ranges and practical tips.

STEP 3 — BUDGET (call plan_trip tool):
Once you have cost estimates, call the plan_trip tool with your estimates.
Present the results conversationally:
- Total budget with per-category breakdown
- Their share (if splitting)
- Funding plan: "If you save €X/month for Y months..."
- Feasibility assessment based on their actual cash flow
- If tight: suggest specific categories where they could cut back, with amounts

STEP 4 — REFINE:
Let the user adjust. They might say "that's too much for accommodation" or "we'll definitely do X activity."
Update the budget accordingly (call plan_trip again with revised estimates if significant changes).

STEP 5 — COMMIT:
Confirm the plan is saved as a goal. Let them know they'll see progress on the dashboard.
If relevant, create action items: "Book flights when prices drop below €X", "Set up a trip savings pot", etc.

IMPORTANT:
- All calculations come from the plan_trip tool, not from your head.
- Reference their actual surplus/discretionary spending when discussing feasibility.
- If experiences rank high in their values, acknowledge that this trip aligns with their values.
- Don't be a killjoy. If a trip is expensive but important to them, help them find a way. Only flag "unrealistic" if the numbers truly don't work.`;

    case 'scenario':
      return `## Conversation context: Scenario modelling

The user wants to explore a what-if. Use the model_scenario tool to run the numbers — never calculate yourself.

Available scenario types:
- **salary_increase**: new income or percentage increase
- **expense_reduction**: cut a specific spending category by a percentage
- **property_purchase**: mortgage calculator with deposit, rate, and term
- **children**: cost of having kids — childcare, food, clothing, activities
- **career_change**: transition costs, runway analysis, new income comparison
- **investment_growth**: compound growth projections with year-by-year breakdown

Ask enough to fill the required params, then call model_scenario. Present the numbers clearly, then give your honest take on whether it makes sense given their situation. Always mention the impact on their active goals if any exist.`;

    case 'post_upload':
      return buildPostUploadPrompt(metadata, snapshots, profile);

    case 'value_map_complete':
      return buildValueMapCompletePrompt(metadata, snapshots, profile);

    case 'bill_optimisation':
      return buildBillOptimisationPrompt(metadata, userId);

    default: {
      // Check if this conversation was initiated from a nudge
      const nudgeType = metadata?.nudge_type as string | undefined;
      if (nudgeType) {
        return buildNudgeContext(nudgeType, metadata ?? {});
      }

      return `## Conversation context: General

This is an open conversation. Follow the user's lead. If they ask a question, answer it directly using their actual data. If there are pending action items, you may mention them if relevant.`;
    }
  }
}

function buildNudgeContext(nudgeType: string, params: Record<string, unknown>): string {
  switch (nudgeType) {
    case 'payday_savings':
      return `## Conversation trigger: Payday detected
The user just received their salary. This is a good moment to discuss:
1. Transferring a portion to savings (suggest their savings rate target if set)
2. Any upcoming bills or large expenses this month
3. Progress on active goals
Be proactive but not pushy. They tapped the reminder, so they're open to the conversation.`;

    case 'budget_alert':
      return `## Conversation trigger: Budget alert
The user's ${params.category ?? 'spending'} is approaching or has exceeded their budget.
Use the get_spending_summary tool to get the exact numbers. Show them:
1. Current spend vs budget for this category
2. What's driving the overspend (largest transactions)
3. Practical suggestions for the rest of the month
Don't lecture. Acknowledge and help.`;

    case 'contract_expiry':
      return `## Conversation trigger: Contract expiry
The user's ${params.provider ?? 'provider'} contract is expiring soon.
Use the search_bill_alternatives tool to research current alternatives.
Present options clearly with potential savings. Help them decide and create an action item.`;

    case 'spending_spike':
      return `## Conversation trigger: Spending spike
Unusual spending detected in ${params.category ?? 'a category'}.
Pull the data with get_spending_summary, then:
1. Show the spike compared to their average
2. Ask if it's a one-off or a pattern
3. If it's travel/holiday related, suggest tagging those transactions
Don't be alarming. It might be perfectly intentional.`;

    case 'action_reminder':
      return `## Conversation trigger: Action item reminder
The user has a pending action item. Retrieve it with get_action_items.
Help them either complete it, break it into smaller steps, or reschedule it.
If they've been nudged multiple times about this item, be understanding — maybe the task needs to be reframed or isn't relevant anymore.`;

    case 'upload_reminder':
      return `## Conversation trigger: Upload reminder
It's been a while since the user uploaded transaction data.
Gently remind them that fresh data means better advice.
Offer to walk them through an upload if they have their statement ready.`;

    default:
      return '';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildMonthlyReviewPrompt(metadata: Record<string, any> | null | undefined, userId?: string): Promise<string> {
  const reviewMonth = metadata?.review_month as string | undefined
  if (!reviewMonth || !userId) {
    return `## Conversation context: Monthly review

Walk the user through their month. Start with the headline number (surplus or deficit), then drill into what changed. Compare to last month. Highlight any value category shifts. End with 1-2 specific action items.`
  }

  const reviewContext = await assembleReviewContext(userId, reviewMonth)

  return `## Conversation context: Monthly Review

${reviewContext}

---

### YOUR APPROACH — deliver this as a conversation, not a report

**Phase 1 — The Headline**
Open with the single most important number: surplus or deficit. Frame it relative to last month if comparison data is available. One clear sentence that sets the tone — is this a celebration, a course correction, or business as usual?

Then STOP. Wait for the user to respond before continuing.

**Phase 2 — Wins & Concerns**
Highlight the biggest positive change and the biggest concern from the comparison data. Be specific — name the category, the amount, the trend. If a category improved, acknowledge what the user did differently. If something worsened, name it without drama.

Then STOP. Let the user react or ask questions.

**Phase 3 — Value Shifts** (skip if no shifts detected or single-month review)
This is the most important part. Walk through the value category shifts:
- Name the traditional category that shifted
- Explain what the shift means in plain language
- Reference the specific transactions that drove it
- Connect it to the user's stated values if you know their Value Map archetype

If there are no significant shifts, acknowledge consistency briefly — that's worth noting.

Then STOP. Ask if the shift matches how they feel about that spending.

**Phase 4 — Goal Check-in** (skip if no active goals)
Brief progress check on each active goal. Use the actual numbers from the review data. If a goal is off track, state the fact and what needs to change — don't lecture. If on track, acknowledge it in one line.

**Phase 5 — Actions**
1. Review previous action items: acknowledge completions, ask about pending ones
2. Based on this review's findings, suggest 1-2 new action items
3. Confirm with the user before creating them via the create_action_item tool
4. Close with a forward-looking statement about next month

### RULES:
- Every number you present MUST come from the review data above. Never calculate yourself.
- Do NOT present all phases in a single message. This is a CONVERSATION — pause after each phase.
- If the user interrupts to ask about something specific, answer it, then return to the flow.
- Be direct. If spending is concerning, say so. If they're doing well, celebrate it briefly.
- Reference their Value Map archetype or financial portrait traits when relevant — don't list them.
- Maximum 2 new action items suggested. Always confirm before creating.
- Use [OPTIONS]...[/OPTIONS] tags for tappable follow-up suggestions where appropriate.
- The entire review should be completable in 5-8 exchanges. Don't drag it out.`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildValueMapCompletePrompt(metadata: Record<string, any> | null | undefined, snapshots: any[] | null | undefined, profile: any): string {
  const gapResult = metadata?.gap_analysis
  const currency = profile?.primary_currency || 'EUR'
  const latest = snapshots?.[0]
  const monthCount = snapshots?.length ?? 0

  let prompt = `## Conversation type: Value Map Complete

The user has just finished the Value Map exercise. They now have both transaction data AND stated value preferences — this unlocks The Gap analysis.

Deliver an immediate update based on the comparison between what they said they value and what their spending shows. This is the most powerful moment in the product — don't waste it.

`

  if (monthCount > 0 && latest) {
    prompt += `### Transaction data available: ${monthCount} month${monthCount > 1 ? 's' : ''}
Latest month (${latest.month}): ${currency} ${latest.total_spending} total spending
`
  }

  if (gapResult?.has_value_map && gapResult?.gaps?.length > 0) {
    prompt += `
### THE GAP — Value Map vs Reality

${gapResult.gaps.map((gap: Record<string, unknown>) => `**${gap.category}:**
- They said: "${gap.stated_value_category}" (confidence: ${gap.stated_confidence}/1.0)
- Reality: ${currency} ${gap.actual_monthly_spend}/month (${gap.pct_of_total_spending}% of total)
- Gap type: ${gap.gap_type} (${gap.gap_severity} severity)
- Narrative: ${gap.narrative}`).join('\n\n')}

Summary: ${gapResult.summary.aligned_count} aligned, ${gapResult.summary.gap_count} gaps. Estimated monthly leak: ${currency} ${gapResult.summary.estimated_monthly_leak}.

### YOUR APPROACH:

1. **Acknowledge the Value Map completion** — briefly, one sentence. Don't dwell.
2. **Lead with The Gap** — pick the single most striking discrepancy and name it directly.
   Example: "Now that I know what you value, I can tell you: your biggest gap is dining. You called it a Leak — and you're right, but it's still £240/month, which is 18% of your spending."
3. **Show what's aligned** — name one or two categories where their values match reality. This builds trust.
4. **Ask ONE question** — about the most interesting gap. Make it tappable.
5. **Close with a forward-looking statement** — "This is just the start. Every month I'll show you how this picture changes."

TONE: This is a reveal moment. Be direct, specific, and grounded in their actual numbers. Don't qualify everything — say what the data says.
`
  } else if (monthCount > 0) {
    prompt += `
### No significant gaps found — all categories are aligned (or nearly so).

### YOUR APPROACH:

1. **Acknowledge the Value Map completion** — briefly.
2. **Deliver the good news** — their spending largely matches what they said they value.
3. **Show them one highlight** — which category has the strongest alignment.
4. **Introduce a gentle challenge** — "Everything looks aligned. The question is whether your current spending level on [biggest category] feels sustainable long-term." Use tappable options.

TONE: Validating but curious. Aligned spending doesn't mean optimal spending.
`
  } else {
    prompt += `
### No transaction data yet.

Tell the user their Value Map results are saved, but to unlock the full Gap analysis they need to upload a bank statement. Keep it brief and encouraging. Link to the upload flow.

TONE: Warm and encouraging. The Value Map was valuable — uploading completes the picture.
`
  }

  prompt += `
### RULES:
- Lead with the insight. Your FIRST message is the reveal — make it count.
- Use only system-provided numbers. Never calculate yourself.
- Max 2 follow-up questions in total. Use [OPTIONS]...[/OPTIONS] format.
- If the user corrects a value category, call update_value_category.
`

  return prompt
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPostUploadPrompt(metadata: Record<string, any> | null | undefined, snapshots: any[] | null | undefined, profile: any): string {
  const gapResult = metadata?.gap_analysis
  const txCount = metadata?.transaction_count || 0
  const currency = profile?.primary_currency || 'EUR'
  const latest = snapshots?.[0]

  const monthCount = snapshots?.length ?? 1
  let prompt = `## Conversation type: Post-Upload Insight

You've just received this user's bank transactions (${txCount} transactions across ${monthCount} month${monthCount > 1 ? 's' : ''}).
Your job is to deliver a powerful first impression — make them feel understood, not judged.

### The data you have:
`

  // Spending snapshot
  if (latest) {
    const vcBreakdown = latest.spending_by_value_category as Record<string, number> | null
    const vcTotal = vcBreakdown ? Object.values(vcBreakdown).reduce((s, v) => s + v, 0) : 0

    prompt += `
Latest month (${latest.month}):
- Total spending: ${currency} ${latest.total_spending}
- Transaction count: ${latest.transaction_count}
- Largest transaction: ${currency} ${latest.largest_transaction}${latest.largest_transaction_desc ? ` (${latest.largest_transaction_desc})` : ''}
`

    if (vcBreakdown && vcTotal > 0) {
      const pct = (k: string) => (((vcBreakdown[k] ?? 0) / vcTotal) * 100).toFixed(1)
      prompt += `
Value category breakdown:
- Foundation: ${pct('foundation')}%
- Investment: ${pct('investment')}%
- Burden: ${pct('burden')}%
- Leak: ${pct('leak')}%
- Unsure/untagged: ${pct('unsure')}%
`
    }
  }

  // Historical months context
  if (snapshots && snapshots.length > 1) {
    prompt += `\nPrevious months (for trend context):\n`
    for (const snap of snapshots.slice(1)) {
      prompt += `- ${snap.month}: ${currency} ${snap.total_spending} spending\n`
    }
  }

  // PATH A: The Gap (Value Map completed and gaps found)
  if (gapResult?.has_value_map && gapResult?.gaps?.length > 0) {
    prompt += `
### THE GAP — Value Map vs Reality

This user completed the Value Map before uploading. Here is the comparison between what they SAID they value and what their spending SHOWS:
`
    for (const gap of gapResult.gaps) {
      prompt += `
**${gap.category}:**
- Value Map said: "${gap.stated_value_category}" (confidence: ${gap.stated_confidence}/1.0)
- Actual spend: ${currency} ${gap.actual_monthly_spend}/month (${gap.pct_of_total_spending}% of total)
- Gap type: ${gap.gap_type}
- Gap severity: ${gap.gap_severity}
- System narrative: ${gap.narrative}
`
    }

    prompt += `
Summary: ${gapResult.summary.aligned_count} aligned categories, ${gapResult.summary.gap_count} gaps found.
Estimated monthly leak: ${currency} ${gapResult.summary.estimated_monthly_leak}.

### YOUR APPROACH (Path A — The Gap):

1. **Open with the value breakdown** — "Your money is currently X% Foundation, Y% Investment, Z% Burden, W% Leak." Make this visual and concrete.

2. **Surface the most interesting gap** — pick the ONE gap that is most emotionally resonant (usually "leaking_despite_awareness" or "hidden_burden"). Don't dump all gaps at once. Lead with the most striking one.

   Example: "You told me that dining out feels like a Leak — something that drains without returning enough. But it's still 18% of your monthly spend. That gap between knowing and doing is really common, and it tells me something about what dining represents for you beyond just food."

3. **Acknowledge alignment** — briefly note what IS aligned. "Your gym spend tracks perfectly with what you said — you called it an Investment and you're consistently putting money there."

4. **Ask ONE follow-up** — not about the data, about the feeling. "When you see that dining number, does it feel right or does it surprise you?" Use tappable options.

5. **Plant the seed** — "This is just from one month. As more data comes in, your CFO will spot patterns you can't see from a single snapshot."

TONE: Curious, not judgmental. You're holding up a mirror, not a scorecard. Use phrases like "your money tells me..." and "the gap between knowing and doing." Never say "you should spend less on X."
`
  }
  // PATH B: No Value Map or no gaps
  else {
    prompt += `
### YOUR APPROACH (Path B — No Value Map):

This user ${gapResult?.has_value_map ? 'has a Value Map but all categories are aligned' : 'uploaded bank data WITHOUT completing the Value Map first'}. Focus on what the data itself reveals.

1. **Open with the big picture** — total spend, biggest category, one surprising detail.

2. **Surface one pattern** — recurring charges, category concentration, or an interesting observation.
   Example: "I notice you have recurring subscriptions totalling a notable amount per month. Worth checking if you're using all of them."

3. **Introduce the value framework gently** — "I've tagged each transaction as Foundation (essentials), Investment (things that grow your life), Burden (necessary but heavy), or Leak (spending that doesn't feel worth it). Right now, your split shows [breakdown]. We'll refine this together — only you can tell me if that gym membership is an Investment or a Burden."

4. **Ask ONE question** — "What surprised you most in those numbers?" Use tappable options.

5. **Offer the Value Map** — "If you want a deeper look at the gap between what you value and what you spend, try the Value Map — it takes 3 minutes and makes everything I tell you much more personal."

Format the Value Map offer as:

[CTA:value_map]
Try the Value Map — 3 minutes to understand what your money means to you
[/CTA]

TONE: Informative and warm. You're introducing yourself as a useful CFO.
`
  }

  // Common rules for both paths
  prompt += `
### RULES FOR THIS CONVERSATION:

- Lead with the insight. Your FIRST message should contain the aha moment — don't ask "how can I help" or wait for them to speak.
- Keep numbers precise — use the system-provided figures, never calculate yourself.
- Maximum 3 follow-up questions in this entire conversation. Each should be tappable.

Format tappable options like this:

[OPTIONS]
- Option one
- Option two
- Option three
[/OPTIONS]

- If the user corrects a value category (e.g. "actually, dining IS an investment for me"), acknowledge it warmly and call the update_value_category tool.
- Save any profile data you learn via the update_user_profile tool.
- Don't try to give advice yet. This conversation is about understanding, not fixing.
- End the conversation naturally — "I'll keep watching as more data comes in" is a good close.
`

  return prompt
}

async function buildBillOptimisationPrompt(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any> | null | undefined,
  userId?: string
): Promise<string> {
  if (!metadata?.bill_id || !userId) {
    return `## Conversation context: Bill Optimisation

Help the user optimise their bills. Ask which bill they'd like to review, then use search_bill_alternatives to research better deals.`
  }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()

  const { data: bill } = await supabase
    .from('recurring_expenses')
    .select('*')
    .eq('id', metadata.bill_id)
    .eq('user_id', userId)
    .single()

  if (!bill) {
    return `## Conversation context: Bill Optimisation

The referenced bill could not be found. Ask the user which bill they'd like to review.`
  }

  const { normaliseToMonthly } = await import('@/lib/bills/normalise')
  const monthlyAmount = normaliseToMonthly(Number(bill.amount), bill.frequency || 'monthly')
  const planDetails = bill.current_plan_details as Record<string, unknown> | null

  let prompt = `## Conversation context: Bill Optimisation

You are reviewing the user's ${bill.provider || bill.name} bill.

Current details:
- Provider: ${bill.provider || 'Unknown'}
- Amount: ${bill.currency || 'EUR'} ${bill.amount} per ${bill.frequency || 'month'}
- Monthly equivalent: ${bill.currency || 'EUR'} ${monthlyAmount.toFixed(2)}`

  if (planDetails) {
    const detailParts: string[] = []
    if (planDetails.tariff_type) detailParts.push(`Tariff: ${planDetails.tariff_type}`)
    if (planDetails.power_contracted_kw) detailParts.push(`Contracted power: ${planDetails.power_contracted_kw} kW`)
    if (planDetails.consumption_kwh) detailParts.push(`Last consumption: ${planDetails.consumption_kwh} kWh`)
    if (planDetails.consumption_m3) detailParts.push(`Last consumption: ${planDetails.consumption_m3} m³`)
    if (planDetails.plan_name) detailParts.push(`Plan: ${planDetails.plan_name}`)
    if (planDetails.speed_mbps) detailParts.push(`Speed: ${planDetails.speed_mbps} Mbps`)
    if (planDetails.data_gb) detailParts.push(`Data: ${planDetails.data_gb} GB`)
    if (detailParts.length > 0) prompt += `\n- Plan details: ${detailParts.join(' \u00B7 ')}`
  } else {
    prompt += `\n- No plan details uploaded yet`
  }

  if (bill.contract_end_date) {
    prompt += `\n- Contract ends: ${bill.contract_end_date}`
  } else {
    prompt += `\n- No contract end date known`
  }

  prompt += `\n- Permanencia: ${bill.has_permanencia ? 'Yes \u2014 check before switching!' : 'No'}`

  if (bill.potential_saving_monthly) {
    prompt += `\n- Previously researched saving: ${bill.currency || 'EUR'} ${bill.potential_saving_monthly}/month`
  }

  prompt += `

Your approach:
1. If plan details are missing, ask the user to upload their latest bill from the /bills page or provide key details (tariff type, consumption, contracted power).
2. If plan details exist, summarise what you know and ask if the user wants you to research alternatives.
3. When researching, call the search_bill_alternatives tool with all available details.
4. Present alternatives clearly with pros/cons. Be specific about potential savings.
5. If recommending a switch, create an action item with specific steps.

Spanish utility notes:
- Electricity: Ask about tariff type (PVPC regulated vs mercado libre). PVPC prices change hourly. Mercado libre offers fixed rates.
- Gas: Often bimonthly in Spain. Check if they heat with gas or just cooking/hot water.
- Internet: Digi uses the Movistar network for fibra. Check building infrastructure.
- Insurance: Sanitas/Adeslas are the main private health insurers. Annual renewal standard. Age-based pricing.
- Water: Usually municipal monopoly. Don't waste time researching alternatives.
- NEVER recommend switching if permanencia hasn't expired.`

  return prompt
}
