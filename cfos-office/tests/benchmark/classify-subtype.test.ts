import { describe, it, expect } from 'vitest'

import { classifyBillSubtype } from '@/lib/analytics/benchmark/classify-subtype'

describe('classifyBillSubtype — high-confidence matches', () => {
  it.each([
    ['BT Broadband', 'broadband'],
    ['Virgin Media Fibre', 'broadband'],
    ['Movistar Fibra 600mb', 'broadband'],
    ['Mobile bill - SIM only plan', 'mobile'],
    ['Iberdrola luz', 'electricity'],
    ['Octopus Energy', 'electricity'],
    ['British Gas', 'gas'],
    ['Naturgy gas', 'gas'],
    ['Aviva Home Insurance', 'home_insurance'],
    ['Seguro de hogar Mapfre', 'home_insurance'],
    ['Direct Line Car Insurance', 'auto_insurance'],
    ['Seguro coche Allianz', 'auto_insurance'],
    ['Netflix', 'streaming_subscription'],
    ['Spotify Premium', 'streaming_subscription'],
    ['Disney+', 'streaming_subscription'],
    ['Movistar Plus', 'streaming_subscription'],
  ])('classifies "%s" as %s with high confidence', (label, expected) => {
    const result = classifyBillSubtype(label)
    expect(result.subtype).toBe(expected)
    expect(result.confidence).toBe('high')
  })

  it('strips accents before matching (Spanish merchants with diacritics)', () => {
    const result = classifyBillSubtype('Eléctrico Endesa')
    expect(result.subtype).toBe('electricity')
    expect(result.confidence).toBe('high')
  })
})

describe('classifyBillSubtype — low-confidence guesses (ambiguous telco brands)', () => {
  it.each([
    ['Vodafone España', 'broadband'],
    ['Orange', 'broadband'],
    ['EE Mobile', 'mobile'],
    ['Three UK', 'mobile'],
    ['Yoigo', 'mobile'],
  ])('classifies "%s" as %s with low confidence', (label, expected) => {
    const result = classifyBillSubtype(label)
    expect(result.subtype).toBe(expected)
    expect(result.confidence).toBe('low')
  })
})

describe('classifyBillSubtype — no-match (silence is the safe default)', () => {
  it.each([
    'Mercadona',
    'Glovo',
    'Uber',
    'Pret a Manger',
    'Random Merchant Co',
    '',
    null,
    undefined,
  ])('returns null subtype for "%s"', (label) => {
    const result = classifyBillSubtype(label as string | null | undefined)
    expect(result.subtype).toBeNull()
    expect(result.confidence).toBe('low')
  })
})

describe('classifyBillSubtype — high-confidence wins over ambiguous brand', () => {
  it('prefers the unambiguous token when both a brand and a clear subtype keyword appear', () => {
    // "Vodafone" is ambiguous (low-conf broadband guess) but "fibre" is
    // unambiguous — the classifier should commit to broadband at high
    // confidence rather than fall back to the low-confidence brand match.
    const result = classifyBillSubtype('Vodafone Fibre 100mb')
    expect(result.subtype).toBe('broadband')
    expect(result.confidence).toBe('high')
  })
})
