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

// SaaS, payment-processor, and online-services merchants whose card
// descriptors include the merchant's billing-entity address — typically
// Dublin or another EU tax-residence city — even though the user's spend
// is online from anywhere. Tagging these as a physical location produces
// false "two cities" narratives in the geographic-modes detector.
//
// Bank-agnostic: the patterns target merchant names in the description,
// which every bank exports. When matched, location enrichment is skipped
// for that row; the row stays usable everywhere else.
const SAAS_BILLING_PATTERNS: RegExp[] = [
  // Cloud / dev tools
  /\bAWS\b/i,
  /\bAMAZON WEB SERVICES\b/i,
  /\bGOOGLE\b/i,
  /\bGCP\b/i,
  /\bMICROSOFT\b/i,
  /\bAZURE\b/i,
  /\bMETA(?:\s+PLATFORMS|\s+IRELAND)?\b/i,
  /\bFACEBOOK\b/i,
  /\bLINKEDIN\b/i,
  /\bAPPLE\.COM\b/i,
  /\bAPPLE DISTRIBUTION\b/i,
  /\bGITHUB\b/i,
  /\bGITLAB\b/i,
  /\bVERCEL\b/i,
  /\bCLOUDFLARE\b/i,
  /\bDIGITALOCEAN\b/i,
  /\bHEROKU\b/i,
  /\bNETLIFY\b/i,
  /\bRAILWAY\b/i,
  // Productivity / SaaS
  /\bNOTION\b/i,
  /\bFIGMA\b/i,
  /\bSLACK\b/i,
  /\bDROPBOX\b/i,
  /\bZOOM\b/i,
  /\bADOBE\b/i,
  /\bOPENAI\b/i,
  /\bANTHROPIC\b/i,
  /\bSUBSTACK\b/i,
  /\bSQUARESPACE\b/i,
  /\bDISCORD\b/i,
  // Streaming / consumer subscriptions billed via Irish entities
  /\bSPOTIFY\b/i,
  /\bNETFLIX\b/i,
  /\bDISNEY\s*\+/i,
  /\bAMAZON PRIME\b/i,
  // Payment processors / gateways
  /\bSTRIPE\b/i,
  /\bPADDLE\b/i,
  /\bCHECKOUT\.COM\b/i,
  /\bADYEN\b/i,
  /\bBRAINTREE\b/i,
  /\bPAYPAL\b/i,
  // Generic structural hints — descriptions that look like online billing
  // descriptors rather than physical merchant locations.
  /\.COM\b/i,            // MERCHANT.COM — almost always online
  /\.IO\b/i,
  /\.NET\b/i,
  /\.APP\b/i,
  /^\*[A-Z]/,            // Visa platform indicator (*MERCHANT)
]

function isSaaSBilling(description: string): boolean {
  for (const pattern of SAAS_BILLING_PATTERNS) {
    if (pattern.test(description)) return true
  }
  return false
}

/**
 * Post-import enricher: scans transaction descriptions for known city names
 * and writes `location_city` / `location_country` on matches.
 *
 * Scoped by (user_id, import_batch_id) so a single import only re-checks its
 * own rows. Only rows without an existing location are considered, making
 * this safe to re-run.
 *
 * SaaS / payment-processor / online-services merchants are skipped — their
 * card descriptors carry the billing entity's address (typically Dublin)
 * not the user's actual location.
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
    if (isSaaSBilling(desc)) continue
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
