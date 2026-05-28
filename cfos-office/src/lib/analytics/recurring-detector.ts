import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { matchProvider } from '@/lib/bills/provider-registry'
import { classifyBillSubtype } from './benchmark/classify-subtype'

type TxnRow = {
  id: string
  date: string
  amount: number
  description: string
  category_id: string | null
}

// Thresholds for the regularity gate. A real recurring bill has consistent
// amount AND consistent cadence — casual spend (coffee, groceries, one-off
// Amazon) has variation. Tuned during the staging audit that flagged Satans
// Coffee and El Corte Inglés trips as "weekly recurring bills".
export const MIN_OCCURRENCES = 3
export const MAX_AMOUNT_CV = 0.20
export const MAX_GAP_CV = 0.35
export const MIN_MONTHLY_EQUIVALENT = 5

function detectFrequency(avgGap: number): { frequency: string; billingDay: boolean } {
  if (avgGap > 3 && avgGap < 10) return { frequency: 'weekly', billingDay: false }
  if (avgGap >= 10 && avgGap < 20) return { frequency: 'bi-weekly', billingDay: false }
  if (avgGap >= 25 && avgGap < 38) return { frequency: 'monthly', billingDay: true }
  if (avgGap >= 50 && avgGap < 75) return { frequency: 'bi-monthly', billingDay: true }
  if (avgGap >= 80 && avgGap < 105) return { frequency: 'quarterly', billingDay: true }
  if (avgGap >= 350 && avgGap < 380) return { frequency: 'annual', billingDay: true }
  return { frequency: 'irregular', billingDay: false }
}

/** Coefficient of variation (stddev / mean). Returns 0 when mean is 0 or values are empty. */
export function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  if (mean === 0) return 0
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / Math.abs(mean)
}

/** Normalise a per-occurrence amount to its monthly-equivalent given the detected frequency. */
export function monthlyEquivalent(amount: number, frequency: string): number {
  switch (frequency) {
    case 'weekly':
      return amount * 4.33
    case 'bi-weekly':
      return amount * 2.17
    case 'monthly':
      return amount
    case 'bi-monthly':
      return amount / 2
    case 'quarterly':
      return amount / 3
    case 'annual':
      return amount / 12
    default:
      return amount
  }
}

export type RecurringSignals = {
  occurrences: number
  amounts: number[]
  gapsDays: number[]
  frequency: string
}

/**
 * Pure regularity gate. Returns true when a cluster of transactions looks
 * like a real recurring bill (consistent amount and cadence) rather than
 * casual spend that happens to repeat.
 */
export function qualifiesAsRecurring(signals: RecurringSignals): boolean {
  if (signals.occurrences < MIN_OCCURRENCES) return false
  if (coefficientOfVariation(signals.amounts) > MAX_AMOUNT_CV) return false
  if (signals.gapsDays.length > 0 && coefficientOfVariation(signals.gapsDays) > MAX_GAP_CV) {
    return false
  }
  const meanAmount =
    signals.amounts.reduce((s, v) => s + Math.abs(v), 0) / signals.amounts.length
  if (monthlyEquivalent(meanAmount, signals.frequency) < MIN_MONTHLY_EQUIVALENT) return false
  return true
}

