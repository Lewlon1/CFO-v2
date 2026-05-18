/**
 * Income Shape Detector
 *
 * Pure function over a transaction array. Returns the user's income shape
 * (salaried / salaried_with_bonus / variable / unknown) plus volatility
 * (coefficient of variation) and the deposit count used.
 *
 * CRITICAL: this function NEVER returns the income amount itself. Only
 * pattern signals — shape, CV, count. The amount stays hidden so downstream
 * LLM context-building cannot derive a "% of income" figure from it.
 */

import { isIncomeRow } from './categories'

// ─── TUNABLE_CONSTANTS ───────────────────────────────────────────────────
// Revisit empirically after running on Wave 1 beta users.
//
// Reference points from the test personas:
//   - Maya (UK freelance designer):       CV 0.31  → variable
//   - Carlos (Spain consultant):           CV 0.58  → variable
//   - Hypothetical flat salaried user:     CV ~0.01 → salaried
//   - Hypothetical Spain 14-payment user:  CV ~0.13 → salaried_with_bonus

const SALARIED_CV_MAX = 0.05
const SALARIED_WITH_BONUS_CV_MAX = 0.20
const MIN_DEPOSITS_FOR_DETECTION = 4

// ─── Types ───────────────────────────────────────────────────────────────

export type IncomeShape =
  | 'salaried'
  | 'salaried_with_bonus'
  | 'variable'
  | 'unknown'

export interface IncomeShapeResult {
  shape: IncomeShape
  volatility: number | null  // null when shape is 'unknown'
  deposit_count: number
}

export interface TransactionForShape {
  amount: number | string
  category_id: string | null
  date: string  // present for future windowing logic; unused in v1
}

// ─── Detector ────────────────────────────────────────────────────────────

export function detectIncomeShape(
  transactions: TransactionForShape[],
): IncomeShapeResult {
  // Trust the categorisation pipeline: only count rows tagged as income.
  // Uncategorised positive flow is deliberately excluded — that's the
  // categorisation layer's job to resolve, not this detector's.
  const deposits = transactions
    .filter((t) => isIncomeRow(Number(t.amount), t.category_id))
    .map((t) => Number(t.amount))
    .filter((n) => Number.isFinite(n) && n > 0)

  if (deposits.length < MIN_DEPOSITS_FOR_DETECTION) {
    return {
      shape: 'unknown',
      volatility: null,
      deposit_count: deposits.length,
    }
  }

  const mean = deposits.reduce((s, x) => s + x, 0) / deposits.length
  const variance =
    deposits.reduce((s, x) => s + (x - mean) ** 2, 0) / deposits.length
  const stdDev = Math.sqrt(variance)
  const cv = mean > 0 ? stdDev / mean : 0

  let shape: IncomeShape
  if (cv < SALARIED_CV_MAX) {
    shape = 'salaried'
  } else if (cv < SALARIED_WITH_BONUS_CV_MAX) {
    shape = 'salaried_with_bonus'
  } else {
    shape = 'variable'
  }

  return {
    shape,
    volatility: Math.round(cv * 1000) / 1000,
    deposit_count: deposits.length,
  }
}
