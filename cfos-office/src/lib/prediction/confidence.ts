/**
 * Compute base confidence from signal count and agreement ratio.
 *
 * - 1 signal: 0.45 (weak — single data point)
 * - 2 signals: 0.60 if unanimous, 0.35 if split
 * - 3 signals: 0.70 if >=67% agree, 0.40 if not
 * - 4+: scales with agreement and count, capped at 0.92
 */
export function baseConfidence(totalSignals: number, agreementRatio: number): number {
  if (totalSignals <= 0) return 0
  if (totalSignals === 1) return 0.45
  if (totalSignals === 2) return agreementRatio >= 1.0 ? 0.60 : 0.35
  if (totalSignals === 3) return agreementRatio >= 0.67 ? 0.70 : 0.40

  const raw = 0.50 + agreementRatio * 0.35 + Math.min(0.07, totalSignals * 0.007)
  return Math.round(Math.min(0.92, raw) * 100) / 100
}