export async function detectAndFlagRecurring(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  // Fetch dismissed names so we can skip them. Re-normalise before lookup
  // so older rows written with mixed-case names still match the canonical
  // lowercase keys produced by the detector today.
  const { data: dismissedRows } = await supabase
    .from('recurring_expenses')
    .select('name')
    .eq('user_id', userId)
    .eq('status', 'dismissed')

  const dismissedNames = new Set(
    (dismissedRows ?? []).map((r) => normaliseMerchant(r.name as string)),
  )

  const { data: txns } = await supabase
    .from('transactions')
    .select('id, date, amount, description, category_id')
    .eq('user_id', userId)
    .gte('date', sixMonthsAgo.toISOString().slice(0, 10))
    .lt('amount', 0)
    .order('date', { ascending: true })

  if (!txns || txns.length < MIN_OCCURRENCES) return

  // Group by normalised description
  const groups = new Map<string, TxnRow[]>()
  for (const txn of txns) {
    const key = normaliseMerchant(txn.description)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(txn)
  }

  // Track which merchants qualified this sweep so we can clean up stale
  // 'detected' rows at the end (false positives previously written that
  // would no longer qualify under the tighter thresholds).
  const qualifiedMerchants = new Set<string>()

  for (const [normDesc, rows] of groups) {
    if (rows.length < MIN_OCCURRENCES) continue
    if (dismissedNames.has(normDesc)) continue

    const months = new Set(rows.map((r) => r.date.slice(0, 7)))
    if (months.size < 2) continue

    const dates = rows.map((r) => new Date(r.date)).sort((a, b) => a.getTime() - b.getTime())
    const gaps: number[] = []
    for (let i = 1; i < dates.length; i++) {
      gaps.push(
        Math.round((dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24))
      )
    }
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length

    const { frequency, billingDay: hasBillingDay } = detectFrequency(avgGap)
    const amounts = rows.map((r) => Math.abs(r.amount))

    if (
      !qualifiesAsRecurring({
        occurrences: rows.length,
        amounts,
        gapsDays: gaps,
        frequency,
      })
    ) {
      continue
    }

    const billingDay = hasBillingDay ? dates[dates.length - 1].getDate() : null

    const avgAmount = amounts.reduce((s, v) => s + v, 0) / amounts.length
    const latestRow = rows[rows.length - 1]

    // Check if this is a known bill provider
    const providerMatch = matchProvider(latestRow.description)
    const providerName = providerMatch?.provider.name ?? null

    // Classify the merchant into a benchmarkable subtype. High-confidence
    // matches persist immediately; ambiguous ones store the best guess too
    // — the flagger gates on country + sourced bands, not on confidence,
    // so an incorrect subtype only matters once real bands exist.
    const subtype = classifyBillSubtype(normDesc).subtype

    const ids = rows.map((r) => r.id)
    await supabase.from('transactions').update({ is_recurring: true }).in('id', ids)

    qualifiedMerchants.add(normDesc)

    // Upsert to recurring_expenses — relies on unique constraint (user_id, name)
    await supabase
      .from('recurring_expenses')
      .upsert(
        {
          user_id: userId,
          name: normDesc,
          amount: Math.round(avgAmount * 100) / 100,
          currency: 'EUR',
          frequency,
          billing_day: billingDay,
          category_id: latestRow.category_id,
          provider: providerName,
          bill_subtype: subtype,
        },
        { onConflict: 'user_id,name', ignoreDuplicates: false }
      )
      .then(({ error }) => {
        if (error) {
          // If constraint doesn't exist yet, silently skip — is_recurring flag is still set
          console.warn('[recurring-detector] upsert skipped:', error.message)
        }
      })
  }

  // Post-sweep cleanup: remove detector-managed rows that no longer qualify
  // under the tighter thresholds (e.g. coffee shops previously flagged as
  // "weekly recurring"). User-managed rows (status='tracked' / 'dismissed')
  // are protected — the filter is explicit.
  const { data: detectedRows } = await supabase
    .from('recurring_expenses')
    .select('id, name')
    .eq('user_id', userId)
    .eq('status', 'detected')

  if (detectedRows && detectedRows.length > 0) {
    const staleIds = detectedRows
      .filter((r) => !qualifiedMerchants.has(r.name as string))
      .map((r) => r.id as string)

    if (staleIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('recurring_expenses')
        .delete()
        .in('id', staleIds)
      if (deleteError) {
        console.warn('[recurring-detector] cleanup delete failed:', deleteError.message)
      } else {
        // Clear is_recurring on transactions whose merchant no longer qualifies
        // so the flag matches the recurring_expenses table.
        const staleNames = detectedRows
          .filter((r) => staleIds.includes(r.id as string))
          .map((r) => r.name as string)
        if (staleNames.length > 0) {
          const { data: staleTxns } = await supabase
            .from('transactions')
            .select('id, description')
            .eq('user_id', userId)
            .eq('is_recurring', true)
          if (staleTxns) {
            const toUnflag = staleTxns
              .filter((t) => staleNames.includes(normaliseMerchant(t.description as string)))
              .map((t) => t.id as string)
            if (toUnflag.length > 0) {
              await supabase
                .from('transactions')
                .update({ is_recurring: false })
                .in('id', toUnflag)
            }
          }
        }
      }
    }
  }
}
