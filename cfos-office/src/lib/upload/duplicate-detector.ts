import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import type { ParsedTransaction } from '@/lib/parsers/types'

/**
 * Returns a Set of "duplicate keys" that already exist in the DB for this user.
 * Key format: "YYYY-MM-DD|amount|normalised_description"
 */
export async function loadExistingKeys(
  supabase: SupabaseClient,
  userId: string,
  dateFrom: string,
  dateTo: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from('transactions')
    .select('date, amount, description')
    .eq('user_id', userId)
    .gte('date', dateFrom)
    .lte('date', dateTo)

  const keys = new Set<string>()
  for (const row of data ?? []) {
    const dateStr = String(row.date ?? '').slice(0, 10)
    const key = makeKey(dateStr, row.amount, row.description)
    keys.add(key)
  }
  return keys
}

export function makeKey(date: string, amount: number | string, description: string): string {
  const normDesc = normaliseMerchant(description)
  // Day granularity + fixed 2dp amount → identical key regardless of
  // export source (Santander date-only vs Revolut timestamped).
  const day = String(date).slice(0, 10)
  const amt = Number(amount).toFixed(2)
  return `${day}|${amt}|${normDesc}`
}

export function isDuplicate(
  txn: ParsedTransaction,
  existingKeys: Set<string>
): boolean {
  const key = makeKey(txn.date, txn.amount, txn.description)
  return existingKeys.has(key)
}

// Stable, persisted hash for the DB unique constraint. Mirrors makeKey() so
// in-memory and DB-level dedupe agree on what counts as "the same transaction".
export function computeDedupeHash(date: string, amount: number | string, description: string): string {
  return createHash('sha256').update(makeKey(date, amount, description)).digest('hex')
}
