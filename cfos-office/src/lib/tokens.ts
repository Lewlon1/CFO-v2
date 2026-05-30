// ============================================================
// Design Tokens — typed var() accessor over globals.css
// ============================================================
// SOURCE OF TRUTH: globals.css (:root + :root[data-theme="light"] + @theme inline).
// This file returns `var(--…)` strings ONLY — no raw hex/rgba, no grey gen, no
// third source. (Rule corrected in Phase 1 — see SESSION-LOG: "tokens.ts wins"
// was right when tokens.ts was the curated source; the walnut retheme made it
// stale. One source; this is a typed accessor over it.)
//
// Safe in any CSS context (className via @theme utilities, or var() string in
// style={{}} / Recharts fill/stroke). NOT for string math or canvas literals.

export const colors = {
  // Backgrounds
  bgBase: 'var(--bg-base)',
  bgElevated: 'var(--bg-elevated)',
  bgCard: 'var(--bg-card)',
  bgInset: 'var(--bg-inset)',
  bgDeep: 'var(--bg-deep)',

  // Text
  textPrimary: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  textTertiary: 'var(--text-tertiary)',
  textMuted: 'var(--text-muted)',
  textGhost: 'var(--text-ghost)',

  // Accent — The CFO
  gold: 'var(--accent-gold)',
  goldSoft: 'var(--accent-gold-soft)',
  goldBg: 'var(--accent-gold-bg)',
  goldBorder: 'var(--accent-gold-border)',

  // Semantic
  positive: 'var(--positive)',
  negative: 'var(--negative)',
  info: 'var(--info)',
  cyan: 'var(--accent-cyan)',
  // (deleted: `purple` #8B5CF6 — retired, zero consumers)

  // Borders
  borderSubtle: 'var(--border-subtle)',
  borderMedium: 'var(--border-medium)',
  borderVisible: 'var(--border-visible)',

  // Interactive
  tapHighlight: 'var(--tap-highlight)',
} as const

export const folderColors = {
  // Four-folder palette (v2.5). Scenarios dropped. Each maps to a --folder-* var.
  goals: 'var(--folder-goals)',
  cashflow: 'var(--folder-cashflow)',
  values: 'var(--folder-values)',
  networth: 'var(--folder-networth)',
} as const

// Value-category palette — own vars, independent of semantic positive/negative.
// Inversion resolved at the token layer: Foundation = blue, Investment = green
// (aligned to the shipped value-map). Prefer this accessor / the bg-value-* utilities.
export const valueColors = {
  foundation: 'var(--value-foundation)',
  investment: 'var(--value-investment)',
  leak: 'var(--value-leak)',
  burden: 'var(--value-burden)',
  unsure: 'var(--value-unsure)',
} as const

// Legacy-shaped accessor (color/bg/label) over the same vars, for existing
// consumers (charts, ValuePill, office Values surfaces). Migrate to valueColors
// / bg-value-* utilities in Phase 3. `bg` derives a 12% tint via color-mix so it
// stays theme-reactive; no separate --value-*-bg var needed.
export const valueCategories = {
  foundation: { color: valueColors.foundation, bg: 'color-mix(in oklab, var(--value-foundation) 12%, transparent)', label: 'foundation' },
  investment: { color: valueColors.investment, bg: 'color-mix(in oklab, var(--value-investment) 12%, transparent)', label: 'investment' },
  leak:       { color: valueColors.leak,       bg: 'color-mix(in oklab, var(--value-leak) 12%, transparent)',       label: 'leak' },
  burden:     { color: valueColors.burden,     bg: 'color-mix(in oklab, var(--value-burden) 12%, transparent)',     label: 'burden' },
  unsure:     { color: valueColors.unsure,     bg: 'none', label: '~ unsure', border: '1px dashed color-mix(in oklab, var(--value-unsure) 50%, transparent)' },
} as const

export type ValueCategory = keyof typeof valueCategories

// (deleted: `fonts` — DM Sans / JetBrains Mono / Cormorant Garamond were never
// loaded. The loaded families are Instrument Serif / Instrument Sans / Geist Mono,
// referenced via globals.css --font-* and the `font-serif`/`font-sans`/`font-mono` utilities.)
