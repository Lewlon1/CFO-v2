import { describe, it, expect, vi } from 'vitest'
import {
  buildFirstInsightContextV2,
  bucketVmRowsByQuadrant,
  type BriefProfile,
  type VmRowsByQuadrant,
  type TxWindow,
} from './context-builder'

/**
 * Stub Supabase client returning a fixed value_category_rules result. Only
 * implements the chain the v2 builder actually calls:
 *   .from('value_category_rules').select(...).eq(...).in(...).order(...).limit(...)
 *
 * Calling `withRows([...])` returns a stub that resolves the terminal
 * `.limit()` to `{ data, error: null }`. Calling `withError()` returns a stub
 * whose terminal call throws — exercises the catch path inside the builder.
 */
function makeStubClient(behavior: 'rows' | 'empty' | 'error', rows: unknown[] = []) {
  const terminal = {
    then(resolve: (v: { data: unknown[] | null }) => unknown) {
      if (behavior === 'error') {
        throw new Error('stub error')
      }
      resolve({ data: behavior === 'empty' ? [] : rows })
      return Promise.resolve()
    },
  }
  const chain: Record<string, (...args: unknown[]) => unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => terminal,
  }
  return {
    from: () => chain,
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

describe('buildFirstInsightContextV2', () => {
  it('renders all 8 sections with empty memory + no value map', async () => {
    const supabase = makeStubClient('empty')
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
    expect(result).toContain('## The user')
    expect(result).toContain('## Value Map (their stated values)')
    expect(result).toContain('## Data available')
    expect(result).toContain("## What you've learned so far (memory)")
    expect(result).toContain('## How to approach the first message')
    expect(result).toContain('## Voice rules')
    expect(result).toContain('## How to write chips')
    expect(result).toContain('## How to surface learning')
  })

  it('renders "No corrections or labels yet" when memory is empty', async () => {
    const supabase = makeStubClient('empty')
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
    expect(result).toContain(
      'No corrections or labels yet — this is your first real conversation with this user.',
    )
  })

  it('renders learned labels with confirmations + last signal date', async () => {
    const supabase = makeStubClient('rows', [
      {
        match_value: 'Pret A Manger',
        value_category: 'foundation',
        confidence: 1.0,
        last_signal_at: '2026-05-12T08:30:00Z',
        total_signals: 18,
      },
      {
        match_value: 'Glovo',
        value_category: 'leak',
        confidence: 0.9,
        last_signal_at: '2026-05-10T19:00:00Z',
        total_signals: 7,
      },
    ])
    const result = await buildFirstInsightContextV2(
      supabase,
      'user-1',
      baseProfile,
      'The Drifter',
      '2026-05-01T10:00:00Z',
      emptyQuadrants,
      txWindow,
      null,
      null,
    )
    expect(result).toContain('Pret A Manger: foundation (18 confirmations, last: 2026-05-12)')
    expect(result).toContain('Glovo: leak (7 confirmations, last: 2026-05-10)')
  })

  it('renders up to 30 learned labels (queries are .limit(30); function does not re-cap)', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      match_value: `Merchant${i + 1}`,
      value_category: 'foundation',
      confidence: 1.0,
      last_signal_at: '2026-05-01',
      total_signals: 30 - i,
    }))
    const supabase = makeStubClient('rows', rows)
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
    expect(result).toContain('Merchant1: foundation (30 confirmations')
    expect(result).toContain('Merchant30: foundation (1 confirmations')
  })

  it('renders unsure quadrant entries when present', async () => {
    const supabase = makeStubClient('empty')
    const quadrants: VmRowsByQuadrant = {
      foundation: ['Monthly rent / mortgage payment'],
      investment: ['Gym membership'],
      leak: ['Takeaway delivery on a quiet evening'],
      burden: [],
      unsure: ['New clothes or shoes', 'Online course or book'],
    }
    const result = await buildFirstInsightContextV2(
      supabase,
      'user-1',
      baseProfile,
      'The Builder',
      '2026-05-01T10:00:00Z',
      quadrants,
      txWindow,
      null,
      null,
    )
    expect(result).toContain('Unsure: New clothes or shoes, Online course or book')
    expect(result).toContain('Foundation: Monthly rent / mortgage payment')
    expect(result).toContain('Burden: (none)')
  })

  it('renders archetype as "not yet taken" when null', async () => {
    const supabase = makeStubClient('empty')
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
    expect(result).toContain('Archetype: not yet taken')
    expect(result).toContain('Baseline taken: not yet taken')
  })

  it('renders the primary goal title when provided', async () => {
    const supabase = makeStubClient('empty')
    const result = await buildFirstInsightContextV2(
      supabase,
      'user-1',
      baseProfile,
      null,
      null,
      emptyQuadrants,
      txWindow,
      { title: 'Clear the card by August' },
      null,
    )
    expect(result).toContain('Goal: "Clear the card by August"')
  })

  it('renders "not yet shared" placeholders when profile fields are null', async () => {
    const supabase = makeStubClient('empty')
    const result = await buildFirstInsightContextV2(
      supabase,
      'user-1',
      {
        display_name: null,
        country: null,
        primary_currency: null,
        net_monthly_income: null,
        monthly_rent: null,
        entry_struggle_text: null,
      },
      null,
      null,
      emptyQuadrants,
      txWindow,
      null,
      null,
    )
    expect(result).toContain('Name: not yet shared')
    expect(result).toContain('Goal: "not yet shared"')
    expect(result).toContain('Struggle: "not yet shared"')
    expect(result).toContain('Income: not yet shared')
    expect(result).toContain('Fixed costs: not yet shared')
  })

  it('does not blow up when the memory query throws — falls through to empty branch', async () => {
    const supabase = makeStubClient('error')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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
    expect(result).toContain(
      'No corrections or labels yet — this is your first real conversation with this user.',
    )
    errSpy.mockRestore()
  })

  it('renders the data window with transaction count + month span + date range', async () => {
    const supabase = makeStubClient('empty')
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
    expect(result).toContain('412 transactions across 6 months.')
    expect(result).toContain('Range: 2026-04-01 to 2026-10-01.')
  })
})

