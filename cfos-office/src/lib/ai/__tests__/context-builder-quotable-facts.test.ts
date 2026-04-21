import { describe, it, expect } from 'vitest';
import { buildQuotableFacts } from '../context-builder';
import type { InsightPayload } from '@/lib/analytics/insight-types';

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
  layers: {
    headline: {
      id: 'category_concentration',
      score: 90,
      layer: 'headline',
      data: { category: 'Housing', total: 3300, pct: 64, currency: 'GBP' },
      narrative_prompt: 'Open with the housing figure.',
    },
  },
  hook: {
    type: 'conclude',
    prompt_for_claude: '',
    suggested_response: '',
  },
  suggestedResponses: [],
};

describe('buildQuotableFacts', () => {
  it('emits a money fact with the user currency, not EUR by default', () => {
    const facts = buildQuotableFacts(BASE);
    const money = facts.find((f) => f.text.includes('£3,300'));
    expect(money).toBeDefined();
    expect(money?.numbers).toContain(3300);
  });

  it('emits a percentage fact for share-of-spend', () => {
    const facts = buildQuotableFacts(BASE);
    const pct = facts.find((f) => f.text.includes('64%'));
    expect(pct).toBeDefined();
    expect(pct?.numbers).toContain(64);
  });

  it('never omits the transaction count as a quotable fact', () => {
    const facts = buildQuotableFacts(BASE);
    const tc = facts.find((f) => f.numbers.includes(66));
    expect(tc).toBeDefined();
  });

  it('uses the correct currency symbol for EUR users', () => {
    // Override BASE's stat cards too — they hard-code £ labels; the point of this
    // test is that pattern-derived money facts track the payload currency.
    const euro: InsightPayload = {
      ...BASE,
      currency: 'EUR',
      statCards: [
        { label: 'Tracked spend', value: '€5,191', source_pattern_id: 'headline' },
        { label: 'Months', value: '3', source_pattern_id: 'headline' },
        { label: 'Largest category', value: 'Housing', source_pattern_id: 'headline' },
      ],
    };
    const facts = buildQuotableFacts(euro);
    expect(facts.some((f) => f.text.includes('€3,300'))).toBe(true);
    expect(facts.every((f) => !f.text.includes('£'))).toBe(true);
  });
});
