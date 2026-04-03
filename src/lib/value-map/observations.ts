import { QUADRANTS } from './constants'
import type { Observation, ValueMapResult, ValueMapTransaction, ValueQuadrant } from './types'

// ── Helpers ─────────────────────────────────────────────────────────────────

function quadrantName(q: ValueQuadrant): string {
  return QUADRANTS[q].name.toLowerCase()
}

function fmt(ms: number): string {
  return (ms / 1000).toFixed(1)
}

/** Filter to decided (non-null quadrant) results */
function decided(results: ValueMapResult[]): (ValueMapResult & { quadrant: ValueQuadrant })[] {
  return results.filter((r): r is ValueMapResult & { quadrant: ValueQuadrant } => r.quadrant !== null)
}

/** Count results per quadrant */
function quadrantCounts(results: (ValueMapResult & { quadrant: ValueQuadrant })[]): Record<ValueQuadrant, number> {
  const counts: Record<ValueQuadrant, number> = { foundation: 0, investment: 0, burden: 0, leak: 0 }
  for (const r of results) counts[r.quadrant]++
  return counts
}

// ── Rules ───────────────────────────────────────────────────────────────────

/** Rule 1 — Contradiction: same category, different quadrant */
function detectContradictions(
  results: (ValueMapResult & { quadrant: ValueQuadrant })[],
  txLookup: Map<string, ValueMapTransaction>,
): Observation[] {
  // Group by category
  const byCategory = new Map<string, (ValueMapResult & { quadrant: ValueQuadrant })[]>()
  for (const r of results) {
    const cat = txLookup.get(r.transaction_id)?.category_name
    if (!cat) continue
    const group = byCategory.get(cat) ?? []
    group.push(r)
    byCategory.set(cat, group)
  }

  const observations: Observation[] = []

  for (const [category, group] of byCategory) {
    const quadrants = new Set(group.map((r) => r.quadrant))
    if (quadrants.size < 2) continue

    // Find the most contrasting pair (prefer leak vs investment, burden vs foundation)
    const contrastPairs: [ValueQuadrant, ValueQuadrant][] = [
      ['leak', 'investment'],
      ['burden', 'foundation'],
      ['leak', 'foundation'],
      ['burden', 'investment'],
    ]

    for (const [qa, qb] of contrastPairs) {
      const a = group.find((r) => r.quadrant === qa)
      const b = group.find((r) => r.quadrant === qb)
      if (!a || !b) continue

      const interpretation = buildContradictionInterpretation(a, b, category)
      observations.push({
        rule: 'contradiction',
        priority: 1,
        text: `You called ${a.merchant} a ${quadrantName(qa)} but ${b.merchant} an ${quadrantName(qb)} — and they're both ${category}. ${interpretation}`,
        merchants: [a.merchant, b.merchant],
      })
      break // One contradiction per category
    }
  }

  return observations
}

function buildContradictionInterpretation(
  a: ValueMapResult & { quadrant: ValueQuadrant },
  b: ValueMapResult & { quadrant: ValueQuadrant },
  category: string,
): string {
  if (a.quadrant === 'leak' && b.quadrant === 'investment') {
    return `That tells me you value ${b.merchant} more than ${a.merchant} right now — or ${a.merchant} isn't delivering.`
  }
  if (a.quadrant === 'burden' && b.quadrant === 'foundation') {
    return `One feels necessary and fine, the other feels like a weight — worth asking why.`
  }
  if (a.quadrant === 'leak' && b.quadrant === 'foundation') {
    return `One serves you, the other doesn't — even though they're both ${category}.`
  }
  return `Same category, very different feelings — that gap is worth exploring.`
}

/** Rule 2 — Hesitation spike: first_tap_ms > 2x personal average */
function detectHesitationSpike(
  results: (ValueMapResult & { quadrant: ValueQuadrant })[],
): Observation[] {
  const timed = results.filter((r) => r.first_tap_ms !== null && r.first_tap_ms > 0)
  if (timed.length < 3) return []

  const avg = timed.reduce((sum, r) => sum + r.first_tap_ms!, 0) / timed.length
  const threshold = avg * 2

  const spikes = timed
    .filter((r) => r.first_tap_ms! > threshold)
    .sort((a, b) => b.first_tap_ms! - a.first_tap_ms!)

  if (spikes.length === 0) return []

  const r = spikes[0]
  const seconds = fmt(r.first_tap_ms!)

  const interpretations: Record<ValueQuadrant, string> = {
    leak: "you know this one isn't serving you, but admitting it took a moment.",
    foundation: "you're not fully convinced this cost is justified.",
    burden: 'the weight of this one is real.',
    investment: "you believe in it, but something made you pause.",
  }

  return [{
    rule: 'hesitation_spike',
    priority: 2,
    text: `You took ${seconds}s on ${r.merchant}. That hesitation tells me something — ${interpretations[r.quadrant]}`,
    merchants: [r.merchant],
  }]
}

