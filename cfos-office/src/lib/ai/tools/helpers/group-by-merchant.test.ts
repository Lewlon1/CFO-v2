import { describe, expect, it } from 'vitest';
import { groupByMerchant } from './group-by-merchant';
import type { TransactionForGrouping } from './group-by-merchant';

function tx(overrides: Partial<TransactionForGrouping>): TransactionForGrouping {
  return {
    amount: -10,
    description: 'TESCO',
    date: '2026-04-01',
    ...overrides,
  };
}

describe('groupByMerchant', () => {
  it('returns an empty array for empty input', () => {
    expect(groupByMerchant([])).toEqual([]);
  });

  it('aggregates a single merchant with multiple transactions', () => {
    const transactions: TransactionForGrouping[] = [
      tx({ description: 'TESCO', amount: -10, date: '2026-04-01' }),
      tx({ description: 'TESCO', amount: -25.5, date: '2026-04-05' }),
      tx({ description: 'TESCO', amount: -4.5, date: '2026-04-03' }),
    ];

    const result = groupByMerchant(transactions);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      merchant: 'tesco',
      total_spend: 40,
      transaction_count: 3,
      first_seen: '2026-04-01',
      last_seen: '2026-04-05',
    });
  });

  it('returns multiple merchants sorted by total_spend descending', () => {
    const transactions: TransactionForGrouping[] = [
      tx({ description: 'TESCO', amount: -10 }),
      tx({ description: 'AMAZON', amount: -100 }),
      tx({ description: 'NETFLIX', amount: -15 }),
    ];

    const result = groupByMerchant(transactions);

    expect(result.map((g) => g.merchant)).toEqual(['amazon', 'netflix', 'tesco']);
    expect(result[0].total_spend).toBe(100);
    expect(result[1].total_spend).toBe(15);
    expect(result[2].total_spend).toBe(10);
  });

  it('reduces total_spend when a refund (positive amount) is present', () => {
    const transactions: TransactionForGrouping[] = [
      tx({ description: 'AMAZON', amount: -50, date: '2026-04-01' }),
      // Partial refund on the same merchant — should net to 30.
      tx({ description: 'AMAZON', amount: 20, date: '2026-04-02' }),
    ];

    const result = groupByMerchant(transactions);

    expect(result).toHaveLength(1);
    expect(result[0].total_spend).toBe(30);
    expect(result[0].transaction_count).toBe(2);
  });

  it('clamps total_spend to 0 when refunds exceed outflows for a merchant', () => {
    const transactions: TransactionForGrouping[] = [
      tx({ description: 'AMAZON', amount: -10, date: '2026-04-01' }),
      tx({ description: 'AMAZON', amount: 25, date: '2026-04-02' }),
    ];

    const result = groupByMerchant(transactions);

    expect(result).toHaveLength(1);
    expect(result[0].total_spend).toBe(0);
    expect(result[0].transaction_count).toBe(2);
  });

  it('groups null and empty descriptions together as "unknown"', () => {
    const transactions: TransactionForGrouping[] = [
      tx({ description: null, amount: -5, date: '2026-04-01' }),
      tx({ description: '', amount: -7, date: '2026-04-02' }),
      tx({ description: '   ', amount: -3, date: '2026-04-03' }),
    ];

    const result = groupByMerchant(transactions);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      merchant: 'unknown',
      total_spend: 15,
      transaction_count: 3,
      first_seen: '2026-04-01',
      last_seen: '2026-04-03',
    });
  });

  it('tracks first_seen and last_seen across out-of-order input', () => {
    const transactions: TransactionForGrouping[] = [
      tx({ description: 'TESCO', date: '2026-04-15' }),
      tx({ description: 'TESCO', date: '2026-04-01' }),
      tx({ description: 'TESCO', date: '2026-04-10' }),
    ];

    const result = groupByMerchant(transactions);

    expect(result[0].first_seen).toBe('2026-04-01');
    expect(result[0].last_seen).toBe('2026-04-15');
  });
});
