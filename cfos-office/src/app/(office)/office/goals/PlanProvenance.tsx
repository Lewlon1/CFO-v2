// VM-4 Phase 7 — visible plan tailoring on the goals surface. Pure
// templating off existing data: the family frame line, the protected list,
// the funded-by line (cut-intent merchants × trailing monthly spend), and
// the burden optimisation queue. NO goal maths, ordering, or computation is
// touched — this section only shows WHY the plan looks the way it does.
//
// Server component; every fetch is fail-soft (an error renders nothing
// rather than breaking the goals page). Flag-gated at the page.

import { createClient } from '@/lib/supabase/server'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import {
  FAMILY_FRAME_LINES,
  type ArchetypeFamily,
  type CertaintyState,
} from '@/lib/value-map/taxonomy-config'
import { formatAmount } from '@/lib/value-map/format'

const MAX_PROTECTED_LINES = 4
const MAX_BURDEN_CHIPS = 3

/** Display-case a normalised merchant key ("netflix com" → "Netflix Com"). */
function displayMerchant(key: string): string {
  return key.replace(/\b\w/g, (c) => c.toUpperCase())
}

function monthStartIso(offset: number): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
    .toISOString()
    .slice(0, 10)
}

export async function PlanProvenance({ userId }: { userId: string }) {
  const supabase = await createClient()

  const [sessionRes, rulesRes, cutRes] = await Promise.all([
    supabase
      .from('value_map_sessions')
      .select('family, certainty_state')
      .eq('profile_id', userId)
      .not('taxonomy_version', 'is', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('value_category_rules')
      .select('match_value, value_category, confidence')
      .eq('user_id', userId)
      .eq('source', 'value_map_personal')
      .in('value_category', ['foundation', 'investment', 'burden'])
      .order('confidence', { ascending: false }),
    supabase
      .from('value_map_results')
      .select('merchant')
      .eq('profile_id', userId)
      .eq('cut_intent', true)
      .is('deleted_at', null),
  ])

  const rules = rulesRes.data ?? []
  const protectedRules = rules
    .filter((r) => r.value_category === 'foundation' || r.value_category === 'investment')
    .slice(0, MAX_PROTECTED_LINES)
  const burdenRules = rules
    .filter((r) => r.value_category === 'burden')
    .slice(0, MAX_BURDEN_CHIPS)
  const cutMerchants = [...new Set((cutRes.data ?? []).map((r) => r.merchant as string))]

  // Funded-by: trailing-3-full-month spend at the flagged merchants ÷ 3.
  // Money fact, exact — reconcilable against the transactions table.
  let fundedByMonthly = 0
  let currency = 'GBP'
  if (cutMerchants.length > 0) {
    const [{ data: txns }, { data: profile }] = await Promise.all([
      supabase
        .from('transactions')
        .select('description, amount, date')
        .eq('user_id', userId)
        .lt('amount', 0)
        .gte('date', monthStartIso(3))
        .lt('date', monthStartIso(0)),
      supabase.from('user_profiles').select('primary_currency').eq('id', userId).single(),
    ])
    currency = (profile?.primary_currency as string | null) ?? 'GBP'
    const cutSet = new Set(cutMerchants)
    const total = (txns ?? []).reduce((sum, t) => {
      const key = normaliseMerchant((t.description as string | null) ?? '')
      return cutSet.has(key) ? sum + Math.abs(Number(t.amount)) : sum
    }, 0)
    fundedByMonthly = Math.round(total / 3)
  }

  const family = (sessionRes.data?.family ?? null) as ArchetypeFamily | null
  const certainty = (sessionRes.data?.certainty_state ?? null) as CertaintyState | null
  const frameLine = family && certainty ? FAMILY_FRAME_LINES[family][certainty] : null

  const hasContent =
    frameLine || protectedRules.length > 0 || burdenRules.length > 0 || fundedByMonthly > 0
  if (!hasContent) return null

  return (
    <section
      aria-label="How your answers shaped this plan"
      className="rounded-control border border-border-subtle bg-bg-deep p-4 space-y-3"
    >
      {frameLine && (
        <p className="text-[13px] font-semibold text-text-primary">{frameLine}</p>
      )}

      {protectedRules.length > 0 && (
        <div className="space-y-1">
          {protectedRules.map((r) => (
            <p key={`p-${r.match_value}`} className="text-[11px] text-text-secondary">
              Protected — you called {displayMerchant(r.match_value)}{' '}
              {r.value_category === 'foundation' ? 'Foundation' : 'Investment'}
            </p>
          ))}
        </div>
      )}

      {fundedByMonthly > 0 && (
        <p className="text-[11px] text-text-secondary">
          Funded by the cuts you flagged: {formatAmount(fundedByMonthly, currency)}/mo
        </p>
      )}

      {burdenRules.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {burdenRules.map((r) => (
            <span
              key={`b-${r.match_value}`}
              className="text-[10px] px-1.5 py-0.5 rounded-pill bg-muted text-text-secondary"
            >
              You marked {displayMerchant(r.match_value)} Burden — optimisation queue
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
