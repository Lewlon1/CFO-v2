import { describe, expect, it, vi } from 'vitest';
import { createFindTemporalSignalsTool } from './find-temporal-signals';
import type { ToolContext } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EXCLUDED_FROM_PL_PG_LIST } from '@/lib/analytics/categories';

interface StubRow {
  id: string;
  date: string;
  description: string | null;
  amount: number;
  category_id: string | null;
}

interface StubOptions {
  rows?: StubRow[] | null;
  error?: { message: string } | null;
}

// Chainable supabase stub. Tracks every call so RLS / filter assertions are easy.
function makeSupabaseStub(opts: StubOptions = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];

  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (onFulfilled: (v: unknown) => unknown) => Promise<unknown>;
  } = {} as never;

  const finalise = () =>
    Promise.resolve({
      data: opts.rows ?? [],
      error: opts.error ?? null,
    });

  for (const method of ['select', 'eq', 'gte', 'lte', 'is', 'not'] as const) {
    builder[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    });
  }
  builder.then = (onFulfilled: (v: unknown) => unknown) =>
    finalise().then(onFulfilled);

  const supabase = {
    from: vi.fn((table: string) => {
      calls.push({ method: 'from', args: [table] });
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { supabase, calls };
}

function makeCtx(supabase: SupabaseClient): ToolContext {
  return {
    supabase,
    userId: 'user-123',
    conversationId: 'conv-1',
    currency: 'GBP',
  };
}

interface ToolResult {
  filter?: { date_from: string; date_to: string; min_multiplier: number };
  currency?: string;
  window?: { n_transactions: number; n_days: number };
  signals?: Array<{
    pattern:
      | 'day_of_week'
      | 'time_of_day'
      | 'weekend_skew'
      | 'weekday_skew'
      | 'holiday_cluster';
    label: string;
    multiplier: number;
    total_in_pattern: number;
    total_baseline: number;
    top_merchants: Array<{ merchant: string; amount: number }>;
    sample_transactions: Array<{
      id: string;
      date: string;
      merchant: string;
      amount: number;
    }>;
    narrative_hint: string;
    data_confidence: 'high' | 'medium' | 'low';
  }>;
  data_confidence?: { level: 'high' | 'medium' | 'low'; reason: string };
  error?: string;
}

describe('createFindTemporalSignalsTool — input schema', () => {
  it('accepts minimal input with sensible defaults', () => {
    const tool = createFindTemporalSignalsTool(makeCtx(makeSupabaseStub().supabase));
    const result = tool.inputSchema.safeParse({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.min_multiplier).toBe(1.5);
    }
  });

  it('rejects min_multiplier below 1', () => {
    const tool = createFindTemporalSignalsTool(makeCtx(makeSupabaseStub().supabase));
    expect(
      tool.inputSchema.safeParse({
        date_from: '2026-04-01',
        date_to: '2026-04-30',
        min_multiplier: 0.5,
      }).success,
    ).toBe(false);
  });
});

describe('createFindTemporalSignalsTool — execute (RLS / filters)', () => {
  it('pins by user_id on the transactions query (RLS)', async () => {
    const { supabase, calls } = makeSupabaseStub({ rows: [] });
    const tool = createFindTemporalSignalsTool(makeCtx(supabase));

    await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      min_multiplier: 1.5,
    });

    const userPins = calls.filter(
      (c) => c.method === 'eq' && c.args[0] === 'user_id' && c.args[1] === 'user-123',
    );
    expect(userPins.length).toBe(1);
  });

  it('applies the EXCLUDED_FROM_PL_PG_LIST not-in filter and soft-delete pin', async () => {
    const { supabase, calls } = makeSupabaseStub({ rows: [] });
    const tool = createFindTemporalSignalsTool(makeCtx(supabase));

    await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      min_multiplier: 1.5,
    });

    const notCalls = calls.filter((c) => c.method === 'not');
    expect(
      notCalls.some(
        (c) =>
          c.args[0] === 'category_id' &&
          c.args[1] === 'in' &&
          c.args[2] === EXCLUDED_FROM_PL_PG_LIST,
      ),
    ).toBe(true);

    const isCalls = calls.filter((c) => c.method === 'is');
    expect(
      isCalls.some((c) => c.args[0] === 'deleted_at' && c.args[1] === null),
    ).toBe(true);
  });
});

