import { describe, it, expect } from 'vitest'
import { inferLiabilityType } from '../liability-from-goal'

describe('inferLiabilityType', () => {
  it('maps card / credit goal names to credit_card', () => {
    expect(inferLiabilityType('Clear the credit card')).toBe('credit_card')
    expect(inferLiabilityType('Pay off the BPPR card')).toBe('credit_card')
    expect(inferLiabilityType('credit card debt')).toBe('credit_card')
  })

  it('maps mortgage / student / overdraft / car / loan names', () => {
    expect(inferLiabilityType('Overpay the mortgage')).toBe('mortgage')
    expect(inferLiabilityType('Clear my student loan')).toBe('student_loan')
    expect(inferLiabilityType('Kill the overdraft')).toBe('overdraft')
    expect(inferLiabilityType('Pay off the car finance')).toBe('car_finance')
    expect(inferLiabilityType('Clear the personal loan')).toBe('personal_loan')
  })

  it('falls back to other when nothing matches', () => {
    expect(inferLiabilityType('Clear what I owe Dad')).toBe('other')
    expect(inferLiabilityType('Debt freedom')).toBe('other')
  })
})
