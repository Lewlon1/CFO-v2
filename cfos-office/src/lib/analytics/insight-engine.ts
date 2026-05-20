// cfos-office/src/lib/analytics/insight-engine.ts

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  InsightPayload, DataDependency, PatternResult, StatCard, Hook,
  DetectorContext, InsightLayer, UserIntent, UserIntentStruggleType,
  ExperimentProposalLayer, ExperimentProposalCandidate,
} from './insight-types';
import { BLOCKED_AT_FIRST_INSIGHT } from './insight-types';
import {
  PATTERN_LIBRARY,
  formatCurrency,
  isPlSpend,
  absExpense,
} from './pattern-detectors';
import { groupByMerchant } from '@/lib/ai/tools/helpers/group-by-merchant';
import { EXPERIMENT_TEMPLATES, type GoalType } from '@/lib/experiments/templates';
import { rankCandidates } from '@/lib/experiments/scoring';
import {
  isCapacityAvailable,
  recentlyProposedTemplateIds,
} from '@/lib/experiments/limit';

/**
 * Resolve the user's currency.
 *
 * FINDINGS.md bug #2: `user_profiles.primary_currency` schema-defaults to
 * 'EUR' regardless of country, and the onboarding flow never asks. A UK
 * user therefore ends up with country='GB' but primary_currency='EUR',
 * and the first-insight narration renders "€" symbols on GBP data.
 *
 * Resolution order:
 *   1. profile.primary_currency, IF the user has set it to a non-default value
 *   2. dominant currency in the user's transactions (set by CSV upload)
 *   3. country-inferred currency (GB→GBP, US→USD, etc.)
 *   4. profile.primary_currency (even if it's the schema default 'EUR')
 *   5. 'EUR' final fallback
 *
 * The transactions check is the strongest signal post-CSV-upload — the parser
 * has already attached the per-row currency from the bank statement.
 */
export function resolveUserCurrency(
  country: string | null,
  profileCurrency: string | null,
  transactions: Array<{ currency?: string | null }> = [],
): string {
  const COUNTRY_CURRENCY: Record<string, string> = {
    GB: 'GBP',
    US: 'USD',
    CA: 'CAD',
    AU: 'AUD',
  };

  // 1. User has explicitly chosen a non-default currency — trust it.
  if (profileCurrency && profileCurrency !== 'EUR') {
    return profileCurrency;
  }

  // 2. Dominant currency in transactions (post-CSV upload signal).
  const txCurrency = dominantTransactionCurrency(transactions);
  if (txCurrency) return txCurrency;

  // 3. Country lookup.
  const inferred = country ? COUNTRY_CURRENCY[country.toUpperCase()] : null;
  if (inferred) return inferred;

  // 4 & 5: profile (likely 'EUR'), then hard fallback.
  return profileCurrency ?? 'EUR';
}

