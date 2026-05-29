import { describe, it, expect } from 'vitest'
import { classifyCommitment } from '../fixed-cost-classify'

// A "commitment" is income-minus-this-keeps-meaning-free-cash-flow. The split
// decides what counts toward total_fixed_costs. The bias is deliberately
// conservative: anything we aren't sure is discretionary is treated as
// committed, because under-counting fixed costs overstates free cash flow —
// the exact failure mode this session exists to close.
describe('classifyCommitment', () => {
  it('treats a row with a benchmarkable bill subtype as committed', () => {
    expect(classifyCommitment({ bill_subtype: 'electricity' })).toBe('committed')
    expect(classifyCommitment({ bill_subtype: 'broadband' })).toBe('committed')
  })

  it('treats discretionary categories with no subtype as variable', () => {
    expect(classifyCommitment({ category_id: 'groceries' })).toBe('variable')
    expect(classifyCommitment({ category_id: 'eat_drinking_out' })).toBe('variable')
    expect(classifyCommitment({ category_id: 'shopping' })).toBe('variable')
  })

  it('keeps non-discretionary categories committed (transport pass, padel, subscription, gym-as-entertainment)', () => {
    // These are the categories the candidate pass must still surface — a metro
    // pass (transport), Playtomic (entertainment), Claude.ai (subscriptions).
    expect(classifyCommitment({ category_id: 'transport' })).toBe('committed')
    expect(classifyCommitment({ category_id: 'entertainment' })).toBe('committed')
    expect(classifyCommitment({ category_id: 'subscriptions' })).toBe('committed')
    expect(classifyCommitment({ category_id: 'utilities_bills' })).toBe('committed')
    expect(classifyCommitment({ category_id: 'health' })).toBe('committed')
  })

  it('lets a benchmarkable subtype override a discretionary category (subtype wins)', () => {
    // Defensive: if a row is somehow tagged groceries but carries a gas
    // subtype, the subtype is the stronger signal — count it.
    expect(
      classifyCommitment({ category_id: 'groceries', bill_subtype: 'gas' }),
    ).toBe('committed')
  })

  it('defaults unknown / null / missing categories to committed', () => {
    expect(classifyCommitment({ category_id: 'uncategorised' })).toBe('committed')
    expect(classifyCommitment({ category_id: null })).toBe('committed')
    expect(classifyCommitment({})).toBe('committed')
  })
})
