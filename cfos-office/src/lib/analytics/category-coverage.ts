// Category coverage — for each expected fixed-cost category, does ANY
// transaction in the window map to it? When a whole category is absent (no
// electricity, no rent line, …) the cost is almost always paid from another
// account, so the confirm screen names the absence and opens a line-by-line
// capture. This is the route by which multi-account costs (the structural
// blind spot of any single-statement import) get counted.
//
// Coverage is transaction-level and per line, so "No utilities in this
// statement" is literally true — it can only fire when nothing utility-shaped
// appears at all. Matching is precise: the benchmark subtype classifier first
// (handles the major providers), then a small word-boundary keyword list for
// the things it misses (water has no enum subtype; Digi-style ISPs). The
// shared 'utilities_bills' category_id is deliberately NOT a match signal — it
// can't tell electricity from gas, so using it would cross-contaminate the
// per-line capture.

import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { classifyBillSubtype } from './benchmark/classify-subtype'
import type { BillSubtype } from './benchmark/types'
import type { Cadence } from './reconcile-fixed-costs'

export type CoverageKey = BillSubtype | 'water' | 'housing' | 'insurance_any'
export type CoverageGroup = 'utilities' | 'housing' | 'insurance'

export type CoverageLine = {
  key: CoverageKey
  label: string
  group: CoverageGroup
  covered: boolean
  /** Cadence the capture line defaults to (utilities are often bi-monthly in ES). */
  defaultCadence: Cadence
  /** Illustrative amount only — never counted; the field is a placeholder. */
  placeholder: string
}

type CategorySpec = {
  key: CoverageKey
  label: string
  group: CoverageGroup
  /** Benchmark subtypes that count as covering this line (precise signal). */
  subtypes: BillSubtype[]
  /** Word-boundary keywords for providers the subtype classifier misses. */
  keywords: string[]
  defaultCadence: Cadence
  placeholder: string
}

// Data-driven and extensible. Keep keywords specific enough to survive
// word-boundary matching without false positives ('gas' alone would catch
// 'gasolina', so gas uses provider phrases instead).
export const FIXED_COST_CATEGORIES: CategorySpec[] = [
  {
    key: 'electricity',
    label: 'Electricity',
    group: 'utilities',
    subtypes: ['electricity'],
    keywords: ['electric', 'electricidad', 'luz', 'iberdrola', 'endesa', 'octopus energy', 'edf energy', 'eon next', 'ovo energy', 'bulb'],
    defaultCadence: 'bi-monthly',
    placeholder: '90',
  },
  {
    key: 'gas',
    label: 'Gas',
    group: 'utilities',
    subtypes: ['gas'],
    keywords: ['british gas', 'naturgy gas', 'gas natural', 'gas supply', 'centrica'],
    defaultCadence: 'bi-monthly',
    placeholder: '45',
  },
  {
    key: 'water',
    label: 'Water',
    group: 'utilities',
    subtypes: [], // no 'water' value in the bill_subtype enum — keyword-only
    keywords: ['water', 'agua', 'aguas', 'aigues', 'aqualia', 'canal de isabel', 'emasesa', 'hidralia'],
    defaultCadence: 'quarterly',
    placeholder: '60',
  },
  {
    key: 'broadband',
    label: 'Internet',
    group: 'utilities',
    subtypes: ['broadband'],
    keywords: ['broadband', 'fibre', 'fiber', 'fibra', 'wifi', 'digi', 'hyperoptic', 'jazztel', 'virgin media'],
    defaultCadence: 'monthly',
    placeholder: '40',
  },
  {
    key: 'mobile',
    label: 'Mobile / phone',
    group: 'utilities',
    subtypes: ['mobile'],
    keywords: ['mobile', 'movil', 'sim only', 'sim-only', 'giffgaff', 'lebara'],
    defaultCadence: 'monthly',
    placeholder: '15',
  },
  {
    key: 'insurance_any',
    label: 'Insurance',
    group: 'insurance',
    subtypes: ['home_insurance', 'auto_insurance'],
    keywords: ['insurance', 'seguro', 'seguros', 'mapfre', 'axa', 'mutua', 'linea directa'],
    defaultCadence: 'annual',
    placeholder: '45',
  },
  {
    key: 'housing',
    label: 'Rent / mortgage',
    group: 'housing',
    subtypes: [],
    keywords: ['rent', 'alquiler', 'hipoteca', 'mortgage', 'miete'],
    defaultCadence: 'monthly',
    placeholder: '1100',
  },
]

/** Word-boundary keyword match — 'digi' matches "digi" but not "digital ocean". */
function matchesKeyword(norm: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(norm)
}

/**
 * A line is COVERED when ≥1 transaction in the window maps to it (by benchmark
 * subtype or keyword), OR — for housing — monthly_rent is set. The check is
 * transaction-level so the absence claim ("No utilities in this statement") is
 * literally true: it fires only when nothing utility-shaped appears at all.
 */
export async function assessCategoryCoverage(
  supabase: SupabaseClient,
  userId: string,
): Promise<CoverageLine[]> {
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  const [txnsRes, profileRes] = await Promise.all([
    supabase
      .from('transactions')
      .select('description, category_id, date')
      .eq('user_id', userId)
      .gte('date', sixMonthsAgo.toISOString().slice(0, 10))
      .lt('amount', 0),
    supabase.from('user_profiles').select('monthly_rent').eq('id', userId).maybeSingle(),
  ])

  const txns = (txnsRes.data ?? []) as Array<{ description: string | null; category_id: string | null }>
  const monthlyRent =
    typeof profileRes.data?.monthly_rent === 'number' ? profileRes.data.monthly_rent : null

  // Precompute per-transaction signals once.
  const signals = txns.map((t) => ({
    norm: normaliseMerchant(t.description ?? ''),
    subtype: classifyBillSubtype(t.description ?? '').subtype,
  }))

  return FIXED_COST_CATEGORIES.map((spec) => {
    let covered = spec.key === 'housing' && monthlyRent != null && monthlyRent > 0
    if (!covered) {
      covered = signals.some(
        (s) =>
          (s.subtype != null && spec.subtypes.includes(s.subtype)) ||
          spec.keywords.some((kw) => matchesKeyword(s.norm, kw)),
      )
    }
    return {
      key: spec.key,
      label: spec.label,
      group: spec.group,
      covered,
      defaultCadence: spec.defaultCadence,
      placeholder: spec.placeholder,
    }
  })
}
