import { describe, it, expect } from 'vitest'
import { horizonsToShow } from './horizons'

describe('horizonsToShow', () => {
  it('returns the base ladder unchanged when the stated horizon is on it', () => {
    expect(horizonsToShow(10)).toEqual([5, 10, 15, 20])
  })

  it('inserts a stated horizon between rungs, dropping the nearest other value', () => {
    expect(horizonsToShow(12)).toEqual([5, 12, 15, 20])
  })

  it('inserts a stated horizon below the ladder', () => {
    expect(horizonsToShow(3)).toEqual([3, 10, 15, 20])
  })

  it('inserts a stated horizon above the ladder', () => {
    expect(horizonsToShow(25)).toEqual([5, 10, 15, 25])
  })

  it('handles a 1-year stated horizon', () => {
    expect(horizonsToShow(1)).toEqual([1, 10, 15, 20])
  })

  it('always returns exactly four columns', () => {
    for (const s of [1, 3, 5, 8, 10, 12, 17, 20, 25, 30]) {
      expect(horizonsToShow(s)).toHaveLength(4)
    }
  })
})