describe('bucketVmRowsByQuadrant', () => {
  it('maps sample-card transaction ids to their friendly descriptions', () => {
    const out = bucketVmRowsByQuadrant([
      { transaction_id: 'vm-rent', merchant: null, quadrant: 'foundation' },
      { transaction_id: 'vm-gym', merchant: null, quadrant: 'investment' },
      { transaction_id: 'vm-takeaway', merchant: null, quadrant: 'leak' },
    ])
    expect(out.foundation).toContain('Monthly rent / mortgage payment')
    expect(out.investment).toContain('Gym membership')
    expect(out.leak).toContain('Takeaway delivery on a quiet evening')
  })

  it('falls back to merchant name for non-sample transactions (real-data Value Map)', () => {
    const out = bucketVmRowsByQuadrant([
      { transaction_id: 'real-uuid-1', merchant: 'Starbucks', quadrant: 'foundation' },
    ])
    expect(out.foundation).toContain('Starbucks')
  })

  it('routes null/unrecognised quadrants to the unsure bucket', () => {
    const out = bucketVmRowsByQuadrant([
      { transaction_id: 'vm-gift', merchant: null, quadrant: null },
      { transaction_id: 'vm-clothes', merchant: null, quadrant: 'unsure' },
      { transaction_id: 'vm-streaming', merchant: null, quadrant: 'mystery' },
    ])
    expect(out.unsure).toContain('Birthday gift for someone close')
    expect(out.unsure).toContain('New clothes or shoes')
    expect(out.unsure).toContain('Streaming service subscription')
  })

  it('skips rows with no usable friendly label', () => {
    const out = bucketVmRowsByQuadrant([
      { transaction_id: 'unknown-uuid', merchant: null, quadrant: 'foundation' },
    ])
    expect(out.foundation).toEqual([])
  })
})
