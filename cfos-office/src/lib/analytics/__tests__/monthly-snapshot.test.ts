import { describe, it, expect } from 'vitest'
import { aggregateMonthSpending, computeTotalDiscretionaryForRow } from '../monthly-snapshot'

function txn(
  amount: number,
  category_id: string | null,
  description = 'fixture',
  value_category: string | null = null,
) {
  return { amount, category_id, value_category, description }
}

describe('aggregateMonthSpending — bucketing rules', () => {
  it('skips null-categorised positive amounts (income that escaped the categoriser)', () => {
    // Carlos's case: €36k of salary deposits with category_id = null. Before
    // the fix these landed in spending_by_category.uncategorised as a large
    // negative delta and poisoned every downstream consumer.
    const txns = [
      txn(12000, null, 'NOMINA ABRIL'),
      txn(12000, null, 'NOMINA MAYO'),
      txn(12000, null, 'NOMINA JUNIO'),
      txn(-500, null, 'GROCERY OFFLINE'),
      txn(-200, 'housing', 'RENT'),
    ]
    const result = aggregateMonthSpending(txns)

    // Uncategorised bucket reflects only the spend (€500), not net-against-income.
    expect(result.spendingByCategory.uncategorised).toBe(500)
    expect(result.spendingByCategory.housing).toBe(200)
    expect(Object.values(result.spendingByCategory).every((v) => v >= 0)).toBe(true)

    // Total spending excludes income too.
    expect(result.totalSpending).toBe(700)
    // totalIncome currently requires category_id === 'income' so null-categorised
    // income still doesn't show in total_income — out of scope here, but
    // captured so a future fix doesn't accidentally regress.
    expect(result.totalIncome).toBe(0)
  })

  it('still nets refunds against their spending category (legitimate refund flow)', () => {
    // A €50 refund from H&M (positive amount, category_id = 'shopping')
    // should reduce the visible shopping total, NOT be skipped.
    const txns = [
      txn(-300, 'shopping', 'H&M PURCHASE'),
      txn(50, 'shopping', 'H&M REFUND'),
    ]
    const result = aggregateMonthSpending(txns)
    expect(result.spendingByCategory.shopping).toBe(250) // 300 outflow - 50 refund
    expect(result.totalSpending).toBe(250)
  })

  it('counts income from properly-categorised salary rows in totalIncome', () => {
    const txns = [
      txn(3200, 'income', 'SALARY'),
      txn(3200, 'income', 'SALARY'),
      txn(-500, 'groceries', 'MERCADONA'),
    ]
    const result = aggregateMonthSpending(txns)
    expect(result.totalIncome).toBe(6400)
    expect(result.totalSpending).toBe(500)
    expect(result.spendingByCategory.income).toBeUndefined()
  })

  it('drops neutral categories (transfers, debt repayments, savings)', () => {
    const txns = [
      txn(-1000, 'transfers', 'TRANSFER TO SAVINGS'),
      txn(-200, 'debt_repayments', 'CREDIT CARD PAYMENT'),
      txn(-300, 'savings_investments', 'INVESTMENT'),
      txn(-50, 'groceries', 'SUPERMARKET'),
    ]
    const result = aggregateMonthSpending(txns)
    expect(result.spendingByCategory.transfers).toBeUndefined()
    expect(result.spendingByCategory.debt_repayments).toBeUndefined()
    expect(result.spendingByCategory.savings_investments).toBeUndefined()
    expect(result.totalSpending).toBe(50)
  })

  it('tracks largest transaction by absolute amount', () => {
    const txns = [
      txn(-50, 'groceries', 'small'),
      txn(-1400, 'housing', 'mortgage'),
      txn(-200, 'shopping', 'shopping'),
    ]
    const result = aggregateMonthSpending(txns)
    expect(result.largestTxn).toBe(1400)
    expect(result.largestTxnDesc).toBe('mortgage')
  })

  it('emits no negative bucket values even with mixed income and refunds in null bucket', () => {
    // Stress test: income leaking + refund-heavy uncategorised should still
    // produce a non-negative uncategorised bucket because positive nulls
    // are skipped at the gate.
    const txns = [
      txn(5000, null, 'NULL INCOME'),
      txn(-100, null, 'unclassified spend'),
      txn(-50, null, 'unclassified spend'),
    ]
    const result = aggregateMonthSpending(txns)
    expect(result.spendingByCategory.uncategorised).toBe(150)
    expect(result.totalSpending).toBe(150)
  })
})

describe('computeTotalDiscretionaryForRow — Opus review finding (Issue 1 follow-up)', () => {
  it('subtracts current fixed costs from that month\'s total_spending in the normal case', () => {
    expect(computeTotalDiscretionaryForRow(3032.5, 1800)).toBeCloseTo(1232.5, 2)
  })

  it('returns NULL, not a floored 0, when total_spending is below current fixed costs', () => {
    // A partial upload missing an account fixed bills are paid from, or
    // fixed costs that have risen since — NOT "this user spent nothing on
    // top of their bills". Flooring this to 0 would let average() treat it
    // as real observed history (basis: 'observed'), producing an unhedged,
    // overstated free-cash figure with high confidence.
    expect(computeTotalDiscretionaryForRow(1500, 2200)).toBeNull()
  })

  it('returns 0 (not null) exactly at the boundary — spending equals fixed costs', () => {
    expect(computeTotalDiscretionaryForRow(2200, 2200)).toBe(0)
  })

  it('returns null when total_spending itself is null (row not yet aggregated)', () => {
    expect(computeTotalDiscretionaryForRow(null, 1800)).toBeNull()
  })
})
