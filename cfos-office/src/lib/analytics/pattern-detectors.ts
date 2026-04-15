// cfos-office/src/lib/analytics/pattern-detectors.ts

import type { PatternDetector } from './insight-types';

// Detectors registered in Phase C/D. Empty for now.
export const PATTERN_LIBRARY: PatternDetector[] = [];

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
