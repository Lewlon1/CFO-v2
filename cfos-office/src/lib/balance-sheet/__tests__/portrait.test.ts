import { describe, expect, it } from 'vitest'
import { computeTraits } from '../portrait'

type Trait = { trait_key: string; trait_value: string }
const get = (rows: Trait[], key: string) =>
  rows.find((r) => r.trait_key === key)?.trait_value

describe('computeTraits — has_property', () => {
  it('returns yes when a property asset exists', () => {
    const rows = computeTraits([{ asset_type: 'property', current_value: 200_000 }], [])
    expect(get(rows, 'has_property')).toBe('yes')
  })

  it('returns yes when a mortgage liability exists even without a paired asset', () => {
    const rows = computeTraits(
      [],
      [{ liability_type: 'mortgage', name: 'Mortgage A', outstanding_balance: 150_000 }],
    )
    expect(get(rows, 'has_property')).toBe('yes')
  })

  it('returns no when neither property nor mortgage exists', () => {
    const rows = computeTraits([{ asset_type: 'savings', current_value: 1000 }], [])
    expect(get(rows, 'has_property')).toBe('no')
  })
})

describe('computeTraits — has_high_interest_debt', () => {
  it('flags an explicit rate at or above 15% APR with name + rate', () => {
    const rows = computeTraits(
      [],
      [{ liability_type: 'credit_card', name: 'Barclaycard', interest_rate: 22, outstanding_balance: 4000 }],
    )
    expect(get(rows, 'has_high_interest_debt')).toBe('Barclaycard at 22% APR')
  })

  it('flags a credit card with a null rate as high-interest by default', () => {
    const rows = computeTraits(
      [],
      [
        {
          liability_type: 'credit_card',
          name: 'HSBC Card',
          interest_rate: null,
          outstanding_balance: 15_000,
        },
      ],
    )
    expect(get(rows, 'has_high_interest_debt')).toBe(
      'HSBC Card (rate not declared — treated as high-interest)',
    )
  })

  it('flags overdraft and bnpl with null rates as high-interest', () => {
    const overdraftRows = computeTraits(
      [],
      [{ liability_type: 'overdraft', name: 'Lloyds OD', outstanding_balance: 500 }],
    )
    expect(get(overdraftRows, 'has_high_interest_debt')).toContain('Lloyds OD')

    const bnplRows = computeTraits(
      [],
      [{ liability_type: 'bnpl', name: 'Klarna', outstanding_balance: 200 }],
    )
    expect(get(bnplRows, 'has_high_interest_debt')).toContain('Klarna')
  })

  it('does NOT flag non-card debt with a null rate (mortgages, student loans, other)', () => {
    const rows = computeTraits(
      [],
      [
        {
          liability_type: 'other',
          name: 'Government loan',
          interest_rate: null,
          outstanding_balance: 165_000,
        },
        { liability_type: 'mortgage', name: 'Mortgage', outstanding_balance: 200_000 },
        { liability_type: 'student_loan', name: 'SL', outstanding_balance: 30_000 },
      ],
    )
    expect(get(rows, 'has_high_interest_debt')).toBe('no')
  })

  it('returns no for low-rate liabilities even when type is credit_card', () => {
    const rows = computeTraits(
      [],
      [
        {
          liability_type: 'credit_card',
          name: 'Promo Card',
          interest_rate: 4.9,
          outstanding_balance: 1000,
        },
      ],
    )
    expect(get(rows, 'has_high_interest_debt')).toBe('no')
  })

  it('picks the highest-rate qualifying liability when multiple qualify', () => {
    const rows = computeTraits(
      [],
      [
        { liability_type: 'credit_card', name: 'Mid', interest_rate: 18, outstanding_balance: 1000 },
        { liability_type: 'credit_card', name: 'Worst', interest_rate: 28, outstanding_balance: 2000 },
        { liability_type: 'credit_card', name: 'Low', interest_rate: 16, outstanding_balance: 500 },
      ],
    )
    expect(get(rows, 'has_high_interest_debt')).toBe('Worst at 28% APR')
  })
})

describe('computeTraits — net_worth_bracket', () => {
  it('returns unknown when no assets are declared regardless of liabilities', () => {
    const rows = computeTraits(
      [],
      [
        { liability_type: 'mortgage', name: 'M', outstanding_balance: 100_000 },
        { liability_type: 'credit_card', name: 'CC', outstanding_balance: 15_000 },
      ],
    )
    expect(get(rows, 'net_worth_bracket')).toBe('unknown')
  })

  it('returns positive bracket when assets exceed liabilities', () => {
    const rows = computeTraits(
      [{ asset_type: 'property', current_value: 200_000 }],
      [{ liability_type: 'mortgage', name: 'M', outstanding_balance: 50_000 }],
    )
    expect(get(rows, 'net_worth_bracket')).toBe('100k_plus')
  })

  it('returns negative when assets are present but exceeded by debts', () => {
    const rows = computeTraits(
      [{ asset_type: 'savings', current_value: 1000 }],
      [{ liability_type: 'credit_card', name: 'CC', interest_rate: 20, outstanding_balance: 5000 }],
    )
    expect(get(rows, 'net_worth_bracket')).toBe('negative')
  })

  it('returns under_10k for small positive net worth', () => {
    const rows = computeTraits([{ asset_type: 'savings', current_value: 5000 }], [])
    expect(get(rows, 'net_worth_bracket')).toBe('under_10k')
  })
})

describe('computeTraits — empty input', () => {
  it('returns yes/no rows but no net_worth_bracket when there is nothing to compute', () => {
    const rows = computeTraits([], [])
    expect(get(rows, 'has_property')).toBe('no')
    expect(get(rows, 'has_high_interest_debt')).toBe('no')
    expect(get(rows, 'has_debt')).toBe('no')
    // No assets → net_worth_bracket should be 'unknown' (not omitted)
    expect(get(rows, 'net_worth_bracket')).toBe('unknown')
    // asset_allocation_summary is omitted when no asset values exist
    expect(get(rows, 'asset_allocation_summary')).toBeUndefined()
  })
})

describe('computeTraits — Lewis-shaped portfolio (regression)', () => {
  // The exact prod-Lewis shape that surfaced the v2.2 bugs.
  it('returns correct traits for 2 mortgages + credit card + no assets', () => {
    const rows = computeTraits(
      [],
      [
        { liability_type: 'mortgage', name: 'Mortgage A', outstanding_balance: 50_000 },
        { liability_type: 'mortgage', name: 'Mortgage B', outstanding_balance: 50_000 },
        {
          liability_type: 'credit_card',
          name: 'Card',
          interest_rate: null,
          outstanding_balance: 15_000,
        },
      ],
    )
    expect(get(rows, 'has_property')).toBe('yes')
    expect(get(rows, 'has_high_interest_debt')).toBe(
      'Card (rate not declared — treated as high-interest)',
    )
    expect(get(rows, 'net_worth_bracket')).toBe('unknown')
  })
})
