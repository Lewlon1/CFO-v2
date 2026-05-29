// Pure keyword classifier mapping a bill label to one of the supported
// `bill_subtype` enum values. Designed to be conservative: when the label
// is ambiguous (e.g. "Vodafone" could be broadband or mobile), returns the
// best guess with `confidence: 'low'`; when nothing matches, returns
// `subtype: null`.
//
// The flagger treats `null` and low-confidence outputs the same way at the
// safety layer (silence beats a wrong observation). Confidence is exposed so
// the confirm UI can later surface a correction affordance for low-confidence
// rows — that surface is not yet built; the column on
// `user_declared_fixed_costs.bill_subtype` exists so it can be added without
// a follow-on migration.

import type { BillSubtype } from './types'

export type ClassifyResult = {
  subtype: BillSubtype | null
  confidence: 'high' | 'low'
}

const HIGH_CONFIDENCE_KEYWORDS: Record<BillSubtype, string[]> = {
  broadband: ['broadband', 'fibre', 'fiber', 'wifi', 'wi-fi', 'fibra'],
  mobile: ['mobile bill', 'mobile plan', 'movil', 'sim only', 'sim-only', 'sim only plan'],
  electricity: [
    'electric',
    'electricity',
    'electrico',
    'electricidad',
    'luz',
    'iberdrola',
    'endesa',
    'naturgy luz',
    'octopus energy',
    'british gas electricity',
    'edf energy',
    'eon next',
    'ovo energy',
    'bulb',
  ],
  gas: ['british gas', 'naturgy gas', 'gas bill', 'gas natural', 'gas supply', 'centrica'],
  home_insurance: [
    'home insurance',
    'contents insurance',
    'buildings insurance',
    'house insurance',
    'seguro hogar',
    'seguro de hogar',
  ],
  auto_insurance: [
    'car insurance',
    'motor insurance',
    'auto insurance',
    'vehicle insurance',
    'seguro coche',
    'seguro de coche',
    'seguro auto',
    'seguro de auto',
  ],
  streaming_subscription: [
    'netflix',
    'spotify',
    'disney+',
    'disney plus',
    'disneyplus',
    'apple music',
    'apple tv',
    'amazon prime video',
    'prime video',
    'youtube premium',
    'hbo max',
    'max streaming',
    'hbo',
    'paramount+',
    'paramount plus',
    'movistar plus',
    'dazn',
    'now tv',
    'sky stream',
  ],
}

// Ambiguous tokens — present a best guess at low confidence so the UI can
// optionally surface a correction control later. Order in the array does NOT
// imply ranking; we pick the first match and tag confidence low.
const LOW_CONFIDENCE_KEYWORDS: Array<{ token: string; bestGuess: BillSubtype }> = [
  // Telco brands that sell both broadband and mobile in GB / ES.
  { token: 'vodafone', bestGuess: 'broadband' },
  { token: 'movistar', bestGuess: 'broadband' },
  { token: 'orange', bestGuess: 'broadband' },
  { token: 'o2', bestGuess: 'mobile' },
  { token: 'ee', bestGuess: 'mobile' },
  { token: 'three', bestGuess: 'mobile' },
  { token: 'yoigo', bestGuess: 'mobile' },
  { token: 'masmovil', bestGuess: 'broadband' },
  // Generic insurance / utility tokens — useful as a fallback but not specific
  // to a subtype.
  { token: 'insurance', bestGuess: 'home_insurance' },
  { token: 'seguro', bestGuess: 'home_insurance' },
  { token: 'energy', bestGuess: 'electricity' },
  { token: 'energia', bestGuess: 'electricity' },
]

/**
 * Strip accents and lowercase. We intentionally do NOT strip punctuation
 * (so "disney+" still matches the keyword "disney+").
 */
function normalise(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
}

/**
 * Map a bill label to a `bill_subtype`. Returns null when nothing matches —
 * the caller (reconcile / flagger) treats null as "not benchmark-eligible".
 *
 * Pure function. No side effects. Stable for unit tests.
 */
export function classifyBillSubtype(label: string | null | undefined): ClassifyResult {
  if (!label) return { subtype: null, confidence: 'low' }

  const normalised = normalise(label)

  // High-confidence first: an unambiguous token wins over any low-confidence
  // brand match. Order of iteration over Object.entries is insertion order in
  // every supported runtime (Node 10+), which matches the BillSubtype literal
  // order in types.ts.
  for (const [subtype, keywords] of Object.entries(HIGH_CONFIDENCE_KEYWORDS) as Array<
    [BillSubtype, string[]]
  >) {
    for (const keyword of keywords) {
      if (normalised.includes(normalise(keyword))) {
        return { subtype, confidence: 'high' }
      }
    }
  }

  for (const { token, bestGuess } of LOW_CONFIDENCE_KEYWORDS) {
    if (normalised.includes(normalise(token))) {
      return { subtype: bestGuess, confidence: 'low' }
    }
  }

  return { subtype: null, confidence: 'low' }
}
