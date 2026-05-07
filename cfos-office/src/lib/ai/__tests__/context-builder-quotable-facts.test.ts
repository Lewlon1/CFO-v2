import { describe, it, expect } from 'vitest';
import { buildQuotableFacts } from '../context-builder';
import type { InsightPayload, PatternResult } from '@/lib/analytics/insight-types';

const BASE: InsightPayload = {
  version: 1,
  userName: 'Test',
  country: 'GB',
  currency: 'GBP',
  monthCount: 3,
  transactionCount: 66,
  hasValueMap: true,
  archetype: 'builder',
  disciplineScore: 80,
  availableDependencies: ['transactions'],
  computedAt: '2026-04-21T12:00:00.000Z',
  statCards: [
    { label: 'Tracked spend', value: '£5,191', source_pattern_id: 'headline' },
    { label: 'Months', value: '3', source_pattern_id: 'headline' },
    { label: 'Largest category', value: 'Housing', source_pattern_id: 'headline' },
  ],
  layers: {},
  hook: {
    type: 'conclude',
    prompt_for_claude: '',
    suggested_response: '',
  },
  suggestedResponses: [],
};

function allNumbers(facts: ReturnType<typeof buildQuotableFacts>): Set<number> {
  const out = new Set<number>();
  for (const f of facts) for (const n of f.numbers) out.add(n);
  return out;
}

function allMerchants(facts: ReturnType<typeof buildQuotableFacts>): Set<string> {
  const out = new Set<string>();
  for (const f of facts) for (const m of f.merchants) out.add(m);
  return out;
}

describe('buildQuotableFacts — base payload', () => {
  it('always includes the transaction count as an allowed number', () => {
    const facts = buildQuotableFacts(BASE);
    expect(allNumbers(facts).has(66)).toBe(true);
  });

  it('extracts numbers from stat-card values into the allowlist', () => {
    const facts = buildQuotableFacts(BASE);
    expect(allNumbers(facts).has(5191)).toBe(true);
  });

  it('does not crash when the layers map is empty', () => {
    expect(() => buildQuotableFacts(BASE)).not.toThrow();
  });
});