function dominantTransactionCurrency(
  transactions: Array<{ currency?: string | null }>,
): string | null {
  if (transactions.length < 5) return null;
  const counts = new Map<string, number>();
  for (const t of transactions) {
    if (!t.currency) continue;
    const c = t.currency.toUpperCase();
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best: { c: string; n: number } | null = null;
  for (const [c, n] of counts) {
    if (!best || n > best.n) best = { c, n };
  }
  // Require dominance — at least 70% of transactions in a single currency.
  if (best && best.n / transactions.length >= 0.7) return best.c;
  return null;
}

export async function computeFirstInsight(
  supabase: SupabaseClient,
  userId: string
): Promise<InsightPayload> {
  const [profile, transactions, snapshots, recurring, valueMap, goals] = await Promise.all([
    loadProfile(supabase, userId),
    loadTransactions(supabase, userId),
    loadSnapshots(supabase, userId),
    loadRecurring(supabase, userId),
    loadValueMap(supabase, userId),
    loadActiveGoals(supabase, userId),
  ]);

  const userIntent = resolveUserIntent(profile, goals);

  const country = profile?.country ?? null;
  const currency = resolveUserCurrency(
    country,
    profile?.primary_currency ?? null,
    transactions,
  );

  const available: DataDependency[] = ['transactions'];
  if (valueMap) available.push('value_map');
  if (snapshots.length >= 2) available.push('multi_month');
  if (transactions.some(t => t.balance !== null)) available.push('balance_data');
  if (transactions.some(t => t.location_city !== null || t.location_country !== null)) {
    available.push('location_data');
  }
  if (transactions.some(t => Number(t.amount) > 0)) available.push('income_signal');

  const ctx: DetectorContext = {
    supabase, userId,
    transactions, valueMap, snapshots, recurring,
    currency, country,
  };

  const results: PatternResult[] = [];
  for (const det of PATTERN_LIBRARY) {
    if (det.requires.some(d => BLOCKED_AT_FIRST_INSIGHT.includes(d))) continue;
    if (!det.requires.every(d => available.includes(d))) continue;
    const result = await det.detect(ctx);
    if (result && result.score > 0) results.push(result);
  }

  const layers = assignToLayers(results, valueMap !== null);
  const experimentProposal = await buildExperimentProposal(
    supabase,
    userId,
    results,
    goals,
  );
  const statCards = computeStatCards(layers, ctx);
  const hook = determineHook(available, valueMap);
  const disciplineScore = computeDisciplineScore(ctx);
  const suggestedResponses = buildSuggestedResponses(layers, hook, experimentProposal);

  return {
    version: 1,
    userName: profile?.display_name ?? null,
    country,
    currency,
    monthCount: snapshots.length,
    transactionCount: transactions.length,
    hasValueMap: valueMap !== null,
    archetype: valueMap?.archetype_name ?? null,
    disciplineScore,
    availableDependencies: available,
    layers,
    statCards,
    hook,
    suggestedResponses,
    userIntent,
    experiment_proposal: experimentProposal,
    computedAt: new Date().toISOString(),
  };
}

// Build the experiment-proposal layer: rank catalog templates against detected
// patterns + the user's active goal, exclude templates proposed within the
// last 90 days, and tag with capacity info so the LLM knows whether to
// actually surface the experiment or just describe it.
async function buildExperimentProposal(
  supabase: SupabaseClient,
  userId: string,
  results: PatternResult[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  goals: any[],
): Promise<ExperimentProposalLayer | null> {
  const detectedPatternIds = results.map((r) => r.id);
  if (detectedPatternIds.length === 0) return null;

  const goalType = resolveGoalType(goals);
  const [excluded, capacity] = await Promise.all([
    recentlyProposedTemplateIds(supabase, userId),
    isCapacityAvailable(supabase, userId),
  ]);

  const ranked = rankCandidates({
    templates: EXPERIMENT_TEMPLATES,
    detectedPatternIds,
    goalType,
    excludedTemplateIds: excluded,
  });

  if (ranked.length === 0) {
    return { primary: null, alternatives: [], capacity };
  }

  const top3 = ranked.slice(0, 3).map((scored): ExperimentProposalCandidate => {
    const template = EXPERIMENT_TEMPLATES.find((t) => t.id === scored.template_id);
    return {
      template_id: scored.template_id,
      source_pattern_id: scored.source_pattern_id,
      title: template?.title_template ?? scored.template_id,
      hypothesis: template?.hypothesis ?? '',
      success_criterion: template?.success_criterion_template ?? '',
      duration_days: template?.duration_days ?? 7,
      target_metric: { ...(template?.target_metric ?? { kind: 'completed' }) },
      score: Math.round(scored.score * 10000) / 10000,
      scoring_breakdown: {
        goal_alignment: scored.breakdown.goal_alignment,
        measurability: scored.breakdown.measurability,
        effort: scored.breakdown.effort,
        reach: scored.breakdown.reach,
      },
    };
  });

  return {
    primary: top3[0] ?? null,
    alternatives: top3.slice(1),
    capacity,
  };
}

function resolveGoalType(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  goals: any[],
): GoalType | null {
  if (!Array.isArray(goals) || goals.length === 0) return null;
  const raw = goals[0]?.type as string | undefined;
  if (raw === 'debt_clearance' || raw === 'savings' || raw === 'investment' || raw === 'general') {
    return raw;
  }
  return null;
}

/**
 * Resolve the user's stated intent from the highest-signal source available.
 * Precedence:
 *   1. An active row in `goals` — the user has explicitly told us a goal,
 *      either via Claude's create_goal tool or via the goals page.
 *   2. `entry_struggle` set to anything other than 'dont_know' — they picked
 *      a struggle category at the onboarding-v2 entry screen.
 *   3. `entry_struggle = 'free_text'` with text content.
 *   4. null — we have nothing to anchor the wow moment to.
 */
function resolveUserIntent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  goals: any[],
): UserIntent | null {
  if (Array.isArray(goals) && goals.length > 0) {
    const top = goals[0];
    return {
      source: 'goal',
      goalName: top.name ?? undefined,
      text: top.description ?? top.name ?? undefined,
    };
  }

  const struggle = (profile?.entry_struggle ?? null) as string | null;
  const struggleText = (profile?.entry_struggle_text ?? null) as string | null;

  if (struggle === 'wealth' || struggle === 'debt' || struggle === 'planning') {
    return {
      source: 'entry_struggle',
      struggleType: struggle as UserIntentStruggleType,
    };
  }

  if (struggle === 'free_text' && struggleText && struggleText.trim().length > 0) {
    return {
      source: 'entry_struggle',
      struggleType: 'free_text',
      text: struggleText.trim(),
    };
  }

  return null;
}

export function assignToLayers(
  results: PatternResult[],
  hasValueMap: boolean
): InsightPayload['layers'] {
  const layers: InsightPayload['layers'] = {};
  const priority: InsightLayer[] = [
    'headline', 'gap', 'numbers', 'hidden_pattern', 'action', 'hook',
  ];
  const sorted = [...results].sort((a, b) => b.score - a.score);
  const used = new Set<string>();

  for (const layer of priority) {
    const candidate = sorted.find(r => !used.has(r.id) && r.layer === layer);
    if (candidate) {
      layers[layer] = candidate;
      used.add(candidate.id);
    } else if (layer === 'gap' && !hasValueMap) {
      const shape = sorted.find(r =>
        !used.has(r.id) &&
        (r.id === 'convenience_vs_planned' || r.id === 'spending_velocity'));
      if (shape) { layers[layer] = shape; used.add(shape.id); }
    }
  }

  return layers;
}

export function computeStatCards(
  layers: InsightPayload['layers'],
  ctx: DetectorContext
): StatCard[] {
  const cards: StatCard[] = [];
  const totalSpend = ctx.transactions
    .filter(t => isPlSpend(t))
    .reduce((s, t) => s + absExpense(Number(t.amount)), 0);

  // Card 1: total tracked spend
  cards.push({
    label: ctx.snapshots.length > 1 ? 'Tracked spend' : 'This period',
    value: formatCurrency(totalSpend, ctx.currency),
    source_pattern_id: 'system',
  });

  // Card 2: derived from headline pattern if possible
  const headline = layers.headline;
  if (headline?.id === 'category_concentration') {
    cards.push({
      label: String(headline.data.topCategory),
      value: `${headline.data.topPct}%`,
      source_pattern_id: headline.id,
    });
  } else if (headline?.id === 'income_detected') {
    cards.push({
      label: 'Deposits seen',
      value: String(headline.data.depositCount ?? 0),
      source_pattern_id: headline.id,
    });
  } else if (headline?.id === 'geographic_spending_modes') {
    const groups = headline.data.groups as Array<{ location: string }> | undefined;
    cards.push({
      label: 'Locations',
      value: String(groups?.length ?? 0),
      source_pattern_id: headline.id,
    });
  } else if (headline?.id === 'balance_trajectory') {
    cards.push({
      label: 'Balance shape',
      value: String(headline.data.shape ?? '—'),
      source_pattern_id: headline.id,
    });
  } else {
    cards.push({
      label: 'Transactions',
      value: String(ctx.transactions.length),
      source_pattern_id: 'system',
    });
  }

  // Card 3: from hidden_pattern if present, else recurring total
  const hidden = layers.hidden_pattern;
  if (hidden?.id === 'merchant_fragmentation') {
    cards.push({
      label: 'Food stores',
      value: String(hidden.data.storeCount),
      source_pattern_id: hidden.id,
    });
  } else if (hidden?.id === 'transaction_size_distribution') {
    cards.push({
      label: `Sub-${ctx.currency === 'GBP' ? '£' : ctx.currency === 'USD' ? '$' : '€'}10 decisions`,
      value: String(hidden.data.countUnder10),
      source_pattern_id: hidden.id,
    });
  } else if (hidden?.id === 'day_of_week_skew') {
    cards.push({
      label: 'Peak day',
      value: String(hidden.data.outlierName ?? '—'),
      source_pattern_id: hidden.id,
    });
  } else {
    cards.push({
      label: 'Recurring bills',
      value: String(ctx.recurring.length),
      source_pattern_id: 'system',
    });
  }

  return cards;
}

export function determineHook(
  available: DataDependency[],
  valueMap: unknown | null
): Hook {
  if (!valueMap) return {
    type: 'ask_value_map',
    prompt_for_claude:
      `End the insight by noting you haven't seen the user's Value Map yet. ` +
      `Say the Value Map sharpens your read on what they consider worth the money vs. a leak. ` +
      `Do not say the words "affordable" or "sustainable".`,
    suggested_response: 'Show me the Value Map',
  };
  if (!available.includes('income_signal')) return {
    type: 'ask_income',
    prompt_for_claude:
      `End by asking what the user earns. Frame: "I can see what goes out — I haven't seen what comes in yet." ` +
      `Do NOT compute or imply any ratio. Do NOT say "so you can save X" — you don't know what comes in.`,
    suggested_response: 'Tell them my income',
  };
  if (!available.includes('multi_month')) return {
    type: 'ask_second_month',
    prompt_for_claude:
      `Note that one month is a snapshot. A second statement would let you see what's consistent vs one-off.`,
    suggested_response: 'Upload another statement',
  };
  return {
    type: 'conclude',
    prompt_for_claude:
      `End with a confident forward-looking statement. You've seen a lot — signal that this is just the beginning. ` +
      `Do NOT ask the user a question. End the narrative decisively.`,
    suggested_response: "Let's get started",
  };
}

export function computeDisciplineScore(ctx: DetectorContext): number {
  let s = 0;
  if (ctx.recurring.length > 0) s += 25;
  if (ctx.transactions.some(t => t.is_holiday_spend)) s += 20;
  if (ctx.valueMap) s += 15;

  // monthly deposit cadence
  const positives = ctx.transactions.filter(t => Number(t.amount) > 0);
  if (positives.length >= 2) {
    const sorted = [...positives].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    let monthlyGaps = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1].date as string).getTime();
      const curr = new Date(sorted[i].date as string).getTime();
      const gapDays = Math.abs(curr - prev) / (1000 * 60 * 60 * 24);
      if (gapDays >= 25 && gapDays <= 35) monthlyGaps++;
    }
    if (monthlyGaps >= 1) s += 20;
  }

  // merchant concentration
  // Pre-filter to spend rows so groupByMerchant's refund-netting collapses
  // to plain absolute spend (no positive amounts present after this filter).
  const expenses = ctx.transactions.filter(t => isPlSpend(t));
  if (expenses.length > 0) {
    const merchants = groupByMerchant(
      expenses.map(t => ({
        amount: t.amount,
        description: t.description ?? null,
        date: t.date,
        category_id: t.category_id ?? null,
      }))
    );
    const total = expenses.reduce((a, t) => a + absExpense(Number(t.amount)), 0);
    const top5 = merchants
      .slice(0, 5)
      .reduce((a, m) => a + m.total_spend, 0);
    if (total > 0 && top5 / total > 0.5) s += 20;
  }

  return Math.min(100, s);
}

