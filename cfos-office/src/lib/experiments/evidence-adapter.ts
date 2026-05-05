// Wraps the existing v2 detector pool (high-freq merchant, category variance,
// time pattern) and the analytics modules (gap-analyser, recurring-detector,
// holiday-detector) into v3 Evidence records. The output is the unified
// Evidence pool the v3 candidate engine ranks and feeds to the Opus author.
//
// Importantly: this file does NOT duplicate detector logic. It calls the
// existing detectors and translates their results into Evidence + claims.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Evidence, ObservationCandidate, TransactionRow, VerifiableClaim } from './types'
import { DETECTORS } from './detectors'
import { analyseGap } from '@/lib/analytics/gap-analyser'
import { currencySymbol } from './observation-templates'
import { amountForms, titleCase } from '@/lib/analytics/evidence-helpers'

// ── v2 ObservationCandidate → v3 Evidence ─────────────────────────────────

// Maps each v2 candidate kind into an Evidence record. The wow_score is
// derived from candidate_score with a per-source ceiling (these are baseline
// patterns; new detectors should outrank them when both fire).
export function candidateToEvidence(c: ObservationCandidate): Evidence {
  const symbol = currencySymbol(c.currency)
  const claims: VerifiableClaim[] = []
  const context_facts: Record<string, string | number> = {}

  // Walk the payload, materialise claims for any number / merchant / percent.
  for (const [key, raw] of Object.entries(c.payload)) {
    if (raw === null || raw === undefined) continue

    if (typeof raw === 'number') {
      // Heuristic: keys ending in `_share` or named `locked_share` are
      // percentages; anything else under €5 is treated as a count.
      if (key === 'locked_share' || key.endsWith('_share') || key.endsWith('_pct')) {
        claims.push({
          kind: 'percent',
          value: raw,
          alt_forms: [String(raw), `${raw}%`],
        })
        context_facts[key] = `${raw}%`
      } else if (key === 'count' || raw < 6) {
        claims.push({
          kind: 'count',
          value: raw,
          alt_forms: [String(raw)],
        })
        context_facts[key] = raw
      } else {
        claims.push({
          kind: 'amount',
          value: raw,
          alt_forms: amountForms(raw, symbol),
        })
        context_facts[key] = `${symbol}${raw}`
      }
    } else if (typeof raw === 'string') {
      if (key === 'merchant_name') {
        claims.push({
          kind: 'merchant',
          value: raw,
          alt_forms: [raw.toLowerCase(), raw.toUpperCase(), titleCase(raw)],
        })
        context_facts[key] = raw
      } else if (key === 'currency_symbol') {
        // Not a claim — symbol is allowed everywhere.
      } else if (key === 'ratio') {
        // ratio is "2.3"; treat as duration-ish so phrases like "2.3×" pass.
        const num = Number(raw)
        if (!Number.isNaN(num)) {
          claims.push({
            kind: 'count',
            value: raw,
            alt_forms: [raw, `${raw}×`, `${raw}x`, `${Math.round(num)}`],
          })
        }
        context_facts[key] = raw
      } else {
        context_facts[key] = raw
      }
    }
  }

  // wow_score: capped at 0.55 — below the Tier-1 threshold (0.6, see
  // tier-classifier). Legacy detectors are deliberately demoted: they were
  // the v2 ceiling and would otherwise re-introduce the original "Aldi 14
  // times" failure mode whenever no v3-native detector fired. They now
  // serve as Tier-2 supporting context only.
  const wow_score = Math.min(c.candidate_score * 0.55 + 0.05, 0.55)

  // Source mapping is one-to-one for the legacy three.
  const source = (c.observation_type as Evidence['source'])
  const evidence_id = `${source}:${c.pattern_template_key}`

  return {
    source,
    evidence_id,
    headline: buildLegacyHeadline(c, symbol),
    wow_score,
    verifiable_claims: claims,
    context_facts,
    brief: buildLegacyBrief(c, symbol),
    legacy_observation_type: c.observation_type,
  }
}

function buildLegacyHeadline(c: ObservationCandidate, symbol: string): string {
  switch (c.observation_type) {
    case 'high_freq_merchant': {
      const merchant = String(c.payload.merchant_name ?? 'a merchant')
      const count = Number(c.payload.count ?? 0)
      const total = Number(c.payload.total_spend ?? 0)
      return `${merchant} visited ${count} times — ${symbol}${total} total.`
    }
    case 'category_variance': {
      const share = Number(c.payload.locked_share ?? 0)
      return `${share}% of spend is essentials and obligations — chosen spend is squeezed.`
    }
    case 'time_pattern': {
      const ratio = String(c.payload.ratio ?? '?')
      return `Weekend spending runs ~${ratio}× weekday spending.`
    }
    default:
      return 'Observed pattern in spending.'
  }
}