describe('buildQuotableFacts — pattern shapes from the engine', () => {
  it('walks category_concentration (topCategory/topAmount/topPct/top2Pct)', () => {
    const pattern: PatternResult = {
      id: 'category_concentration',
      score: 90,
      layer: 'headline',
      requires: ['transactions'],
      data: {
        topCategory: 'housing',
        topAmount: 3300,
        topPct: 64,
        top2Category: 'groceries',
        top2Pct: 12,
      },
      narrative_prompt: 'housing is 64% of spending (£3,300). Use this as the headline.',
    };
    const payload: InsightPayload = { ...BASE, layers: { headline: pattern } };
    const numbers = allNumbers(buildQuotableFacts(payload));
    expect(numbers.has(3300)).toBe(true);
    expect(numbers.has(64)).toBe(true);
    expect(numbers.has(12)).toBe(true);
  });

  it('walks merchant_fragmentation (storeCount/avgTrip/under5Count/under5Pct)', () => {
    const pattern: PatternResult = {
      id: 'merchant_fragmentation',
      score: 45,
      layer: 'hidden_pattern',
      requires: ['transactions'],
      data: { storeCount: 12, avgTrip: 7, under5Count: 78, under5Pct: 52 },
      narrative_prompt: 'shops at 12 different food stores with an average trip of £7. 78 trips under £5.',
    };
    const payload: InsightPayload = { ...BASE, layers: { hidden_pattern: pattern } };
    const numbers = allNumbers(buildQuotableFacts(payload));
    expect(numbers.has(12)).toBe(true);
    expect(numbers.has(7)).toBe(true);
    expect(numbers.has(78)).toBe(true);
    expect(numbers.has(52)).toBe(true);
  });

  it('walks day_of_week_skew including outlier amounts and ratios', () => {
    const pattern: PatternResult = {
      id: 'day_of_week_skew',
      score: 50,
      layer: 'hidden_pattern',
      requires: ['transactions'],
      data: { outlierDay: 6, outlierName: 'Saturday', outlierAmount: 1872, otherAvg: 374, ratio: 5 },
      narrative_prompt: 'Saturdays carry 5x the average of other days (£1,872 vs £374).',
    };
    const payload: InsightPayload = { ...BASE, layers: { hidden_pattern: pattern } };
    const numbers = allNumbers(buildQuotableFacts(payload));
    expect(numbers.has(1872)).toBe(true);
    expect(numbers.has(374)).toBe(true);
    expect(numbers.has(5)).toBe(true);
  });

  it('walks recurring_expense_total including overlaps array of merchant names', () => {
    const pattern: PatternResult = {
      id: 'recurring_expense_total',
      score: 60,
      layer: 'hidden_pattern',
      requires: ['transactions'],
      data: {
        totalMonthly: 220,
        count: 8,
        overlaps: ['Netflix', 'Disney+'],
        recurringPct: 11,
      },
      narrative_prompt: '8 recurring bills totalling £220 per month. Overlap detected in: Netflix, Disney+.',
    };
    const payload: InsightPayload = { ...BASE, layers: { hidden_pattern: pattern } };
    const facts = buildQuotableFacts(payload);
    const numbers = allNumbers(facts);
    const merchants = allMerchants(facts);
    expect(numbers.has(220)).toBe(true);
    expect(numbers.has(8)).toBe(true);
    expect(numbers.has(11)).toBe(true);
    expect(merchants.has('netflix')).toBe(true);
    expect(merchants.has('disney+')).toBe(true);
  });

  it('walks convenience_vs_planned (chain string is a merchant)', () => {
    const pattern: PatternResult = {
      id: 'convenience_vs_planned',
      score: 40,
      layer: 'hidden_pattern',
      requires: ['transactions'],
      data: {
        chain: 'Tesco',
        convenienceTrips: 14,
        plannedTrips: 3,
        ratio: 5,
        convenienceTotal: 187,
        plannedTotal: 156,
      },
      narrative_prompt: 'For Tesco: 14 convenience-store trips vs 3 main-shop trips.',
    };
    const payload: InsightPayload = { ...BASE, layers: { hidden_pattern: pattern } };
    const facts = buildQuotableFacts(payload);
    const merchants = allMerchants(facts);
    const numbers = allNumbers(facts);
    expect(merchants.has('tesco')).toBe(true);
    expect(numbers.has(187)).toBe(true);
    expect(numbers.has(156)).toBe(true);
    expect(numbers.has(14)).toBe(true);
  });

  it('does NOT add category names as merchants (excluded keys)', () => {
    const pattern: PatternResult = {
      id: 'category_concentration',
      score: 90,
      layer: 'headline',
      requires: ['transactions'],
      data: { topCategory: 'housing', topAmount: 3300, topPct: 64 },
      narrative_prompt: 'housing is 64% of spending.',
    };
    const payload: InsightPayload = { ...BASE, layers: { headline: pattern } };
    const merchants = allMerchants(buildQuotableFacts(payload));
    // 'housing' came from `topCategory` which is in NON_MERCHANT_KEYS.
    expect(merchants.has('housing')).toBe(false);
  });

  it('also harvests numbers from the narrative_prompt template (numbers >= 10)', () => {
    // The detector may compute a number inline in narrative_prompt that is not
    // present as a key in `data`. extractNumbers ignores numbers below 10.
    const pattern: PatternResult = {
      id: 'category_concentration',
      score: 90,
      layer: 'headline',
      requires: ['transactions'],
      data: { topCategory: 'housing', topPct: 64 },
      narrative_prompt: 'housing is 64% of spending (£3,300 of £5,191).',
    };
    const payload: InsightPayload = { ...BASE, layers: { headline: pattern } };
    const numbers = allNumbers(buildQuotableFacts(payload));
    expect(numbers.has(3300)).toBe(true);
    expect(numbers.has(5191)).toBe(true);
  });
});
