import type { SupabaseClient } from '@supabase/supabase-js'
import type { ObservationCandidate, TransactionRow } from './types'
import { DETECTORS } from './detectors'

const TRANSACTION_WINDOW_DAYS = 90
const MIN_TRANSACTIONS = 30
const DEFAULT_CURRENCY = 'GBP'

// Generates the wow-moment candidate for a user, or null if no detector
// produced a result. Caller supplies a service-role Supabase client so this
// function can read transactions / value_map_sessions without RLS friction.
//
// Lifetime guard: blocks if ANY prior `active_experiments` row exists for
// the user — not just status='active'. The brief calls for "one Sonnet call
// per user, lifetime" and the unique partial index alone would let a new
// experiment fire after the first one is dismissed/completed/expired.
export async function generateWowMomentCandidate(
  userId: string,
  supabase: SupabaseClient,
): Promise<ObservationCandidate | null> {
  // Lifetime block: any prior row at all.
  const priorCheck = await supabase
    .from('active_experiments')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
  if (priorCheck.data && priorCheck.data.length > 0) return null

  const since = new Date(Date.now() - TRANSACTION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const txResult = await supabase
    .from('transactions')
    .select('id, date, description, amount, category_id, value_category')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('date', since)
    .limit(2000)

  if (!txResult.data || txResult.data.length < MIN_TRANSACTIONS) return null

  // Resolve category_id → category name in one pass. Some rows may carry
  // category_id null (uncategorised); detectors treat null as no category.
  const categoryIds = Array.from(
    new Set(txResult.data.map((row) => row.category_id).filter((v): v is string => Boolean(v))),
  )
  const categoryNameById = new Map<string, string>()
  if (categoryIds.length > 0) {
    const catResult = await supabase
      .from('categories')
      .select('id, name')
      .in('id', categoryIds)
    for (const cat of catResult.data ?? []) {
      if (cat.id && cat.name) categoryNameById.set(cat.id, cat.name.toLowerCase())
    }
  }

  const transactions: TransactionRow[] = txResult.data.map((row) => ({
    id: row.id,
    date: row.date,
    description: row.description ?? '',
    amount: Number(row.amount),
    category: row.category_id ? categoryNameById.get(row.category_id) ?? null : null,
    value_category: row.value_category ?? null,
  }))

  // Resolve user context for templates. Both reads tolerate missing rows.
  const [profileResult, vmResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('primary_currency, country')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('value_map_sessions')
      .select('archetype_name')
      .eq('profile_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const currency = profileResult.data?.primary_currency ?? DEFAULT_CURRENCY
  const country = profileResult.data?.country ?? null
  const archetype = vmResult.data?.archetype_name ?? null

  const detectorResults = await Promise.all(
    DETECTORS.map((detector) =>
      detector({ transactions, archetype, currency, country }).catch((err) => {
        console.error('[experiments] detector failed:', err)
        return [] as ObservationCandidate[]
      }),
    ),
  )

  const flat = detectorResults.flat()
  if (flat.length === 0) return null

  flat.sort((a, b) => b.candidate_score - a.candidate_score)
  return flat[0]
}