function buildLegacyBrief(c: ObservationCandidate, symbol: string): string {
  switch (c.observation_type) {
    case 'high_freq_merchant': {
      const merchant = String(c.payload.merchant_name ?? 'a merchant')
      const count = Number(c.payload.count ?? 0)
      const total = Number(c.payload.total_spend ?? 0)
      return `${merchant} appears ${count} times in the last 90 days for ${symbol}${total}. There's a rhythm worth naming — boredom, hunger, habit, or something deliberate.`
    }
    case 'category_variance': {
      const share = Number(c.payload.locked_share ?? 0)
      return `${share}% of spend goes to essentials and obligations; very little is going to chosen / discretionary spend. The pattern is foundation-heavy and joy-light.`
    }
    case 'time_pattern': {
      const ratio = String(c.payload.ratio ?? '?')
      const wknd = Number(c.payload.weekend_avg ?? 0)
      const wkdy = Number(c.payload.weekday_avg ?? 0)
      return `Weekday discretionary average is ${symbol}${wkdy}; weekends average ${symbol}${wknd} — about ${ratio}× higher. Two different people across one week.`
    }
    default:
      return c.pattern_template_key
  }
}

// ── Gap-analyser → Evidence ───────────────────────────────────────────────

// The Value Map onboarding seeds rules with abstract phrases like
// "monthly rent / mortgage payment" or "online course or book" that almost
// never match real merchant descriptions. The gap-analyser does substring
// matching, so every VM user ends up with 4-6 false-positive `undervalued`
// gaps with 0% / €0. We filter those out here so they don't pollute the
// Tier-1 pool.
const PLACEHOLDER_TOKENS = [
  'monthly', 'weekly', 'daily', 'online', 'membership',
  'payment', 'subscription', 'bill', 'gift', 'course', 'book',
]

function looksLikeValueMapPlaceholder(matchValue: string): boolean {
  if (!matchValue) return false
  if (!matchValue.includes(' ')) return false
  const lower = matchValue.toLowerCase()
  return PLACEHOLDER_TOKENS.some((t) => lower.includes(t))
}

// Calls analyseGap and converts each material gap (medium/high severity AND
// non-aligned AND has actual spend) into an Evidence. The Value Map
// contradiction is one of the strongest wow vectors, so wow_score is high
// for high-severity gaps.
export async function gapsToEvidences(
  supabase: SupabaseClient,
  userId: string,
  currency: string,
): Promise<Evidence[]> {
  let result
  try {
    result = await analyseGap(supabase, userId, 3)
  } catch (err) {
    console.error('[evidence-adapter] gap analyser failed:', err)
    return []
  }
  if (!result.has_value_map) return []

  const evidences: Evidence[] = []
  const symbol = currencySymbol(currency)

  for (const gap of result.gaps) {
    if (gap.gap_type === 'aligned') continue
    if (gap.gap_severity === 'low') continue
    if (gap.actual_monthly_spend <= 0 && gap.gap_type !== 'undervalued') continue

    // Drop zero-spend `undervalued` gaps whose match_value is a Value Map
    // placeholder phrase. A real "I called gym Investment but never go" gap
    // would either have actual spend (sometimes) or a real merchant name
    // backing it; placeholders like "gym membership" / "monthly rent" never
    // match real txns and produce no signal worth surfacing.
    if (gap.gap_type === 'undervalued' && gap.actual_monthly_spend === 0) {
      // category_slug looks like "merchant:monthly rent / mortgage payment"
      // for VM-seeded merchant rules. Strip the prefix and inspect.
      const slugSuffix = gap.category_slug.startsWith('merchant:')
        ? gap.category_slug.slice('merchant:'.length)
        : gap.category_slug
      if (looksLikeValueMapPlaceholder(slugSuffix) || looksLikeValueMapPlaceholder(gap.category)) {
        continue
      }
    }

    // Cap undervalued at 0.5 — these operate on intent without spending data,
    // so they should never beat a real money-on-the-table evidence to Tier 1.
    // leaking_despite_awareness (high) and over_investing keep their stronger
    // scores because they reference real spend numbers.
    let wow_score: number
    if (gap.gap_type === 'undervalued') {
      wow_score = 0.5
    } else {
      wow_score = gap.gap_severity === 'high' ? 0.85 : 0.7
    }
    const claims: VerifiableClaim[] = [
      {
        kind: 'merchant', // category label rendered as merchant for the validator
        value: gap.category,
        alt_forms: [gap.category.toLowerCase(), gap.category.toUpperCase()],
      },
      {
        kind: 'amount',
        value: Math.round(gap.actual_monthly_spend),
        alt_forms: amountForms(gap.actual_monthly_spend, symbol),
      },
      {
        kind: 'percent',
        value: gap.pct_of_total_spending,
        alt_forms: [
          String(gap.pct_of_total_spending),
          `${gap.pct_of_total_spending}%`,
          `${Math.round(gap.pct_of_total_spending)}%`,
          String(Math.round(gap.pct_of_total_spending)),
        ],
      },
    ]

    const labelByGap: Record<string, string> = {
      leaking_despite_awareness: 'leak that keeps leaking',
      over_investing: 'investment commitment',
      hidden_burden: 'foundation that costs more than expected',
      undervalued: 'investment in name only',
      aligned: 'aligned',
    }
    const label = labelByGap[gap.gap_type] ?? gap.gap_type

    evidences.push({
      source: 'gap',
      evidence_id: `gap:${gap.category_slug}:${gap.gap_type}`,
      headline: `${gap.category} called ${gap.stated_value_category} — actual: ${gap.pct_of_total_spending}% of spend (${symbol}${Math.round(gap.actual_monthly_spend)}/mo). ${label}.`,
      wow_score,
      verifiable_claims: claims,
      context_facts: {
        stated_value_category: gap.stated_value_category,
        gap_type: gap.gap_type,
      },
      brief: gap.narrative,
      legacy_observation_type: 'category_variance',
    })
  }

  return evidences
}