describe('createFindTemporalSignalsTool — empty / thin data', () => {
  it('returns empty signals on empty data', async () => {
    const { supabase } = makeSupabaseStub({ rows: [] });
    const tool = createFindTemporalSignalsTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      min_multiplier: 1.5,
    })) as ToolResult;

    expect(result.signals).toEqual([]);
    expect(result.window?.n_transactions).toBe(0);
    expect(result.currency).toBe('GBP');
  });

  it('returns empty signals + low data_confidence when window is under 14 days', async () => {
    // A few Friday transactions in a 7-day window — confidence stays low,
    // and holiday detection refuses to fire at all.
    const rows: StubRow[] = [
      { id: 't1', date: '2026-04-03', description: 'GLOVO', amount: -50, category_id: 'eat_drinking_out' },
      { id: 't2', date: '2026-04-04', description: 'TESCO', amount: -10, category_id: 'groceries' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindTemporalSignalsTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-07', // 7 days
      min_multiplier: 1.5,
    })) as ToolResult;

    expect(result.data_confidence?.level).toBe('low');
    // No holiday cluster — window is too short.
    const holiday = result.signals?.filter((s) => s.pattern === 'holiday_cluster');
    expect(holiday?.length ?? 0).toBe(0);
  });
});

describe('createFindTemporalSignalsTool — day-of-week detection', () => {
  it('surfaces a Friday signal when Friday spend is well above the daily average', async () => {
    // April 2026: Fridays are 3, 10, 17, 24 (4 Fridays).
    // 3 transactions on Fridays, each £50 → Friday total = 150 across 4 Fridays
    //   → Friday per-occurrence = 37.5
    // 10 other-day transactions at £10 each → other = 100
    // Overall daily avg = 250 / 30 ≈ 8.33
    // Friday multiplier = 37.5 / 8.33 ≈ 4.5x → well over 1.5
    const rows: StubRow[] = [
      // Three Fridays at £50
      { id: 'f1', date: '2026-04-03', description: 'GLOVO', amount: -50, category_id: 'eat_drinking_out' },
      { id: 'f2', date: '2026-04-10', description: 'GLOVO', amount: -50, category_id: 'eat_drinking_out' },
      { id: 'f3', date: '2026-04-17', description: 'GLOVO', amount: -50, category_id: 'eat_drinking_out' },
      // Ten other days at £10 (mix of Mon–Sun, no Fridays)
      { id: 'o1', date: '2026-04-01', description: 'TESCO', amount: -10, category_id: 'groceries' },
      { id: 'o2', date: '2026-04-02', description: 'TESCO', amount: -10, category_id: 'groceries' },
      { id: 'o3', date: '2026-04-04', description: 'TESCO', amount: -10, category_id: 'groceries' },
      { id: 'o4', date: '2026-04-05', description: 'TESCO', amount: -10, category_id: 'groceries' },
      { id: 'o5', date: '2026-04-06', description: 'TESCO', amount: -10, category_id: 'groceries' },
      { id: 'o6', date: '2026-04-07', description: 'TESCO', amount: -10, category_id: 'groceries' },
      { id: 'o7', date: '2026-04-08', description: 'TESCO', amount: -10, category_id: 'groceries' },
      { id: 'o8', date: '2026-04-09', description: 'TESCO', amount: -10, category_id: 'groceries' },
      { id: 'o9', date: '2026-04-11', description: 'TESCO', amount: -10, category_id: 'groceries' },
      { id: 'o10', date: '2026-04-12', description: 'TESCO', amount: -10, category_id: 'groceries' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindTemporalSignalsTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      min_multiplier: 1.5,
    })) as ToolResult;

    const dowSignals = result.signals?.filter((s) => s.pattern === 'day_of_week');
    expect(dowSignals?.length).toBe(1);
    const friday = dowSignals?.[0];
    expect(friday?.label.toLowerCase()).toContain('friday');
    expect(friday?.multiplier).toBeGreaterThanOrEqual(1.5);
    expect(friday?.top_merchants[0].merchant).toBe('glovo');
    expect(friday?.sample_transactions.length).toBeGreaterThan(0);
    // Narrative hint must not editorialise.
    expect(friday?.narrative_hint.toLowerCase()).not.toContain('leak');
    expect(friday?.narrative_hint.toLowerCase()).not.toContain('burden');
  });

  it('does NOT surface a day-of-week signal when multiplier is just below threshold (~1.3x)', async () => {
    // Build a balanced dataset where the strongest day clears the daily
    // average by ~1.3x — under the 1.5 default threshold.
    // April 2026 has 4 Fridays. £40 on Fridays per occurrence, £30 on other
    // days per occurrence. Daily avg overall = (4*40 + 26*30) / 30 = 31.3.
    // Friday multiplier = 40 / 31.3 ≈ 1.28x → no signal.
    const rows: StubRow[] = [];
    // 4 Fridays × £40
    const fridays = ['2026-04-03', '2026-04-10', '2026-04-17', '2026-04-24'];
    fridays.forEach((d, i) =>
      rows.push({
        id: `f${i}`,
        date: d,
        description: 'COSTA',
        amount: -40,
        category_id: 'eat_drinking_out',
      }),
    );
    // 26 other-days × £30 — fill non-Friday dates in April
    let other = 0;
    for (let day = 1; day <= 30; day++) {
      const iso = `2026-04-${String(day).padStart(2, '0')}`;
      const date = new Date(iso);
      if (date.getDay() === 5) continue; // skip Fridays
      rows.push({
        id: `o${other++}`,
        date: iso,
        description: 'TESCO',
        amount: -30,
        category_id: 'groceries',
      });
    }
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindTemporalSignalsTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      min_multiplier: 1.5,
    })) as ToolResult;

    const dowSignals = result.signals?.filter((s) => s.pattern === 'day_of_week');
    expect(dowSignals?.length ?? 0).toBe(0);
  });
});

