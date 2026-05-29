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
import type { HookCandidate } from '@/lib/ai/compose-first-read-hooks'
import type { ValueMapTransaction } from './types'

type ConversationMetadata = {
  hook_candidates?: HookCandidate[] | null
  first_read_metadata?: {
    hook_candidates?: HookCandidate[] | null
  } | null
}

/**
 * Read the hook candidates persisted on the most recent layered
 * first_insight conversation for the user. Returns null when there's
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
    .eq('type', 'first_insight')
    .eq('metadata->>layered_read', 'true')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  const meta = data.metadata as ConversationMetadata | null
  // hook_candidates may live at the top level OR nested under
  // first_read_metadata depending on which composition path wrote them.
  const hooks =
    meta?.hook_candidates ??
    meta?.first_read_metadata?.hook_candidates ??
    null
  if (!hooks || hooks.length === 0) return null
  return hooks
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
): Promise<ValueMapTransaction[]> {
  if (hooks.length === 0) return []
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
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
