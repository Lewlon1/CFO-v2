// Build ValueMapTransaction rows from the First Read's hook candidates.
//
// The value-first onboarding flow's optional Value Map runs on the exact
// items the First Read named as "I can see this but I can't read it
// without you" — not the curated SAMPLE_TRANSACTIONS. We look up each
// hook candidate's merchant in the user's transactions table and pick
// the most recent representative row so the card the user sees is one
// they actually recognise.

import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { getDataWindowEnd, windowStartISO } from '@/lib/analytics/cluster-behaviour/queries'
import type { HookCandidate } from '@/lib/ai/compose-first-read-hooks'
import type { ValueMapTransaction } from './types'

type HookMetaSlice = { hook_candidates?: HookCandidate[] | null } | null
type ConversationMetadata = {
  hook_candidates?: HookCandidate[] | null
  first_read_metadata?: HookMetaSlice
  // The declared→actual upgrade writes its composition metadata (hook_candidates
  // included) under a DISTINCT key from the initial value-first Read. A declared-
  // path user who then upgraded has their real hooks here, NOT under
  // first_read_metadata (that one is the declared Read, which saw no txns → null).
  first_read_metadata_upgraded?: HookMetaSlice
}

/**
 * Read the hook candidates persisted on the most recent layered
 * first_read conversation for the user. Returns null when there's
 * no conversation or no hook list — callers fall back to samples.
 */
export async function getHookCandidatesForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<HookCandidate[] | null> {
  const { data } = await supabase
    .from('conversations')
    .select('metadata')
    .eq('user_id', userId)
    .eq('type', 'first_read')
    .eq('metadata->>layered_read', 'true')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  const meta = data.metadata as ConversationMetadata | null
  // hook_candidates can live under several keys depending on which composition
  // path last wrote a Read into this conversation. Prefer the freshest real-
  // transaction Read — the declared→actual upgrade — then the initial value-first
  // Read, then a bare top-level list. Pick the first NON-EMPTY list: a path that
  // saw no transactions writes hook_candidates: null/[] (the declared Read does),
  // and that must not shadow a populated list — a plain ?? chain stops on [].
  const candidateLists: Array<HookCandidate[] | null | undefined> = [
    meta?.first_read_metadata_upgraded?.hook_candidates,
    meta?.hook_candidates,
    meta?.first_read_metadata?.hook_candidates,
  ]
  const hooks = candidateLists.find((list) => Array.isArray(list) && list.length > 0)
  return hooks ?? null
}

/**
 * For each hook candidate, fetch ONE representative transaction from the
 * user's window and turn it into a ValueMapTransaction. Returns the
 * combined list in the hook-candidate order. Hooks that can't be matched
 * (the merchant didn't survive normalisation, or the transactions are
 * filtered out) are silently skipped.
 */
export async function buildRealTransactionsFromHooks(
  supabase: SupabaseClient,
  userId: string,
  hooks: HookCandidate[],
  currency: string,
  dataWindowEnd?: string | null,
): Promise<ValueMapTransaction[]> {
  if (hooks.length === 0) return []
  // Anchor the 90-day window to the user's latest transaction, not today, so a
  // stale upload's hook merchants still resolve to a representative row (a today-
  // anchored window returned nothing for data ending >90d ago → the value map
  // fell back to samples). Mirrors the composer + select-cards windowing.
  const windowEnd = dataWindowEnd ?? (await getDataWindowEnd(supabase, userId))
  const since = windowStartISO(90, windowEnd)
  const { data: txns } = await supabase
    .from('transactions')
    .select('id, description, amount, date, is_recurring, category_id, currency')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .lt('amount', 0)
    .gte('date', since)
    .order('date', { ascending: false })

  if (!txns || txns.length === 0) return []

  // Pre-bucket by normalised merchant so we can pick the most recent per
  // hook in one pass. The composer's hook ranking already uses
  // normaliseMerchantDescription on the cluster ids it emits, so we use
  // the same normalisation here to match.
  const buckets = new Map<string, typeof txns>()
  for (const t of txns) {
    const key = normaliseMerchant((t.description as string | null) ?? '')
    if (!key) continue
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(t)
  }

  const result: ValueMapTransaction[] = []
  for (const hook of hooks) {
    const key = normaliseMerchant(hook.cluster_id)
    const bucket = buckets.get(key)
    if (!bucket || bucket.length === 0) continue
    const t = bucket[0]
    result.push({
      id: t.id as string,
      merchant: hook.label,
      description: (t.description as string | null) ?? hook.label,
      amount: Math.abs(Number(t.amount)),
      currency: (t.currency as string | null) ?? currency,
      transaction_date: t.date as string,
      is_recurring: Boolean(t.is_recurring),
      category_id: (t.category_id as string | null) ?? null,
      granularity: 'intent',
      context: hook.period_hint,
    })
  }
  return result
}
