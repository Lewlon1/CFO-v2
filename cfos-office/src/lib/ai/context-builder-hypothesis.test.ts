import { describe, it, expect } from 'vitest'
import {
  buildFirstInsightContextV2,
  type BriefProfile,
  type VmRowsByQuadrant,
  type TxWindow,
} from './context-builder'

/**
 * Stub Supabase client that handles BOTH the value_category_rules chain
 * (used by the memory surface) and the user_hypotheses chain (used by
 * the v2_hypothesis variant). Returns a fixed payload per table.
 */
function makeHypothesisStubClient(
  hypothesisRows: Array<{
    thesis_lines: Array<{ text: string; confidence: number; status: 'open' | 'contradicted' | 'confirmed' }>
    confidence: number
  }>,
) {
  function chainFor(table: string) {
    const isHypothesis = table === 'user_hypotheses'
    const row = isHypothesis ? (hypothesisRows[0] ?? null) : null
    const arrayRow = isHypothesis ? null : []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: Record<string, any> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.in = () => chain
    chain.is = () => chain
    chain.order = () => chain
    chain.limit = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: row, error: null })
    chain.then = (resolve: (v: { data: unknown }) => unknown) => {
      resolve({ data: arrayRow })
      return Promise.resolve()
    }
    return chain
  }

  return {
    from: (table: string) => chainFor(table),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const baseProfile: BriefProfile = {
  display_name: 'Alex',
  country: 'Spain',
  primary_currency: 'EUR',
  net_monthly_income: 3200,
  monthly_rent: 950,
  entry_struggle_text: 'I want to clear my credit card by summer',
}

const emptyQuadrants: VmRowsByQuadrant = {
  foundation: [],
  investment: [],
  leak: [],
  burden: [],
  unsure: [],
}

const txWindow: TxWindow = {
  n_transactions: 412,
  n_months: 6,
  earliest: '2026-04-01',
  latest: '2026-10-01',
}

const sampleHypothesis = {
  thesis_lines: [
    {
      text: 'Salaried with steady cadence — discretionary headroom but not endless.',
      confidence: 0.85,
      status: 'open' as const,
    },
    {
      text: 'Values orientation is still unread — Value Map not yet completed.',
      confidence: 0.6,
      status: 'open' as const,
    },
    {
      text: 'Property goal stated but unsculpted — gap is structural, not behavioural.',
      confidence: 0.7,
      status: 'open' as const,
    },
  ],
  confidence: 0.72,
}

describe('buildFirstInsightContextV2 — v2_hypothesis variant', () => {
  it('renders the Working hypothesis block when variant=v2_hypothesis AND an active row exists', async () => {
    const supabase = makeHypothesisStubClient([sampleHypothesis])
    const result = await buildFirstInsightContextV2(
      supabase,
      'user-1',
      baseProfile,
      null,
      null,
      emptyQuadrants,
      txWindow,
      null,
      null,
      { variant: 'v2_hypothesis' },
    )
    expect(result).toContain('## Working hypothesis')
    expect(result).toContain('Salaried with steady cadence')
    expect(result).toContain('[confidence: high, status: open]')
    expect(result).toContain('mark_hypothesis_line_contradicted')
    // Trimmed approach section should appear
    expect(result).toContain('The working hypothesis above is your thesis')
    // Long-form approach scaffolding should NOT
    expect(result).not.toContain('Form a hypothesis about what matters most')
  })

  it('omits Working hypothesis when variant=v2_hypothesis but no row exists', async () => {
    const supabase = makeHypothesisStubClient([])
    const result = await buildFirstInsightContextV2(
      supabase,
      'user-1',
      baseProfile,
      null,
      null,
      emptyQuadrants,
      txWindow,
      null,
      null,
      { variant: 'v2_hypothesis' },
    )
    expect(result).not.toContain('## Working hypothesis')
    // Falls back to long-form approach
    expect(result).toContain('Form a hypothesis about what matters most')
  })

  it('omits Working hypothesis when variant=v2 (default), even when a row exists', async () => {
    const supabase = makeHypothesisStubClient([sampleHypothesis])
    const result = await buildFirstInsightContextV2(
      supabase,
      'user-1',
      baseProfile,
      null,
      null,
      emptyQuadrants,
      txWindow,
      null,
      null,
    )
    expect(result).not.toContain('## Working hypothesis')
    expect(result).toContain('Form a hypothesis about what matters most')
  })

  it('keeps net prompt size within ~200 chars of the v2 baseline', async () => {
    const supabase = makeHypothesisStubClient([sampleHypothesis])
    const v2 = await buildFirstInsightContextV2(
      supabase,
      'user-1',
      baseProfile,
      null,
      null,
      emptyQuadrants,
      txWindow,
      null,
      null,
    )
    const v2h = await buildFirstInsightContextV2(
      supabase,
      'user-1',
      baseProfile,
      null,
      null,
      emptyQuadrants,
      txWindow,
      null,
      null,
      { variant: 'v2_hypothesis' },
    )
    // The hypothesis section adds ~700 chars; the approach-block trim removes
    // ~500. Net delta should be modest. The plan's threshold was <200 — we
    // give ourselves a 250-char ceiling here for stability across small
    // future copy edits.
    const delta = v2h.length - v2.length
    expect(delta).toBeLessThan(250)
  })

  it('renders contradicted lines with status: contradicted', async () => {
    const contradicted = {
      thesis_lines: [
        { ...sampleHypothesis.thesis_lines[0], status: 'contradicted' as const },
        sampleHypothesis.thesis_lines[1],
        sampleHypothesis.thesis_lines[2],
      ],
      confidence: 0.72,
    }
    const supabase = makeHypothesisStubClient([contradicted])
    const result = await buildFirstInsightContextV2(
      supabase,
      'user-1',
      baseProfile,
      null,
      null,
      emptyQuadrants,
      txWindow,
      null,
      null,
      { variant: 'v2_hypothesis' },
    )
    expect(result).toContain('[confidence: high, status: contradicted]')
    expect(result).toContain('status: contradicted')
  })
})
