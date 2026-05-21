import type { SupabaseClient } from '@supabase/supabase-js'
import { computeIncomeSignal } from '@/lib/analytics/income-signal'

/**
 * Deterministically-computed fact payload fed to the hypothesis generator.
 * Never quoted to the user — internal audit trail only.
 */
export interface HypothesisSourceSignals {
  user_id: string
  display_name: string | null
  country: string | null
  currency: string

  income: {
    confidence: number
    cadence: 'monthly' | 'bi_monthly' | 'irregular' | 'unknown'
  }

  goal: {
    present: boolean
    type: string | null
    has_target_amount: boolean
    has_target_date: boolean
    structure_quality: 'fully_structured' | 'partial' | 'nameless'
  }

  value_map: {
    completed: boolean
    archetype: string | null
    dominant_quadrant: 'foundation' | 'investment' | 'leak' | 'burden' | null
    has_personal_data: boolean
    top_foundation_categories: string[]
    top_leak_categories: string[]
  }

  behaviour: {
    transaction_count: number
    months_of_data: number
    discipline_label: 'disciplined' | 'inconsistent' | 'high_friction' | 'unknown'
    has_zero_spend_days: boolean
    subscription_density: 'low' | 'medium' | 'high'
  }

  entry: {
    struggle_type: string | null
    free_text_excerpt: string | null
  }
}

export interface BuildSignalsInputs {
  profile: {
    display_name: string | null
    country: string | null
    primary_currency: string | null
    entry_struggle: string | null
    entry_struggle_text: string | null
  } | null
  goal: {
    type: string | null
    target_amount: number | null
    target_date: string | null
    name: string | null
  } | null
  valueMapSession: {
    type: string | null
    is_real_data: boolean | null
    dominant_quadrant: string | null
    archetype_name: string | null
    personality_type: string | null
  } | null
  transactions: Array<{ amount: number; date: string }>
  snapshots: Array<{
    total_income: number | null
    total_spending: number | null
    spending_by_value_category: Record<string, number> | null
  }>
  recurringCount: number
  valueProfile: {
    has_personal_data: boolean
    top_foundation: string[]
    top_leak: string[]
  }
}

/**
 * Compose the source signals payload. Public Supabase-reading entry point.
 * Pure-function helpers below are tested directly; this wrapper is covered
 * by integration / persona runs in Phase 8.
 */
export async function buildHypothesisSourceSignals(
  supabase: SupabaseClient,
  userId: string,
): Promise<HypothesisSourceSignals> {
  const [profile, goal, vmSession, transactions, snapshots, recurring] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('display_name, country, primary_currency, entry_struggle, entry_struggle_text')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('goals')
      .select('type, target_amount, target_date, name')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('value_map_sessions')
      .select('type, is_real_data, dominant_quadrant, archetype_name, personality_type')
      .eq('profile_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('transactions')
      .select('amount, date')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('date', { ascending: false })
      .limit(2000),
    supabase
      .from('monthly_snapshots')
      .select('total_income, total_spending, spending_by_value_category')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('month', { ascending: false })
      .limit(6),
    supabase
      .from('recurring_expenses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null),
  ])

  const valueProfile = await loadValueProfileSafely(supabase, userId)

  return composeSignals(userId, {
    profile: profile.data ?? null,
    goal: goal.data ?? null,
    valueMapSession: vmSession.data ?? null,
    transactions: (transactions.data ?? []).map((t) => ({
      amount: Number(t.amount),
      date: typeof t.date === 'string' ? t.date : new Date(t.date as unknown as string).toISOString(),
    })),
    snapshots: (snapshots.data ?? []) as BuildSignalsInputs['snapshots'],
    recurringCount: recurring.count ?? 0,
    valueProfile,
  })
}

/**
 * Pure composer — the testable surface. Given fully-resolved DB inputs,
 * produce the source signals payload deterministically.
 */
export function composeSignals(userId: string, inputs: BuildSignalsInputs): HypothesisSourceSignals {
  const incomeInput = inputs.transactions
    .filter((t) => t.amount > 0)
    .map((t) => ({ amount: t.amount, date: t.date }))
  const income = computeIncomeSignal(incomeInput)

  return {
    user_id: userId,
    display_name: inputs.profile?.display_name ?? null,
    country: inputs.profile?.country ?? null,
    currency: inputs.profile?.primary_currency ?? 'USD',

    income: {
      confidence: income.confidence,
      cadence: income.cadence,
    },

    goal: {
      present: Boolean(inputs.goal),
      type: inputs.goal?.type ?? null,
      has_target_amount: Boolean(inputs.goal?.target_amount),
      has_target_date: Boolean(inputs.goal?.target_date),
      structure_quality: computeGoalStructure(inputs.goal),
    },

    value_map: {
      completed: Boolean(inputs.valueMapSession),
      archetype:
        inputs.valueMapSession?.archetype_name ??
        inputs.valueMapSession?.personality_type ??
        null,
      dominant_quadrant: normaliseDominantQuadrant(inputs.valueMapSession?.dominant_quadrant ?? null),
      has_personal_data: inputs.valueProfile.has_personal_data,
      top_foundation_categories: inputs.valueProfile.top_foundation,
      top_leak_categories: inputs.valueProfile.top_leak,
    },

    behaviour: {
      transaction_count: inputs.transactions.length,
      months_of_data: uniqueMonths(inputs.transactions),
      discipline_label: computeDisciplineLabel(inputs.snapshots),
      has_zero_spend_days: computeHasZeroSpendDays(inputs.transactions),
      subscription_density: computeSubscriptionDensity(inputs.recurringCount),
    },

    entry: {
      struggle_type: inputs.profile?.entry_struggle ?? null,
      free_text_excerpt: inputs.profile?.entry_struggle_text?.slice(0, 80) ?? null,
    },
  }
}

