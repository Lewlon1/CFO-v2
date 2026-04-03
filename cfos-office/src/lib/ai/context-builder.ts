import { createClient } from '@/lib/supabase/server';
import { BASE_PERSONA } from './system-prompt';

export async function buildSystemPrompt(
  userId: string,
  conversationType?: string
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
  ] = await Promise.allSettled([
    supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single(),
    supabase
      .from('monthly_snapshots')
      .select('*')
      .eq('profile_id', userId)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(3),
    supabase
      .from('recurring_expenses')
      .select('*')
      .eq('user_id', userId),
    supabase
      .from('financial_portrait')
      .select('*')
      .eq('user_id', userId)
      .order('confidence', { ascending: false }),
    supabase
      .from('value_map_results')
      .select('*')
      .eq('profile_id', userId)
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
  ]);

  const profile = profileResult.status === 'fulfilled' ? profileResult.value.data : null;
  const snapshots = snapshotsResult.status === 'fulfilled' ? snapshotsResult.value.data : null;
  const recurring = recurringResult.status === 'fulfilled' ? recurringResult.value.data : null;
  const portrait = portraitResult.status === 'fulfilled' ? portraitResult.value.data : null;
  const valueMap = valueMapResult.status === 'fulfilled' ? valueMapResult.value.data : null;
  const goals = goalsResult.status === 'fulfilled' ? goalsResult.value.data : null;
  const actions = actionsResult.status === 'fulfilled' ? actionsResult.value.data : null;

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
    getConversationInstructions(conversationType),
    buildPortraitContext(portrait, valueMap),
    buildGoalsContext(goals, actions),
    buildProfilingContext(),
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

  // Latest monthly snapshot
  if (snapshots && snapshots.length > 0) {
    const latest = snapshots[0];
    const currency = profile?.primary_currency || 'EUR';

    parts.push(`## Financial summary (${latest.month}/${latest.year})`);
    if (profile?.net_monthly_income) parts.push(`Net monthly income: ${currency} ${profile.net_monthly_income}`);
    if (latest.total_expenses) parts.push(`Total spending: ${currency} ${latest.total_expenses}`);
    if (latest.total_savings) parts.push(`Savings: ${currency} ${latest.total_savings}`);
    if (latest.savings_rate) parts.push(`Savings rate: ${latest.savings_rate}%`);
    if (latest.expense_by_category && Object.keys(latest.expense_by_category).length > 0) {
      parts.push(`Spending by category: ${JSON.stringify(latest.expense_by_category)}`);
    }
    if (latest.expenses_delta_pct !== null && latest.expenses_delta_pct !== undefined) {
      parts.push(`vs previous month: ${latest.expenses_delta_pct > 0 ? '+' : ''}${latest.expenses_delta_pct}%`);
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

function buildProfilingContext(): string {
  // Placeholder for Session 6 — progressive profiling engine
  return '';
}

function getConversationInstructions(conversationType?: string): string {
  switch (conversationType) {
    case 'onboarding':
      return `## Conversation context: Onboarding

This is a new user. Welcome them warmly. If they completed the Value Map, reference their archetype naturally. Your goal is to understand what they're working toward financially. Don't overwhelm — one or two good questions, then listen.`;

    case 'monthly_review':
      return `## Conversation context: Monthly review

Walk the user through their month. Start with the headline number (surplus or deficit), then drill into what changed. Compare to last month. Highlight any value category shifts. End with 1-2 specific action items.`;

    case 'scenario':
      return `## Conversation context: Scenario modelling

The user wants to explore a what-if. Use system tools to model the scenario. Present the numbers clearly, then give your honest take on whether it makes sense given their situation.`;

    default:
      return `## Conversation context: General

This is an open conversation. Follow the user's lead. If they ask a question, answer it directly using their actual data. If there are pending action items, you may mention them if relevant.`;
  }
}
