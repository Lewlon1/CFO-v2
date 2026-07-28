import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { monthsBetween, targetDateFromDuration, computePaceAndOnTrack } from './pace';

// Same generic per-table stub used in levers.test.ts / reconcile-fixed-costs.test.ts —
// returns pre-shaped rows regardless of the query's filter chain.
function makeSupabase(data: Record<string, unknown>): SupabaseClient {
  return {
    from: (table: string) => {
      const result = { data: data[table] ?? null, error: null };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        neq: () => builder,
        in: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => Promise.resolve(result),
        single: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
        then: (resolve: (v: typeof result) => unknown) => resolve(result),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}
const ctxWith = (data: Record<string, unknown>) =>
  ({ supabase: makeSupabase(data), userId: 'u1', conversationId: 'c1', currency: 'GBP' }) as never;

describe('monthsBetween', () => {
  it('counts whole years exactly when day-of-month matches', () => {
    const from = new Date('2026-05-28T00:00:00Z');
    const to = new Date('2031-05-28T00:00:00Z');
    expect(monthsBetween(from, to)).toBe(60);
  });

  it('subtracts a month when target day is before from day', () => {
    // 2026-05-28 → 2026-06-27 is 30 days = not quite one full month.
    const from = new Date('2026-05-28T00:00:00Z');
    const to = new Date('2026-06-27T00:00:00Z');
    expect(monthsBetween(from, to)).toBe(0);
  });

  it('counts a full month when target day matches', () => {
    const from = new Date('2026-05-28T00:00:00Z');
    const to = new Date('2026-06-28T00:00:00Z');
    expect(monthsBetween(from, to)).toBe(1);
  });

  it('handles year boundaries', () => {
    const from = new Date('2026-12-15T00:00:00Z');
    const to = new Date('2027-01-14T00:00:00Z');
    expect(monthsBetween(from, to)).toBe(0); // 14 < 15 → not a full month
    const to2 = new Date('2027-01-15T00:00:00Z');
    expect(monthsBetween(from, to2)).toBe(1);
  });

  it('handles Lewis case: 5 years stays 60, 7 years stays 84', () => {
    // The "5 years from May 28" goal should be exactly 60 months.
    const from = new Date('2026-05-28T00:00:00Z');
    expect(monthsBetween(from, new Date('2031-05-28T00:00:00Z'))).toBe(60);
    // Lewis's wrong-date goal (which LLM picked as 7 years) was 84 months.
    expect(monthsBetween(from, new Date('2033-05-28T00:00:00Z'))).toBe(84);
  });
});

describe('targetDateFromDuration', () => {
  it('adds whole years', () => {
    const from = new Date('2026-05-28T00:00:00Z');
    expect(targetDateFromDuration({ durationYears: 5, from })).toBe('2031-05-28');
  });

  it('adds whole months', () => {
    const from = new Date('2026-05-28T00:00:00Z');
    expect(targetDateFromDuration({ durationMonths: 18, from })).toBe('2027-11-28');
  });

  it('combines years and months', () => {
    const from = new Date('2026-05-28T00:00:00Z');
    expect(targetDateFromDuration({ durationYears: 2, durationMonths: 6, from })).toBe('2028-11-28');
  });

  it('repro of Lewis: "over 5 years" from 2026-05-28 yields 2031-05-28, not 2033', () => {
    const from = new Date('2026-05-28T00:00:00Z');
    const result = targetDateFromDuration({ durationYears: 5, from });
    expect(result).toBe('2031-05-28');
    // Sanity: this would round-trip to exactly 60 months.
    expect(monthsBetween(from, new Date(`${result}T00:00:00Z`))).toBe(60);
  });
});

describe('computePaceAndOnTrack — on_track basis (Opus review finding, Issue 1 follow-up)', () => {
  // ~5 years out; monthly_required_saving for a 6000 target lands somewhere
  // around 85-120/mo depending on exactly how many months that resolves to
  // from "now" — the income deltas below are chosen with enough margin
  // (surplus in the thousands vs. tens) that the verdict is robust to that
  // variance rather than depending on an exact month count.
  const futureDate = '2031-05-28';

  it('leaves on_track NULL (not confidently true) when no discretionary history exists and the modelled surplus would clear the requirement', async () => {
    // No monthly_snapshots row at all → avgDiscretionary is null. The
    // modelled surplus (income − fixed, assuming zero discretionary spend)
    // comfortably covers the requirement — but persisting `on_track: true`
    // off an assumed-zero spend is the false "funded at plan" bug class
    // relocated to a field other surfaces read as a settled fact.
    const result = await computePaceAndOnTrack(ctxWith({
      user_profiles: { net_monthly_income: 4000, partner_monthly_contribution: 0, monthly_rent: 1000 },
      recurring_expenses: [],
      monthly_snapshots: [],
    }), {
      current_amount: 0,
      target_amount: 6000,
      target_date: futureDate,
    });
    expect(result.on_track).toBeNull();
  });

  it('reports on_track TRUE when real discretionary history confirms the surplus clears the requirement', async () => {
    const result = await computePaceAndOnTrack(ctxWith({
      user_profiles: { net_monthly_income: 4000, partner_monthly_contribution: 0, monthly_rent: 1000 },
      recurring_expenses: [],
      monthly_snapshots: [{ total_discretionary: 500 }],
    }), {
      current_amount: 0,
      target_amount: 6000,
      target_date: futureDate,
    });
    // surplus = 4000 − 1000 rent − 500 discretionary = 2500, comfortably
    // above the ~100/mo requirement regardless of the exact month count.
    expect(result.on_track).toBe(true);
  });

  it('reports on_track FALSE (not null) when even the modelled zero-spend surplus falls short — safe direction', async () => {
    const result = await computePaceAndOnTrack(ctxWith({
      user_profiles: { net_monthly_income: 1020, partner_monthly_contribution: 0, monthly_rent: 1000 },
      recurring_expenses: [],
      monthly_snapshots: [],
    }), {
      current_amount: 0,
      target_amount: 6000,
      target_date: futureDate,
    });
    // surplus = 1020 − 1000 = 20, well below the ~100/mo requirement even at
    // the modelled best case (zero discretionary spend). A confident FALSE
    // here is the safe-direction error (understating progress), unlike TRUE.
    expect(result.on_track).toBe(false);
  });
});
