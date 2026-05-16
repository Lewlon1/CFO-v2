// cfos-office/src/lib/ai/tools/helpers/data-confidence.ts
//
// Shared data-confidence assessment. Tools call this to attach a
// 'high' | 'medium' | 'low' qualifier so the CFO voice stays honest
// about thin data instead of overclaiming on a fortnight's worth.

export type DataConfidence = 'high' | 'medium' | 'low';

export interface ConfidenceInputs {
  n_transactions: number;
  n_days: number;                       // window length in days
  expected_recurrence_count?: number;   // optional: for "X times/month" claims
}

export interface ConfidenceResult {
  level: DataConfidence;
  reason: string;                       // 1-line human-readable explanation
}

/**
 * Assess data confidence for a tool's output.
 *
 * Thresholds are tuned for the CFO's "honest about thin data" voice:
 *   - <14 days                                → low
 *   - 14–29 days                              → medium
 *   - ≥30 days, <20 transactions              → medium
 *   - ≥30 days, ≥20 transactions              → high
 *
 * If `expected_recurrence_count` is provided and it's <3, downgrade to low —
 * three is the minimum for "this is a pattern" rather than "this happened".
 */
export function assessDataConfidence(
  inputs: ConfidenceInputs,
): ConfidenceResult {
  const { n_transactions, n_days, expected_recurrence_count } = inputs;

  // Recurrence downgrade trumps everything else: we can't call a pattern
  // off fewer than three occurrences regardless of window size.
  if (expected_recurrence_count !== undefined && expected_recurrence_count < 3) {
    return {
      level: 'low',
      reason: `Only ${expected_recurrence_count} occurrences — not enough to call a pattern.`,
    };
  }

  if (n_days < 14) {
    return {
      level: 'low',
      reason: 'Less than 2 weeks of data — patterns may not be representative.',
    };
  }

  if (n_days < 30) {
    return {
      level: 'medium',
      reason: '2–4 weeks of data — directional but not confirmed.',
    };
  }

  // n_days >= 30 from here on.
  if (n_transactions < 20) {
    return {
      level: 'medium',
      reason: `Sample size of ${n_transactions} transactions is small for a ${n_days}-day window.`,
    };
  }

  return {
    level: 'high',
    reason: `${n_transactions} transactions across ${n_days} days is a solid baseline.`,
  };
}
