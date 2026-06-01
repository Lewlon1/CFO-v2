import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSpendingBreakdown } from '../spending-breakdown';

type Row = {
  amount: number;
  date: string;
  description: string | null;
  category_id: string | null;
};

/**
 * Minimal chainable Supabase stub. Every filter method returns the same
 * thenable builder; awaiting it resolves to { data, error }. The breakdown
 * does its own date/spend filtering in JS, so the stub ignores filter args
 * and just hands back the seeded rows.
 */
function stubSupabase(rows: Row[], error: unknown = null): SupabaseClient {
  const result = { data: error ? null : rows, error };
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'gte', 'lte']) {
    builder[m] = () => builder;
  }
  builder.then = (resolve: (v: typeof result) => unknown) => resolve(result);
  return { from: () => builder } as unknown as SupabaseClient;
}

const END = '2026-04-30';

describe('getSpendingBreakdown', () => {
  it('returns null when there are no transactions', async () => {
    const out = await getSpendingBreakdown(stubSupabase([]), 'u1', 90, END);
    expect(out).toBeNull();
  });

  it('returns null on a query error', async () => {
    const out = await getSpendingBreakdown(
      stubSupabase([], { message: 'boom' }),
      'u1',
      90,
      END,
    );
    expect(out).toBeNull();
  });

  it('excludes transfers and income from total_spend', async () => {
    const rows: Row[] = [
      { amount: -100, date: '2026-04-01', description: 'Aldi', category_id: 'groceries' },
      // income — positive, income category → not spend
      { amount: 2000, date: '2026-04-01', description: 'Salary', category_id: 'income' },
      // transfer — neutral category → not spend
      { amount: -500, date: '2026-04-02', description: 'Savings move', category_id: 'transfers' },
      // debt repayment — neutral → not spend
      { amount: -300, date: '2026-04-03', description: 'Loan', category_id: 'debt_repayments' },
    ];
    const out = await getSpendingBreakdown(stubSupabase(rows), 'u1', 90, END);
    expect(out).not.toBeNull();
    expect(out!.total_spend).toBe(100);
    expect(out!.top_categories).toHaveLength(1);
    expect(out!.top_categories[0].category).toBe('groceries');
  });

  it('sorts categories desc and percentages sum to ~100', async () => {
    const rows: Row[] = [
      { amount: -300, date: '2026-04-01', description: 'Aldi', category_id: 'groceries' },
      { amount: -200, date: '2026-04-02', description: 'Pret', category_id: 'dining_out' },
      { amount: -100, date: '2026-04-03', description: 'TfL', category_id: 'transport' },
    ];
    const out = await getSpendingBreakdown(stubSupabase(rows), 'u1', 90, END);
    expect(out!.total_spend).toBe(600);
    expect(out!.top_categories.map((c) => c.category)).toEqual([
      'groceries',
      'dining_out',
      'transport',
    ]);
    const pctSum = out!.top_categories.reduce((s, c) => s + c.pct, 0);
    expect(Math.round(pctSum)).toBe(100);
    expect(out!.top_categories[0].pct).toBe(50);
  });

  it('caps top categories at 5', async () => {
    const cats = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const rows: Row[] = cats.map((c, i) => ({
      amount: -(10 + i),
      date: '2026-04-01',
      description: c,
      category_id: c,
    }));
    const out = await getSpendingBreakdown(stubSupabase(rows), 'u1', 90, END);
    expect(out!.top_categories).toHaveLength(5);
  });

  it('rolls normalised merchant variants (bank prefix + trailing ref) into one biggest_merchant', async () => {
    const rows: Row[] = [
      // 'POS PURCHASE ' prefix stripped + 6-digit trailing ref stripped → 'ALDI'
      { amount: -40, date: '2026-04-01', description: 'POS PURCHASE ALDI 123456', category_id: 'groceries' },
      { amount: -35, date: '2026-04-08', description: 'ALDI', category_id: 'groceries' },
      { amount: -10, date: '2026-04-02', description: 'Pret', category_id: 'dining_out' },
    ];
    const out = await getSpendingBreakdown(stubSupabase(rows), 'u1', 90, END);
    expect(out!.biggest_merchant).not.toBeNull();
    expect(out!.biggest_merchant!.txn_count).toBe(2);
    expect(out!.biggest_merchant!.total).toBe(75);
  });

  it('picks the true largest single transaction', async () => {
    const rows: Row[] = [
      { amount: -40, date: '2026-04-01', description: 'Aldi', category_id: 'groceries' },
      { amount: -250, date: '2026-04-15', description: 'Flights', category_id: 'travel' },
      { amount: -30, date: '2026-04-20', description: 'Pret', category_id: 'dining_out' },
    ];
    const out = await getSpendingBreakdown(stubSupabase(rows), 'u1', 90, END);
    expect(out!.largest_transaction).not.toBeNull();
    expect(out!.largest_transaction!.amount).toBe(250);
    expect(out!.largest_transaction!.date).toBe('2026-04-15');
  });

  it('folds null/empty/Unknown categories into Uncategorised and reports its share', async () => {
    const rows: Row[] = [
      { amount: -100, date: '2026-04-01', description: 'Mystery', category_id: null },
      { amount: -50, date: '2026-04-02', description: 'Vague', category_id: 'unknown' },
      { amount: -50, date: '2026-04-03', description: 'Aldi', category_id: 'groceries' },
    ];
    const out = await getSpendingBreakdown(stubSupabase(rows), 'u1', 90, END);
    const uncat = out!.top_categories.find((c) => c.category === 'Uncategorised');
    expect(uncat).toBeDefined();
    expect(uncat!.total).toBe(150);
    expect(out!.uncategorised_pct).toBe(75);
  });
});
