import { describe, it, expect } from 'vitest';
import { selectReadRecipe, type RecipeInput } from '../first-read-recipe';

const base: RecipeInput = { goal: null, entryStruggle: null, entryStruggleText: null };

describe('selectReadRecipe', () => {
  it('a concrete goal (amount AND date) → target, regardless of struggle', () => {
    expect(
      selectReadRecipe({
        ...base,
        goal: { name: 'Deposit', target_amount: 50000, target_date: '2031-01-01' },
        entryStruggle: 'dont_know',
      }),
    ).toBe('target');
  });

  it('goal with amount but no date does not force target', () => {
    expect(
      selectReadRecipe({
        ...base,
        goal: { name: 'Deposit', target_amount: 50000, target_date: null },
        entryStruggle: 'debt',
      }),
    ).toBe('control');
  });

  it('dont_know → visibility', () => {
    expect(selectReadRecipe({ ...base, entryStruggle: 'dont_know' })).toBe('visibility');
  });

  it('debt → control', () => {
    expect(selectReadRecipe({ ...base, entryStruggle: 'debt' })).toBe('control');
  });

  it('wealth → target (blocker leads when no number)', () => {
    expect(selectReadRecipe({ ...base, entryStruggle: 'wealth' })).toBe('target');
  });

  it('planning → target', () => {
    expect(selectReadRecipe({ ...base, entryStruggle: 'planning' })).toBe('target');
  });

  it('null struggle, no goal → open', () => {
    expect(selectReadRecipe(base)).toBe('open');
  });

  describe('free_text keyword routing', () => {
    const ft = (text: string) =>
      selectReadRecipe({ ...base, entryStruggle: 'free_text', entryStruggleText: text });

    it('"where is my money going" → visibility', () => {
      expect(ft('I have no idea where my money is going each month')).toBe('visibility');
    });

    it('"clear my credit card debt" → control', () => {
      expect(ft('I want to pay off my credit card debt')).toBe('control');
    });

    it('"save for a house deposit" → target', () => {
      expect(ft('trying to save for a house deposit')).toBe('target');
    });

    it('empty free text → open', () => {
      expect(ft('')).toBe('open');
      expect(selectReadRecipe({ ...base, entryStruggle: 'free_text', entryStruggleText: null })).toBe('open');
    });

    it('unmatched free text → open', () => {
      expect(ft('just curious about the app')).toBe('open');
    });
  });
});