/**
 * V1-ONLY: deterministic chip generator for the first-insight prompt.
 * The Session v2.2 Chat Intelligence v2 prompt does NOT call this — chips
 * come from the LLM emitting an [OPTIONS] block validated by
 * insight-validator.ts (Phase 6). Do not remove until v1 path is retired.
 */
function buildSuggestedResponses(
  layers: InsightPayload['layers'],
  hook: Hook,
  experimentProposal: ExperimentProposalLayer | null,
): string[] {
  const out: string[] = [];

  // 1. Experiment acceptance leads when present — most concrete next action.
  if (experimentProposal?.primary && experimentProposal.capacity.allowed) {
    out.push("Yes, let's try it");
    out.push('Pick a different one');
  } else if (experimentProposal?.primary) {
    out.push('Show me a different one');
  }

  // 2. Pattern-specific drill-down action. Each maps to a concrete task the
  // chat can execute, not a conversation starter.
  const headline = layers.headline;
  const hidden = layers.hidden_pattern;
  const drillSource = headline ?? hidden;
  if (drillSource?.id === 'category_concentration') {
    const cat = (drillSource.data as { topCategory?: string }).topCategory;
    out.push(cat ? `Break down my ${cat.toLowerCase()}` : 'Break down my top category');
  } else if (drillSource?.id === 'merchant_fragmentation') {
    out.push('List my top merchants by spend');
  } else if (drillSource?.id === 'day_of_week_skew') {
    out.push('Show me what I spent last Saturday');
  } else if (drillSource?.id === 'recurring_expense_total') {
    out.push('List every recurring charge');
  } else if (drillSource?.id === 'spending_velocity') {
    out.push('Show my weekly spending pace');
  } else if (drillSource?.id === 'convenience_vs_planned') {
    out.push('Show me my convenience spending');
  } else if (drillSource) {
    out.push('Show me the full breakdown');
  }

  // 3. Hook's own suggested response stays (it's the narrative's closing action).
  // Kept last so experiment + pattern action are the top two tappable chips.
  if (hook.suggested_response) out.push(hook.suggested_response);

  // Dedupe and cap at 3.
  return Array.from(new Set(out)).slice(0, 3);
}

