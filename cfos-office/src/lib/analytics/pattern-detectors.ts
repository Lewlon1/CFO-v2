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

// C2: Many small transactions forming a modest share of total spend.
export const transactionSizeDistribution: PatternDetector = {
  id: 'transaction_size_distribution',
  layer: 'hidden_pattern',
  requires: ['transactions'],
  detect: (ctx) => {
    const txns = ctx.transactions.filter((t) => isExpense(Number(t.amount)));
    if (txns.length < 30) return null;

    let totalSpend = 0;
    let under10Count = 0;
    let under10Total = 0;
    for (const t of txns) {
      const abs = absExpense(Number(t.amount));
      totalSpend += abs;
      if (abs < 10) {
        under10Count += 1;
        under10Total += abs;
      }
    }
    const countPct = under10Count / txns.length;
    const amountPct = totalSpend > 0 ? under10Total / totalSpend : 0;

    let score = 0;
    if (countPct > 0.40 && amountPct < 0.15) score += 40;
    else if (countPct > 0.30) score += 20;
    if (score === 0) return null;

    return {
      id: 'transaction_size_distribution',
      score,
      layer: 'hidden_pattern',
      requires: ['transactions'],
      data: {
        countUnder10: under10Count,
        pctCountUnder10: Math.round(countPct * 100),
        pctSpendUnder10: Math.round(amountPct * 100),
      },
      narrative_prompt: `${Math.round(countPct * 100)}% of transactions are under ${formatCurrency(10, ctx.currency)} (${under10Count} decisions for ${Math.round(amountPct * 100)}% of total spend). Many small decisions, modest share of the money — useful to name.`,
    };
  },
};

// C3: One or two categories dominate discretionary spend.
export const categoryConcentration: PatternDetector = {
  id: 'category_concentration',
  layer: 'headline',
  requires: ['transactions'],
  detect: (ctx) => {
    const EXCLUDED = new Set(['rent', 'mortgage']);
    const txns = ctx.transactions.filter(
      (t) =>
        isExpense(Number(t.amount)) &&
        t.category_id !== null &&
        !EXCLUDED.has(t.category_id)
    );
    if (txns.length < 15) return null;

    const byCategory = new Map<string, number>();
    let total = 0;
    for (const t of txns) {
      const cat = t.category_id as string;
      const abs = absExpense(Number(t.amount));
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + abs);
      total += abs;
    }
    if (total <= 0) return null;

    const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
    const top1 = sorted[0];
    const top2 = sorted[1] ?? null;
    const top1Pct = top1[1] / total;
    const top2Pct = top2 ? (top1[1] + top2[1]) / total : top1Pct;

    let score = 0;
    if (top1Pct > 0.35) score += 50;
    if (top2Pct > 0.55) score = Math.max(score, 40);
    if (score === 0) return null;

    return {
      id: 'category_concentration',
      score,
      layer: 'headline',
      requires: ['transactions'],
      data: {
        topCategory: top1[0],
        topAmount: Math.round(top1[1]),
        topPct: Math.round(top1Pct * 100),
        top2Category: top2?.[0] ?? null,
        top2Pct: Math.round(top2Pct * 100),
      },
      narrative_prompt: `${top1[0]} is ${Math.round(top1Pct * 100)}% of spending (${formatCurrency(top1[1], ctx.currency)}). Use this as the headline perspective shift.`,
    };
  },
};

// --- Library registration ---

// Detectors registered in Phase C/D.
export const PATTERN_LIBRARY: PatternDetector[] = [
  merchantFragmentation,
  transactionSizeDistribution,
  categoryConcentration,
];