export function computeGoalStructure(
  goal: BuildSignalsInputs['goal'],
): HypothesisSourceSignals['goal']['structure_quality'] {
  if (!goal) return 'nameless'
  if (goal.target_amount && goal.target_date) return 'fully_structured'
  if (goal.target_amount || goal.target_date) return 'partial'
  return 'nameless'
}

export function normaliseDominantQuadrant(
  raw: string | null,
): HypothesisSourceSignals['value_map']['dominant_quadrant'] {
  if (!raw) return null
  const v = raw.toLowerCase()
  if (v === 'foundation' || v === 'investment' || v === 'leak' || v === 'burden') return v
  return null
}

export function uniqueMonths(transactions: Array<{ date: string }>): number {
  const set = new Set<string>()
  for (const t of transactions) {
    set.add(t.date.slice(0, 7))
  }
  return set.size
}

export function computeHasZeroSpendDays(transactions: Array<{ amount: number; date: string }>): boolean {
  const debits = transactions.filter((t) => t.amount < 0)
  if (debits.length === 0) return true
  const days = new Set(debits.map((t) => t.date.slice(0, 10)))
  const sorted = [...days].sort()
  const start = new Date(sorted[0])
  const end = new Date(sorted[sorted.length - 1])
  const span = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  return days.size < span
}

export function computeSubscriptionDensity(
  count: number,
): HypothesisSourceSignals['behaviour']['subscription_density'] {
  if (count >= 6) return 'high'
  if (count >= 3) return 'medium'
  return 'low'
}

/**
 * Read discipline from monthly_snapshots' leak share + spend stability.
 * The model only ever sees the label — never the underlying numbers.
 *
 *   disciplined: leak share < 0.15 AND month-over-month spend CV < 0.2
 *   high_friction: leak share > 0.3
 *   inconsistent: otherwise (and ≥2 months of data)
 *   unknown: <2 months
 */
export function computeDisciplineLabel(
  snapshots: BuildSignalsInputs['snapshots'],
): HypothesisSourceSignals['behaviour']['discipline_label'] {
  if (snapshots.length < 2) return 'unknown'

  const leakShares = snapshots.map((s) => {
    const leak = s.spending_by_value_category?.leak ?? 0
    const spending = s.total_spending ?? 0
    return spending > 0 ? leak / spending : 0
  })
  const meanLeak = leakShares.reduce((a, b) => a + b, 0) / leakShares.length

  const spendValues = snapshots.map((s) => s.total_spending ?? 0)
  const meanSpend = spendValues.reduce((a, b) => a + b, 0) / spendValues.length
  const variance = spendValues.reduce((a, s) => a + (s - meanSpend) ** 2, 0) / spendValues.length
  const cv = meanSpend > 0 ? Math.sqrt(variance) / meanSpend : 1

  if (meanLeak < 0.15 && cv < 0.2) return 'disciplined'
  if (meanLeak > 0.3) return 'high_friction'
  return 'inconsistent'
}

/**
 * Best-effort import of the archetype-aware value-profile module. Lives on a
 * sibling worktree branch; absent on this branch by design. Returns a
 * neutral payload when the module isn't reachable.
 */
async function loadValueProfileSafely(
  supabase: SupabaseClient,
  userId: string,
): Promise<BuildSignalsInputs['valueProfile']> {
  try {
    // Soft dependency: value-profile.ts lives on the archetype-aware sibling
    // branch and is intentionally absent here. The dynamic specifier dodges
    // static module resolution so TS doesn't complain.
    const specifier = '@/lib/value-map/value-profile'
    const mod = (await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier).catch(
      () => null,
    )) as
      | { buildUserValueProfile?: (s: SupabaseClient, u: string) => Promise<unknown> }
      | null
    if (!mod || typeof mod.buildUserValueProfile !== 'function') {
      return { has_personal_data: false, top_foundation: [], top_leak: [] }
    }
    const profile = (await mod.buildUserValueProfile(supabase, userId)) as
      | { by_category?: Record<string, Record<string, number>>; signal_count?: Record<string, number> }
      | null
    if (!profile?.by_category) {
      return { has_personal_data: false, top_foundation: [], top_leak: [] }
    }
    return extractTopQuadrants(profile.by_category, profile.signal_count ?? {})
  } catch {
    return { has_personal_data: false, top_foundation: [], top_leak: [] }
  }
}

export function extractTopQuadrants(
  byCategory: Record<string, Record<string, number>>,
  signalCount: Record<string, number>,
): BuildSignalsInputs['valueProfile'] {
  const minSignal = 3
  const foundationCats: Array<{ cat: string; score: number }> = []
  const leakCats: Array<{ cat: string; score: number }> = []
  for (const [cat, dist] of Object.entries(byCategory)) {
    if ((signalCount[cat] ?? 0) < minSignal) continue
    foundationCats.push({ cat, score: dist.foundation ?? 0 })
    leakCats.push({ cat, score: dist.leak ?? 0 })
  }
  foundationCats.sort((a, b) => b.score - a.score)
  leakCats.sort((a, b) => b.score - a.score)

  const top_foundation = foundationCats
    .filter((c) => c.score > 0.5)
    .slice(0, 3)
    .map((c) => c.cat)
  const top_leak = leakCats
    .filter((c) => c.score > 0.5)
    .slice(0, 3)
    .map((c) => c.cat)

  return {
    has_personal_data: top_foundation.length > 0 || top_leak.length > 0,
    top_foundation,
    top_leak,
  }
}
