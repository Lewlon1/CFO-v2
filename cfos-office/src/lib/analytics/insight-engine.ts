// cfos-office/src/lib/analytics/insight-engine.ts

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  InsightPayload, DataDependency, PatternResult, StatCard, Hook,
  DetectorContext, InsightLayer,
} from './insight-types';
import { BLOCKED_AT_FIRST_INSIGHT } from './insight-types';
import {
  PATTERN_LIBRARY,
  formatCurrency,
  isExpense,
  absExpense,
  normaliseMerchant,
} from './pattern-detectors';

export async function computeFirstInsight(
  supabase: SupabaseClient,
  userId: string
): Promise<InsightPayload> {
  const [profile, transactions, snapshots, recurring, valueMap] = await Promise.all([
    loadProfile(supabase, userId),
    loadTransactions(supabase, userId),
    loadSnapshots(supabase, userId),
    loadRecurring(supabase, userId),
    loadValueMap(supabase, userId),
  ]);

  const currency = profile?.primary_currency ?? 'EUR';
  const country = profile?.country ?? null;

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
  const statCards = computeStatCards(layers, ctx);
  const hook = determineHook(available, valueMap);
  const disciplineScore = computeDisciplineScore(ctx);
  const suggestedResponses = buildSuggestedResponses(layers, hook);

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
    computedAt: new Date().toISOString(),
  };
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
    .filter(t => isExpense(Number(t.amount)))
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
    type: 'ask_goals',
    prompt_for_claude:
      `Ask what the user is trying to do with their money — the point of all this. Keep it open.`,
    suggested_response: 'Tell them my goals',
  };
}

export function computeDisciplineScore(_ctx: DetectorContext): number {
  // Filled in Phase E (Task E4)
  return 50;
}

function buildSuggestedResponses(
  _layers: InsightPayload['layers'],
  _hook: Hook
): string[] {
  // Filled in Phase E (Task E4)
  return [];
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
    .eq('user_id', userId);
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
