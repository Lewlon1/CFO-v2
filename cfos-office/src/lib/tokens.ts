// ============================================================
// Design Tokens — The CFO's Office
// Single source of truth. Import from here, never hardcode.
// ============================================================

export const colors = {
  // Backgrounds
  bgBase: '#0F0F0D',
  bgElevated: '#111110',
  bgCard: 'rgba(255,255,255,0.015)',
  bgInset: 'rgba(0,0,0,0.15)',
  bgDeep: 'rgba(0,0,0,0.2)',

  // Text
  textPrimary: '#F5F5F0',
  textSecondary: 'rgba(245,245,240,0.55)',
  textTertiary: 'rgba(245,245,240,0.3)',
  textMuted: 'rgba(245,245,240,0.18)',
  textGhost: 'rgba(245,245,240,0.12)',

  // Accent — The CFO
  gold: '#E8A84C',
  goldSoft: 'rgba(232,168,76,0.5)',
  goldBg: 'rgba(232,168,76,0.06)',
  goldBorder: 'rgba(232,168,76,0.12)',

  // Semantic
  positive: '#22C55E',
  negative: '#F43F5E',
  info: '#3B82F6',
  cyan: '#06B6D4',
  purple: '#8B5CF6',

  // Borders
  borderSubtle: 'rgba(255,255,255,0.04)',
  borderMedium: 'rgba(255,255,255,0.06)',
  borderVisible: 'rgba(255,255,255,0.07)',

  // Interactive
  tapHighlight: 'rgba(255,255,255,0.03)',
} as const;

export const folderColors = {
  cashflow: '#22C55E',
  values: '#E8A84C',
  networth: '#06B6D4',
  scenarios: '#F43F5E',
} as const;

export const valueCategories = {
  foundation: { color: '#22C55E', bg: 'rgba(34,197,94,0.12)', label: 'foundation' },
  investment: { color: '#3B82F6', bg: 'rgba(59,130,246,0.12)', label: 'investment' },
  leak:       { color: '#F43F5E', bg: 'rgba(243,63,94,0.12)', label: 'leak' },
  burden:     { color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)', label: 'burden' },
  unsure:     { color: 'rgba(232,168,76,0.5)', bg: 'none', label: '~ unsure', border: '1px dashed rgba(232,168,76,0.3)' },
} as const;

export type ValueCategory = keyof typeof valueCategories;

export const fonts = {
  body: "'DM Sans', sans-serif",
  mono: "'JetBrains Mono', monospace",
  logo: "'Cormorant Garamond', serif",
} as const;