// --- Loaders ---

async function loadProfile(s: SupabaseClient, userId: string) {
  const { data } = await s.from('user_profiles').select('*').eq('id', userId).maybeSingle();
  return data;
}

async function loadTransactions(s: SupabaseClient, userId: string) {
  const { data } = await s
    .from('transactions').select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });
  return data ?? [];
}

async function loadSnapshots(s: SupabaseClient, userId: string) {
  const { data } = await s
    .from('monthly_snapshots').select('*')
    .eq('user_id', userId)
    .order('month', { ascending: false });
  return data ?? [];
}

async function loadRecurring(s: SupabaseClient, userId: string) {
  const { data } = await s
    .from('recurring_expenses').select('*')
    .eq('user_id', userId)
    .eq('status', 'tracked')
    .is('deleted_at', null);
  return data ?? [];
}

async function loadActiveGoals(s: SupabaseClient, userId: string) {
  const { data } = await s
    .from('goals')
    .select('id, name, description, target_amount, target_date, priority, type, created_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  return data ?? [];
}

async function loadValueMap(s: SupabaseClient, userId: string) {
  // The archetype + session metadata lives on value_map_sessions (keyed by profile_id,
  // which equals the auth user id). value_map_results stores per-transaction
  // categorisations, not the session summary.
  const { data } = await s
    .from('value_map_sessions').select('*')
    .eq('profile_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}
