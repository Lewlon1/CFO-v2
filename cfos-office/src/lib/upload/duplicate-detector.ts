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

export function makeKey(date: string, amount: number, description: string): string {
  const normDesc = normaliseMerchant(description)
  return `${date}|${amount}|${normDesc}`
}

export function isDuplicate(
  txn: ParsedTransaction,
  existingKeys: Set<string>
): boolean {
  const key = makeKey(txn.date, txn.amount, txn.description)
  return existingKeys.has(key)
}
