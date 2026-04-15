// cfos-office/src/lib/analytics/pattern-detectors.ts

import type { PatternDetector } from './insight-types';

// --- Shared helpers (used by multiple detectors) ---

export function normaliseMerchant(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatCurrency(amount: number, currency: string): string {
  const symbol = currency === 'EUR' ? '€'
    : currency === 'GBP' ? '£'
    : currency === 'USD' ? '$'
    : currency + ' ';
  return `${symbol}${Math.round(amount).toLocaleString()}`;
}

export function isExpense(amount: number): boolean { return amount < 0; }

export function absExpense(amount: number): number { return amount < 0 ? -amount : 0; }

// --- Detectors ---

// C1: Shopping footprint across many food stores, many small trips.
export const merchantFragmentation: PatternDetector = {
  id: 'merchant_fragmentation',
  layer: 'hidden_pattern',
  requires: ['transactions'],
  detect: (ctx) => {
    const FOOD_CATEGORIES = ['groceries', 'dining_out', 'convenience'];
    const txns = ctx.transactions.filter(
      (t) =>
        isExpense(Number(t.amount)) &&
        t.category_id !== null &&
        FOOD_CATEGORIES.includes(t.category_id)
    );
    if (txns.length < 10) return null;

    const merchantSet = new Set<string>();
    let total = 0;
    let under5Count = 0;
    for (const t of txns) {
      const abs = absExpense(Number(t.amount));
      total += abs;
      if (abs < 5) under5Count += 1;
      const key = normaliseMerchant(t.description ?? '');
      if (key) merchantSet.add(key);
    }
    const storeCount = merchantSet.size;
    const avgTrip = total / txns.length;
    const under5Pct = under5Count / txns.length;

    let score = 0;
    if (storeCount >= 8) score += 30;
    if (avgTrip < 10) score += 25;
    if (under5Pct > 0.35) score += 20;
    if (score === 0) return null;

    return {
      id: 'merchant_fragmentation',
      score,
      layer: 'hidden_pattern',
      requires: ['transactions'],
      data: {
        storeCount,
        avgTrip: Math.round(avgTrip),
        under5Count,
        under5Pct: Math.round(under5Pct * 100),
      },
      narrative_prompt: `Name that the user shops at ${storeCount} different food stores with an average trip of ${formatCurrency(avgTrip, ctx.currency)}. Note that ${under5Count} trips were under ${formatCurrency(5, ctx.currency)}. Frame as a pattern observation, not a judgement.`,
    };
  },
};

// --- Library registration ---

// Detectors registered in Phase C/D.
export const PATTERN_LIBRARY: PatternDetector[] = [
  merchantFragmentation,
];
