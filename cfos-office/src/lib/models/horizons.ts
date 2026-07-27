// Which horizons to show in the verdict timelines table. Always four columns:
// the base ladder [5, 10, 15, 20], with the user's stated horizon guaranteed a
// slot. When the stated horizon isn't on the ladder, it displaces the nearest
// other value (ties break toward dropping the smaller), keeping the count at 4.
const BASE = [5, 10, 15, 20]

export function horizonsToShow(stated: number): number[] {
  const s = Math.max(1, Math.round(stated))
  if (BASE.includes(s)) return [...BASE]

  const withStated = [...BASE, s].sort((a, b) => a - b)
  // Drop the non-stated value nearest to `s`; on a tie, drop the smaller one.
  let dropIdx = -1
  let bestDist = Infinity
  for (let i = 0; i < withStated.length; i++) {
    const val = withStated[i]
    if (val === s) continue
    const dist = Math.abs(val - s)
    if (dist < bestDist) {
      bestDist = dist
      dropIdx = i
    }
  }
  return withStated.filter((_, i) => i !== dropIdx)
}
