// Client-side resolution of asset / liability type → canonical token var() string.
//
// Visual Phase 3b, Sweep C: the /api/balance-sheet route used to ship raw hex
// `color` on every asset/liability group + allocation slice (a server route
// doing presentation). It no longer does — the route emits only the type id,
// and the client resolves the colour here at render time off the canonical
// token layer (theme-reactive in both themes).
//
// Flagged no-clean-equivalents (no categorical token palette exists; none
// invented per the migration rules — these collapse onto the nearest semantic
// token, documented in SESSION-LOG):
//   bonds          violet  → accent-purple (warm grey)
//   crypto         orange  → value-leak
//   student_loan   orange  → accent-gold
//   car_finance    amber   → accent-gold
//   bnpl           orange  → accent-gold
// Liability hues intentionally collapse onto negative / accent-gold / unsure —
// they read as decorative accents on individually-labelled debt cards (no donut),
// so the collisions are acceptable.

const ASSET_TYPE_COLOR: Record<string, string> = {
  savings: 'var(--positive)',
  stocks: 'var(--info)',
  bonds: 'var(--accent-purple)',
  pension: 'var(--accent-gold)',
  crypto: 'var(--value-leak)',
  property: 'var(--accent-cyan)',
  other: 'var(--value-unsure)',
}

const LIABILITY_TYPE_COLOR: Record<string, string> = {
  mortgage: 'var(--negative)',
  student_loan: 'var(--accent-gold)',
  credit_card: 'var(--negative)',
  personal_loan: 'var(--negative)',
  car_finance: 'var(--accent-gold)',
  bnpl: 'var(--accent-gold)',
  overdraft: 'var(--negative)',
  other: 'var(--value-unsure)',
}

export function assetTypeColor(type: string): string {
  return ASSET_TYPE_COLOR[type] ?? ASSET_TYPE_COLOR.other
}

export function liabilityTypeColor(type: string): string {
  return LIABILITY_TYPE_COLOR[type] ?? LIABILITY_TYPE_COLOR.other
}

// 12% tint of a token var() string, theme-reactive. Replaces the old
// `${hex}20` alpha-concat (which breaks on var() strings).
export function typeColorTint(color: string): string {
  return `color-mix(in oklab, ${color} 12%, transparent)`
}