describe('createFindTemporalSignalsTool — weekend skew', () => {
  it('surfaces weekend_skew when weekend per-day rate is ≥1.5x weekday rate', async () => {
    // April 2026 has 8 weekend days (4 Sat + 4 Sun) and 22 weekday days.
    // Weekend: £80 per day × 8 = £640 (just need rate to be ≥1.5x weekday rate)
    // Weekday: £20 per day × 22 = £440
    // Weekend rate = 80; weekday rate = 20; multiplier = 4.0 → fires.
    const rows: StubRow[] = [];
    for (let day = 1; day <= 30; day++) {
      const iso = `2026-04-${String(day).padStart(2, '0')}`;
      const date = new Date(iso);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      rows.push({
        id: `d${day}`,
        date: iso,
        description: isWeekend ? 'RESTAURANT' : 'TESCO',
        amount: isWeekend ? -80 : -20,
        category_id: isWeekend ? 'eat_drinking_out' : 'groceries',
      });
    }
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindTemporalSignalsTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      min_multiplier: 1.5,
    })) as ToolResult;

    const weekendSignals = result.signals?.filter((s) => s.pattern === 'weekend_skew');
    expect(weekendSignals?.length).toBe(1);
    expect(weekendSignals?.[0].multiplier).toBeGreaterThanOrEqual(1.5);
    expect(weekendSignals?.[0].top_merchants.length).toBeGreaterThan(0);
    expect(weekendSignals?.[0].narrative_hint.toLowerCase()).toContain('weekend');
  });
});

