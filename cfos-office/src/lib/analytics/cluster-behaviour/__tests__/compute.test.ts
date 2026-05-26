import { describe, it, expect } from 'vitest';
import {
  deriveRecurrence,
  deriveTrend,
  deriveTimePattern,
  deriveAmountProfile,
  deriveLifecycle,
} from '../compute';
import type { AggregateRow } from '../types';

// Helper: produce ISO dates at fixed interval from a base
function dates(start: string, intervalDays: number, count: number): string[] {
  const out: string[] = [];
  const base = new Date(start).getTime();
  for (let i = 0; i < count; i++) {
    out.push(new Date(base + i * intervalDays * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

describe('deriveRecurrence', () => {
  it('classifies daily clockwork as daily with high regularity', () => {
    const r = deriveRecurrence(dates('2026-03-01', 1, 14));
    expect(r.pattern_label).toBe('daily');
    expect(r.median_interval_days).toBe(1);
    expect(r.regularity_score).toBeGreaterThan(0.8);
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('classifies weekly cadence', () => {
    const r = deriveRecurrence(dates('2026-03-01', 7, 8));
    expect(r.pattern_label).toBe('weekly');
    expect(r.median_interval_days).toBe(7);
  });

  it('classifies monthly cadence', () => {
    const r = deriveRecurrence(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
    expect(r.pattern_label).toBe('monthly');
  });

  it('flags irregular when stddev is high', () => {
    const r = deriveRecurrence(['2026-03-01', '2026-03-02', '2026-03-20', '2026-03-21', '2026-04-15']);
    expect(r.pattern_label).toBe('irregular');
    expect(r.regularity_score).toBeLessThan(0.5);
  });

  it('returns sparse with low confidence when n < 3', () => {
    const r = deriveRecurrence(['2026-03-01', '2026-03-15']);
    expect(r.pattern_label).toBe('sparse');
    expect(r.median_interval_days).toBeNull();
    expect(r.confidence).toBeLessThan(0.3);
  });

  it('handles empty input', () => {
    const r = deriveRecurrence([]);
    expect(r.pattern_label).toBe('sparse');
    expect(r.confidence).toBe(0.2);
  });
});

describe('deriveTrend', () => {
  function agg(monthIdx: number, total: number): AggregateRow {
    return {
      month_start: `2026-0${monthIdx}-01`,
      transaction_count: 4,
      total_amount: total,
      mean_amount: total / 4,
      stddev_amount: 0,
      first_seen: `2026-0${monthIdx}-01`,
      last_seen: `2026-0${monthIdx}-28`,
      dow_array: [1, 2, 3, 4],
    };
  }

  it('detects climbing trend (>+5%/mo)', () => {
    const t = deriveTrend([agg(1, -100), agg(2, -150), agg(3, -200)]);
    expect(t.direction).toBe('climbing');
    expect(t.slope_amount_per_month).toBeGreaterThan(0); // slope of |total|
  });

  it('detects declining trend (<-5%/mo)', () => {
    const t = deriveTrend([agg(1, -200), agg(2, -150), agg(3, -100)]);
    expect(t.direction).toBe('declining');
  });

  it('detects stable trend', () => {
    const t = deriveTrend([agg(1, -100), agg(2, -101), agg(3, -99)]);
    expect(t.direction).toBe('stable');
  });

  it('flags volatile when R² is low', () => {
    const t = deriveTrend([agg(1, -100), agg(2, -300), agg(3, -50), agg(4, -400)]);
    expect(t.direction).toBe('volatile');
  });

  it('returns null direction with low confidence when <3 months', () => {
    const t = deriveTrend([agg(1, -100), agg(2, -150)]);
    expect(t.direction).toBeNull();
    expect(t.slope_amount_per_month).toBeNull();
  });

  it('handles all-zero months gracefully', () => {
    const t = deriveTrend([agg(1, 0), agg(2, 0), agg(3, 0)]);
    expect(t.direction).toBeNull();
    expect(t.confidence).toBeLessThan(0.5);
  });
});

describe('deriveTimePattern', () => {
  it('detects weekday-skewed Pret-style pattern (Mon-Fri only)', () => {
    // 2026-03-02 is a Monday; gen Mon-Fri only for 4 weeks
    const dates: string[] = [];
    let d = new Date('2026-03-02'); // Monday
    for (let w = 0; w < 4; w++) {
      for (let i = 0; i < 5; i++) {
        dates.push(d.toISOString().slice(0, 10));
        d = new Date(d.getTime() + 86_400_000);
      }
      d = new Date(d.getTime() + 2 * 86_400_000); // skip Sat+Sun
    }
    const p = deriveTimePattern(dates);
    expect(p.weekday_share).toBe(1);
    expect(p.has_weekday_skew).toBe(true);
  });

  it('detects weekend-skewed pattern', () => {
    // Sat + Sun across 3 weekends
    const p = deriveTimePattern(['2026-03-07', '2026-03-08', '2026-03-14', '2026-03-15', '2026-03-21', '2026-03-22']);
    expect(p.weekday_share).toBe(0);
    expect(p.has_weekday_skew).toBe(true);
  });

  it('reports balanced when no skew', () => {
    const p = deriveTimePattern(['2026-03-02', '2026-03-03', '2026-03-07', '2026-03-08']);
    expect(p.has_weekday_skew).toBe(false);
  });

  it('handles empty input', () => {
    const p = deriveTimePattern([]);
    expect(p.dominant_day).toBeNull();
    expect(p.confidence).toBe(0);
  });
});

describe('deriveAmountProfile', () => {
  it('classifies fixed when CV < 0.05', () => {
    const p = deriveAmountProfile([-49.99, -49.99, -49.99, -49.99]);
    expect(p.consistency_label).toBe('fixed');
    expect(p.coefficient_of_variation).toBeLessThan(0.05);
  });

  it('classifies tight when CV is in 0.05-0.15', () => {
    // Choose amounts deliberately spread enough that CV lands in (0.05, 0.15)
    const p = deriveAmountProfile([-4.20, -4.65, -5.10, -4.50, -4.95, -4.30]);
    expect(['tight', 'variable']).toContain(p.consistency_label);
    expect(p.coefficient_of_variation).toBeGreaterThan(0.05);
  });

  it('classifies variable around CV 0.2', () => {
    const p = deriveAmountProfile([-5, -8, -10, -6, -9, -7]);
    expect(['variable', 'tight']).toContain(p.consistency_label);
  });

  it('classifies wide when CV >= 0.4', () => {
    const p = deriveAmountProfile([-5, -50, -200, -10, -300]);
    expect(p.consistency_label).toBe('wide');
    expect(p.coefficient_of_variation).toBeGreaterThanOrEqual(0.4);
  });

  it('returns zero confidence for empty input', () => {
    const p = deriveAmountProfile([]);
    expect(p.confidence).toBe(0);
  });
});

describe('deriveLifecycle', () => {
  const now = new Date('2026-05-26');

  it('flags new merchant (first seen within 30 days)', () => {
    const l = deriveLifecycle({
      firstSeenInHistory: '2026-05-10',
      lastSeen: '2026-05-25',
      windowDays: 90,
      now,
    });
    expect(l.status).toBe('new');
    expect(l.appeared_within_window).toBe(true);
  });

  it('flags dormant when last seen > 30 days ago', () => {
    const l = deriveLifecycle({
      firstSeenInHistory: '2025-01-01',
      lastSeen: '2026-03-15',
      windowDays: 90,
      now,
    });
    expect(l.status).toBe('dormant');
    expect(l.days_since_last).toBeGreaterThan(30);
  });

  it('flags active when seen within last 30 days and not new', () => {
    const l = deriveLifecycle({
      firstSeenInHistory: '2025-06-01',
      lastSeen: '2026-05-20',
      windowDays: 90,
      now,
    });
    expect(l.status).toBe('active');
    expect(l.appeared_within_window).toBe(false);
  });

  it('returns new with zero confidence when no data', () => {
    const l = deriveLifecycle({
      firstSeenInHistory: null,
      lastSeen: null,
      windowDays: 90,
      now,
    });
    expect(l.status).toBe('new');
    expect(l.confidence).toBe(0);
  });
});
