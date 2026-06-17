import { describe, it, expect } from 'vitest'
import { aggregateMonthSpending } from '../monthly-snapshot'

function txn(
  amount: number,
  category_id: string | null,
  description = 'fixture',
  value_category: string | null = null,
  value_confidence: number | null = null,
  value_confirmed_by_user: boolean | null = null,
) {
  return { amount, category_id, value_category, description, value_confidence, value_confirmed_by_user }
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

  it('buckets value categories through the VM-1 honesty gate', () => {
    const txns = [
      // user-confirmed → always displayable
      txn(-100, 'groceries', 'confirmed foundation', 'foundation', 0.2, true),
      // high-confidence rule → displayable
      txn(-50, 'subscriptions', 'rule leak', 'leak', 0.8, false),
      // low-confidence default → unmapped
      txn(-200, 'shopping', 'weak guess', 'leak', 0.2, false),
      // unsure → unmapped regardless of confidence
      txn(-30, 'travel', 'unsure row', 'unsure', 0.9, false),
      // null label → unmapped
      txn(-20, 'entertainment', 'no label', null, null, null),
    ]
    const result = aggregateMonthSpending(txns)
    expect(result.spendingByValueCategory.foundation).toBe(100)
    expect(result.spendingByValueCategory.leak).toBe(50)
    expect(result.spendingByValueCategory.unmapped).toBe(250)
    expect(result.spendingByValueCategory.unsure).toBeUndefined()
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
