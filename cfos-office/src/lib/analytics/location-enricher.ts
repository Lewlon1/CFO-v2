import type { SupabaseClient } from '@supabase/supabase-js'

// Minimal seed list — expand iteratively as we see real data in staging.
// Patterns use \b word boundaries to avoid matching substrings (e.g. MADRID
// inside MADRIDEJOS). Country codes are ISO 3166-1 alpha-2.
const CITY_MAP: Array<{ pattern: RegExp; city: string; country: string }> = [
  { pattern: /\bLONDON\b/i, city: 'London', country: 'GB' },
  { pattern: /\bMADRID\b/i, city: 'Madrid', country: 'ES' },
  { pattern: /\bBARCELONA\b/i, city: 'Barcelona', country: 'ES' },
  { pattern: /\b(LISBON|LISBOA)\b/i, city: 'Lisbon', country: 'PT' },
  { pattern: /\bPORTO\b/i, city: 'Porto', country: 'PT' },
  { pattern: /\bPARIS\b/i, city: 'Paris', country: 'FR' },
  { pattern: /\bBERLIN\b/i, city: 'Berlin', country: 'DE' },
  { pattern: /\bAMSTERDAM\b/i, city: 'Amsterdam', country: 'NL' },
  { pattern: /\bDUBLIN\b/i, city: 'Dublin', country: 'IE' },
  { pattern: /\b(NEW YORK|NYC)\b/i, city: 'New York', country: 'US' },
  { pattern: /\bEDINBURGH\b/i, city: 'Edinburgh', country: 'GB' },
  { pattern: /\bMANCHESTER\b/i, city: 'Manchester', country: 'GB' },
  { pattern: /\bVALENCIA\b/i, city: 'Valencia', country: 'ES' },
  { pattern: /\bSEVILLE|SEVILLA\b/i, city: 'Seville', country: 'ES' },
  { pattern: /\bMILAN|MILANO\b/i, city: 'Milan', country: 'IT' },
  { pattern: /\bROME|ROMA\b/i, city: 'Rome', country: 'IT' },
]

/**
 * Post-import enricher: scans transaction descriptions for known city names
 * and writes `location_city` / `location_country` on matches.
 *
 * Scoped by (user_id, import_batch_id) so a single import only re-checks its
 * own rows. Only rows without an existing location are considered, making
 * this safe to re-run.
 *
 * Returns the number of rows updated.
 */
export async function enrichLocation(
  supabase: SupabaseClient,
  userId: string,
  importBatchId: string
): Promise<number> {
  const { data: txs } = await supabase
    .from('transactions')
    .select('id, description')
    .eq('user_id', userId)
    .eq('import_batch_id', importBatchId)
    .is('location_city', null)
  if (!txs || txs.length === 0) return 0

  const updates: Array<{ id: string; city: string; country: string }> = []
  for (const t of txs) {
    const desc = t.description ?? ''
    for (const entry of CITY_MAP) {
      if (entry.pattern.test(desc)) {
        updates.push({ id: t.id, city: entry.city, country: entry.country })
        break
      }
    }
  }
  if (updates.length === 0) return 0

  // Update in small batches; Promise.all is fine for a few dozen updates
  for (let i = 0; i < updates.length; i += 50) {
    const batch = updates.slice(i, i + 50)
    await Promise.all(
      batch.map((u) =>
        supabase
          .from('transactions')
          .update({ location_city: u.city, location_country: u.country })
          .eq('id', u.id)
      )
    )
  }
  return updates.length
}