/** Rule 3 — Confidence outlier: confidence 5 when average < 4 */
function detectConfidenceOutlier(
  results: (ValueMapResult & { quadrant: ValueQuadrant })[],
): Observation[] {
  const withConfidence = results.filter((r) => r.confidence > 0)
  if (withConfidence.length < 3) return []

  const avg = withConfidence.reduce((sum, r) => sum + r.confidence, 0) / withConfidence.length
  if (avg >= 4) return []

  const outliers = withConfidence.filter((r) => r.confidence === 5)
  if (outliers.length === 0) return []

  const r = outliers[0]
  return [{
    rule: 'confidence_outlier',
    priority: 3,
    text: `You were completely certain that ${r.merchant} is ${quadrantName(r.quadrant)}. That's your clearest financial value — everything else is negotiable, but this isn't.`,
    merchants: [r.merchant],
  }]
}

/** Rule 4 — Burden + Leak dominance: exceed 50% of answers */
function detectBurdenLeakDominance(
  results: (ValueMapResult & { quadrant: ValueQuadrant })[],
): Observation[] {
  const counts = quadrantCounts(results)
  const total = results.length
  if (total === 0) return []

  const burdenLeakPct = ((counts.burden + counts.leak) / total) * 100
  if (burdenLeakPct <= 50) return []

  return [{
    rule: 'burden_leak_dominance',
    priority: 4,
    text: "More than half your spending feels like it's either weighing you down or slipping away. That awareness is exactly what we need to work with.",
    merchants: [],
  }]
}

/** Rule 5 — Foundation-heavy: foundation exceeds 45% */
function detectFoundationHeavy(
  results: (ValueMapResult & { quadrant: ValueQuadrant })[],
): Observation[] {
  const counts = quadrantCounts(results)
  const total = results.length
  if (total === 0) return []

  const foundationPct = (counts.foundation / total) * 100
  if (foundationPct <= 45) return []

  return [{
    rule: 'foundation_heavy',
    priority: 5,
    text: "You see most spending as just part of life — necessary and fine. That's practical, but it might mean you're accepting costs you could reduce.",
    merchants: [],
  }]
}

/** Rule 6 — Speed pattern: 3 fastest cards share the same quadrant */
function detectSpeedPattern(
  results: (ValueMapResult & { quadrant: ValueQuadrant })[],
): Observation[] {
  const timed = results.filter((r) => r.first_tap_ms !== null && r.first_tap_ms > 0)
  if (timed.length < 5) return []

  const sorted = [...timed].sort((a, b) => a.first_tap_ms! - b.first_tap_ms!)
  const fastest3 = sorted.slice(0, 3)

  const allSameQuadrant = fastest3.every((r) => r.quadrant === fastest3[0].quadrant)
  if (!allSameQuadrant) return []

  const q = fastest3[0].quadrant
  const maxMs = Math.max(...fastest3.map((r) => r.first_tap_ms!))
  const merchants = fastest3.map((r) => r.merchant)

  return [{
    rule: 'speed_pattern',
    priority: 6,
    text: `Your instincts are clearest on ${quadrantName(q)} spending — you tagged ${merchants[0]}, ${merchants[1]}, and ${merchants[2]} in under ${fmt(maxMs)}s each. No hesitation.`,
    merchants,
  }]
}

/** Rule 7 — The one exception: dominant quadrant >40% with exactly 1 contrasting */
function detectOneException(
  results: (ValueMapResult & { quadrant: ValueQuadrant })[],
): Observation[] {
  const counts = quadrantCounts(results)
  const total = results.length
  if (total === 0) return []

  // Find dominant quadrant (>40%)
  let dominant: ValueQuadrant | null = null
  for (const q of ['foundation', 'investment', 'burden', 'leak'] as ValueQuadrant[]) {
    if ((counts[q] / total) * 100 > 40) {
      dominant = q
      break
    }
  }
  if (!dominant) return []

  // Contrasting quadrants (opposite corner of the grid)
  const contrasting: Record<ValueQuadrant, ValueQuadrant[]> = {
    foundation: ['leak', 'burden'],
    investment: ['leak', 'burden'],
    burden: ['foundation', 'investment'],
    leak: ['foundation', 'investment'],
  }

  for (const cq of contrasting[dominant]) {
    const exceptions = results.filter((r) => r.quadrant === cq)
    if (exceptions.length === 1) {
      const ex = exceptions[0]
      return [{
        rule: 'one_exception',
        priority: 7,
        text: `Almost everything landed in ${quadrantName(dominant)} — except ${ex.merchant}, which you called ${quadrantName(cq)}. That exception is worth paying attention to.`,
        merchants: [ex.merchant],
      }]
    }
  }

  return []
}

// ── Main ────────────────────────────────────────────────────────────────────

const MAX_OBSERVATIONS = 3

export function generateObservations(
  results: ValueMapResult[],
  transactions: ValueMapTransaction[],
): Observation[] {
  const dec = decided(results)
  if (dec.length < 3) return []

  // Build transaction lookup for category_name
  const txLookup = new Map<string, ValueMapTransaction>()
  for (const tx of transactions) txLookup.set(tx.id, tx)

  // Run all rules
  const all: Observation[] = [
    ...detectContradictions(dec, txLookup),
    ...detectHesitationSpike(dec),
    ...detectConfidenceOutlier(dec),
    ...detectBurdenLeakDominance(dec),
    ...detectFoundationHeavy(dec),
    ...detectSpeedPattern(dec),
    ...detectOneException(dec),
  ]

  // Sort by priority (lowest number = highest priority), return top N
  all.sort((a, b) => a.priority - b.priority)
  return all.slice(0, MAX_OBSERVATIONS)
}
