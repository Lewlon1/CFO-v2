// Formatting helpers shared across the verdict UI. Presentation only — no
// financial arithmetic lives here (that's the engine's job).

export function gbp(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—'
  return (n < 0 ? '−£' : '£') + Math.abs(Math.round(n)).toLocaleString('en-GB')
}

/** A percentage with trailing zeros trimmed: 3 → "3%", 3.5 → "3.5%". */
export function pct(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—'
  return `${Number(n.toFixed(2))}%`
}