describe('createFindTemporalSignalsTool — holiday cluster', () => {
  it('surfaces a holiday_cluster when a 7-day window contains ≥2x baseline spend + ≥3 merchants + ≥4 distinct days', async () => {
    // Build a 60-day baseline window with light daily spend (€10/day),
    // then drop a 5-day "trip" of multi-merchant heavy spend in the middle.
    const rows: StubRow[] = [];
    let id = 0;
    // 60 days of baseline at €10/day → total baseline = 600
    for (let day = 0; day < 60; day++) {
      const dateMs = new Date('2026-04-01T00:00:00Z').getTime() + day * 24 * 60 * 60 * 1000;
      const iso = new Date(dateMs).toISOString().slice(0, 10);
      // Skip the 5-day trip range so it's purely holiday spend.
      if (day >= 20 && day < 25) continue;
      rows.push({
        id: `b${id++}`,
        date: iso,
        description: 'TESCO',
        amount: -10,
        category_id: 'groceries',
      });
    }
    // 5-day trip: 5 distinct days, 5 distinct foreign-looking merchants, big amounts
    const tripStartMs = new Date('2026-04-01T00:00:00Z').getTime() + 20 * 24 * 60 * 60 * 1000;
    const tripMerchants = ['HOTEL BARCELONA', 'TAPAS BAR', 'MUSEO PICASSO', 'TAXI BCN', 'CAFE GAUDI'];
    for (let i = 0; i < 5; i++) {
      const iso = new Date(tripStartMs + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      rows.push({
        id: `h${i}`,
        date: iso,
        description: tripMerchants[i],
        amount: -120,
        category_id: 'travel',
      });
    }

    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindTemporalSignalsTool(makeCtx(supabase));

    // 60-day window. baseline 7-day = (600 + 600)/60 * 7 = 140 → threshold = 280.
    // Trip window spend across consecutive 7 days hits ≥600 → multiplier ~4x.
    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-05-30',
      min_multiplier: 1.5,
    })) as ToolResult;

    const holiday = result.signals?.filter((s) => s.pattern === 'holiday_cluster');
    expect(holiday?.length).toBe(1);
    expect(holiday?.[0].multiplier).toBeGreaterThanOrEqual(2);
    expect(holiday?.[0].top_merchants.length).toBeGreaterThanOrEqual(3);
    expect(holiday?.[0].narrative_hint.toLowerCase()).toContain('cluster');
  });

  it('does NOT surface a holiday_cluster when window is under 14 days', async () => {
    const rows: StubRow[] = [
      { id: 't1', date: '2026-04-01', description: 'HOTEL', amount: -200, category_id: 'travel' },
      { id: 't2', date: '2026-04-02', description: 'TAPAS', amount: -50, category_id: 'eat_drinking_out' },
      { id: 't3', date: '2026-04-03', description: 'MUSEUM', amount: -30, category_id: 'entertainment' },
      { id: 't4', date: '2026-04-04', description: 'TAXI', amount: -25, category_id: 'transport' },
      { id: 't5', date: '2026-04-05', description: 'BAR', amount: -40, category_id: 'eat_drinking_out' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindTemporalSignalsTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-10', // 10 days < 14
      min_multiplier: 1.5,
    })) as ToolResult;

    const holiday = result.signals?.filter((s) => s.pattern === 'holiday_cluster');
    expect(holiday?.length ?? 0).toBe(0);
  });
});

describe('createFindTemporalSignalsTool — time-of-day', () => {
  it('skips time_of_day signal silently when dates lack time component and notes it in data_confidence', async () => {
    // All rows are pure 'YYYY-MM-DD' → parsed at local midnight.
    const rows: StubRow[] = [
      { id: 't1', date: '2026-04-01', description: 'A', amount: -10, category_id: 'groceries' },
      { id: 't2', date: '2026-04-02', description: 'B', amount: -10, category_id: 'groceries' },
      { id: 't3', date: '2026-04-03', description: 'C', amount: -10, category_id: 'groceries' },
    ];
    const { supabase } = makeSupabaseStub({ rows });
    const tool = createFindTemporalSignalsTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      min_multiplier: 1.5,
    })) as ToolResult;

    const tod = result.signals?.filter((s) => s.pattern === 'time_of_day');
    expect(tod?.length ?? 0).toBe(0);
    expect(result.data_confidence?.reason.toLowerCase()).toContain('time-of-day');
  });
});

describe('createFindTemporalSignalsTool — error handling', () => {
  it('returns a friendly error when the DB query fails', async () => {
    const { supabase } = makeSupabaseStub({ error: { message: 'boom' } });
    const tool = createFindTemporalSignalsTool(makeCtx(supabase));

    const result = (await tool.execute({
      date_from: '2026-04-01',
      date_to: '2026-04-30',
      min_multiplier: 1.5,
    })) as ToolResult;

    expect(result.error).toBe('Could not fetch transactions. Please try again.');
  });
});