// ── Holiday clusters → Evidence ───────────────────────────────────────────

// Reads transactions previously flagged as `is_holiday_spend = true` (via
// the holiday-detector cron job) and groups them into trip windows. Each
// cluster of ≥3 transactions within a 14-day span at distinct merchants
// becomes a candidate Evidence.
//
// Trip clusters are wow material because they aggregate a story the user
// often hasn't tallied themselves — e.g. "your December Lisbon trip cost
// €X across 18 transactions."
export async function holidayClustersToEvidences(
  supabase: SupabaseClient,
  userId: string,
  currency: string,
): Promise<Evidence[]> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const { data: rows, error } = await supabase
    .from('transactions')
    .select('id, date, description, amount, location_country, location_city')
    .eq('user_id', userId)
    .eq('is_holiday_spend', true)
    .is('deleted_at', null)
    .gte('date', since)
    .order('date', { ascending: true })
    .limit(500)
  if (error || !rows || rows.length < 3) return []

  // Cluster by 14-day windows of consecutive holiday-flagged transactions.
  type Tx = { id: string; ts: number; date: string; amount: number; description: string; country: string | null; city: string | null }
  const txs: Tx[] = rows
    .map((r) => ({
      id: r.id,
      ts: Date.parse(r.date),
      date: r.date.slice(0, 10),
      amount: Number(r.amount),
      description: r.description ?? '',
      country: r.location_country ?? null,
      city: r.location_city ?? null,
    }))
    .filter((t) => !Number.isNaN(t.ts))

  const clusters: Tx[][] = []
  let current: Tx[] = []
  const GAP_MS = 14 * 24 * 60 * 60 * 1000
  for (const tx of txs) {
    if (current.length === 0 || tx.ts - current[current.length - 1].ts <= GAP_MS) {
      current.push(tx)
    } else {
      if (current.length >= 3) clusters.push(current)
      current = [tx]
    }
  }
  if (current.length >= 3) clusters.push(current)
  if (clusters.length === 0) return []

  const symbol = currencySymbol(currency)
  const out: Evidence[] = []

  for (const cluster of clusters) {
    const total = Math.round(cluster.reduce((s, t) => s + Math.abs(t.amount), 0) * 100) / 100
    if (total < 100) continue

    // Pick destination as the most-common country or city.
    const countries = new Map<string, number>()
    for (const t of cluster) {
      if (t.country) countries.set(t.country, (countries.get(t.country) ?? 0) + 1)
    }
    const destination = [...countries.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    const startIso = cluster[0].date
    const endIso = cluster[cluster.length - 1].date
    const spanDays = Math.max(1, Math.round((cluster[cluster.length - 1].ts - cluster[0].ts) / (24 * 60 * 60 * 1000)))

    const claims: VerifiableClaim[] = [
      {
        kind: 'amount',
        value: total,
        alt_forms: amountForms(total, symbol),
        source_tx_ids: cluster.map((c) => c.id),
      },
      {
        kind: 'count',
        value: cluster.length,
        alt_forms: [String(cluster.length)],
        source_tx_ids: cluster.map((c) => c.id),
      },
      {
        kind: 'duration',
        value: spanDays,
        alt_forms: [String(spanDays), `${spanDays} days`],
        source_tx_ids: cluster.map((c) => c.id),
      },
    ]
    if (destination) {
      claims.push({
        kind: 'merchant',
        value: titleCase(destination),
        alt_forms: [destination, destination.toLowerCase(), destination.toUpperCase()],
      })
    }

    const destinationLabel = destination ? ` to ${titleCase(destination)}` : ''
    out.push({
      source: 'holiday_cluster',
      evidence_id: `holiday_cluster:${startIso}:${destination ?? 'unknown'}`,
      headline: `${cluster.length} transactions across ${spanDays} days${destinationLabel} totalling ${symbol}${total} — a trip the user might not have tallied.`,
      wow_score: 0.7,
      verifiable_claims: claims,
      context_facts: {
        start_date: startIso,
        end_date: endIso,
        ...(destination ? { destination: titleCase(destination) } : {}),
      },
      brief: `A ${spanDays}-day cluster of ${cluster.length} transactions${destinationLabel} totalling ${symbol}${total}. Trips have a way of disappearing into "that holiday in summer" — naming the number reframes the memory.`,
      legacy_observation_type: 'time_pattern',
    })
  }

  // Return at most one trip evidence — the most expensive — to avoid
  // flooding the pool with overlapping holiday clusters.
  out.sort((a, b) => b.wow_score - a.wow_score || (
    (Number(b.verifiable_claims.find((c) => c.kind === 'amount')?.value ?? 0)) -
    (Number(a.verifiable_claims.find((c) => c.kind === 'amount')?.value ?? 0))
  ))
  return out.slice(0, 1)
}

// ── Recurring overlap → Evidence ──────────────────────────────────────────

// Reads `recurring_expenses` and surfaces categories where the user has ≥2
// active recurring rows — a strong "you might be paying twice for the same
// thing" signal. Streaming services in the same category, two gym
// memberships, two phone plans, etc.
export async function recurringOverlapToEvidences(
  supabase: SupabaseClient,
  userId: string,
  currency: string,
): Promise<Evidence[]> {
  const { data: rows, error } = await supabase
    .from('recurring_expenses')
    .select('name, category_id, amount, frequency, status')
    .eq('user_id', userId)
    .is('deleted_at', null)
  if (error || !rows || rows.length < 2) return []

  // Group by category_id (skip rows missing one).
  const byCategory = new Map<string, Array<{ name: string; amount: number; frequency: string }>>()
  for (const r of rows) {
    if (!r.category_id) continue
    if (r.status && r.status !== 'active') continue
    const arr = byCategory.get(r.category_id) ?? []
    arr.push({
      name: String(r.name ?? 'unknown'),
      amount: Number(r.amount ?? 0),
      frequency: String(r.frequency ?? 'monthly'),
    })
    byCategory.set(r.category_id, arr)
  }

  const symbol = currencySymbol(currency)

  for (const [categoryId, items] of byCategory) {
    if (items.length < 2) continue
    items.sort((a, b) => b.amount - a.amount)
    const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100
    const cheapest = items[items.length - 1]
    const cheapestAmount = Math.round(cheapest.amount * 100) / 100
    const claims: VerifiableClaim[] = [
      {
        kind: 'count',
        value: items.length,
        alt_forms: [String(items.length)],
      },
      {
        kind: 'amount',
        value: total,
        alt_forms: amountForms(total, symbol),
      },
      {
        kind: 'amount',
        value: cheapestAmount,
        alt_forms: amountForms(cheapestAmount, symbol),
      },
      {
        kind: 'merchant',
        value: cheapest.name,
        alt_forms: [cheapest.name.toLowerCase(), cheapest.name.toUpperCase()],
      },
    ]
    return [
      {
        source: 'recurring_overlap',
        evidence_id: `recurring_overlap:${categoryId}`,
        headline: `${items.length} recurring expenses in the same category — ${symbol}${total}/mo combined.`,
        wow_score: 0.75,
        verifiable_claims: claims,
        context_facts: {
          category_id: categoryId,
          cheapest_name: cheapest.name,
        },
        brief: `${items.length} recurring expenses in the same category come to ${symbol}${total} a month. The cheapest one — ${cheapest.name} at ${symbol}${cheapestAmount} — might be a duplicate of work the others already do.`,
        legacy_observation_type: 'category_variance',
      },
    ]
  }

  return []
}

// ── v2 detector pool wrapper ──────────────────────────────────────────────

export async function legacyDetectorEvidences(input: {
  transactions: TransactionRow[]
  archetype: string | null
  currency: string
  country: string | null
}): Promise<Evidence[]> {
  const out: Evidence[] = []
  await Promise.all(
    DETECTORS.map(async (det) => {
      try {
        const candidates = await det(input)
        for (const c of candidates) out.push(candidateToEvidence(c))
      } catch (err) {
        console.error('[evidence-adapter] legacy detector failed:', err)
      }
    }),
  )
  return out
}
