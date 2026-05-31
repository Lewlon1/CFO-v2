'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Wallet, TrendingUp, Target, Scale, Plus } from 'lucide-react'

// --- token sources (inspect-only; imported, never hardcoded) ---
import { colors, folderColors, valueCategories } from '@/lib/tokens'
import { QUADRANTS } from '@/lib/value-map/constants'
import { VALUE_COLORS } from '@/lib/constants/dashboard'

// --- the live theme mechanism + the real primitives/molecules ---
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Briefing } from '@/components/office/dashboards/Briefing'
import { DetailHeader } from '@/components/office/dashboards/DetailHeader'
import { DrillDownRow } from '@/components/office/dashboards/DrillDownRow'
import { DashboardEmptyState } from '@/components/office/dashboards/DashboardEmptyState'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Input, Textarea } from '@/components/ui/Input'

// ─────────────────────────────────────────────────────────────────────────────
// Live-theme hook: re-renders when the global data-theme attribute flips, so
// every getComputedStyle read below refreshes for the active theme.
// ─────────────────────────────────────────────────────────────────────────────
function useThemeKey(): string {
  const [key, setKey] = useState('dark')
  useEffect(() => {
    const read = () =>
      setKey(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark')
    read()
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return key
}

function useResolvedVar(cssVar: string, themeKey: string): string {
  const [val, setVal] = useState('')
  useEffect(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
    setVal(v)
  }, [cssVar, themeKey])
  return val
}

// ── Swatch primitives (styleguide-local; read tokens only) ──────────────────

/** Swatch backed by a CSS var; shows the live resolved value. */
function VarSwatch({ cssVar, label, themeKey }: { cssVar: string; label: string; themeKey: string }) {
  const resolved = useResolvedVar(cssVar, themeKey)
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span
        className="h-10 w-10 shrink-0 rounded-md border border-border"
        style={{ background: `var(${cssVar})` }}
      />
      <div className="min-w-0 font-mono text-xs leading-tight">
        <div className="truncate text-foreground">{label}</div>
        <div className="truncate text-muted-foreground">{cssVar}</div>
        <div className="truncate text-muted-foreground">{resolved || '—'}</div>
      </div>
    </div>
  )
}

/** Swatch backed by a JS token value (a colour string imported from a module). */
function ValueSwatch({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="h-10 w-10 shrink-0 rounded-md border border-border" style={{ background: value }} />
      <div className="min-w-0 font-mono text-xs leading-tight">
        <div className="truncate text-foreground">{label}</div>
        {sub ? <div className="truncate text-muted-foreground">{sub}</div> : null}
        <div className="truncate text-muted-foreground">{value}</div>
      </div>
    </div>
  )
}

function Section({ n, title, note, children }: { n: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-5">
      <div className="flex items-baseline gap-3 border-b border-border pb-2">
        <span className="font-mono text-xs text-primary">{n}</span>
        <h2 className="font-serif text-2xl text-foreground">{title}</h2>
      </div>
      {note ? <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{note}</p> : null}
      {children}
    </section>
  )
}

function Sub({ children }: { children: ReactNode }) {
  return <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{children}</h3>
}

function Gap({ name }: { name: string }) {
  return (
    <div className="flex h-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-foreground/5 text-center">
      <span className="font-mono text-sm text-foreground">{name}</span>
      <span className="font-mono text-xs text-muted-foreground">not a shared primitive yet</span>
    </div>
  )
}

// ── Data (token references + battery findings; no literals) ─────────────────

const BG_VARS = ['--bg-base', '--bg-elevated', '--bg-card', '--bg-inset', '--bg-deep']
const SURFACE_VARS = [
  '--background', '--foreground', '--card', '--card-foreground',
  '--muted', '--muted-foreground', '--accent', '--accent-foreground', '--input',
]
const TEXT_VARS = ['--text-primary', '--text-secondary', '--text-tertiary', '--text-muted', '--text-ghost']
const GOLD_VARS = ['--accent-gold', '--accent-gold-soft', '--accent-gold-bg', '--accent-gold-border', '--primary', '--ring']
const SEMANTIC_VARS = ['--positive', '--negative', '--info', '--accent-cyan', '--accent-purple', '--destructive']
const BORDER_VARS = ['--border', '--border-subtle', '--border-medium', '--border-visible', '--tap-highlight']

const FOLDER_KEYS = ['goals', 'cashflow', 'values', 'networth'] as const
const VALUE_KEYS = ['foundation', 'investment', 'leak', 'burden', 'unsure'] as const

// The three competing value-category sources, for the conflict panel.
const CONFLICT_ROWS = [
  {
    src: 'tokens.ts · valueCategories',
    foundation: { kind: 'value' as const, v: valueCategories.foundation.color },
    investment: { kind: 'value' as const, v: valueCategories.investment.color },
  },
  {
    src: 'value-map · QUADRANTS (shipped demo)',
    foundation: { kind: 'value' as const, v: QUADRANTS.foundation.colour },
    investment: { kind: 'value' as const, v: QUADRANTS.investment.colour },
  },
  {
    src: 'dashboard.ts · VALUE_COLORS (shipped badges)',
    foundation: { kind: 'class' as const, v: VALUE_COLORS.foundation.text },
    investment: { kind: 'class' as const, v: VALUE_COLORS.investment.text },
  },
]

// Distinct type sizes found in the wild (px), with a usage note where declared.
const TYPE_SCALE: { size: number; use: string }[] = [
  { size: 20, use: 'page title' },
  { size: 18, use: 'folder detail heading' },
  { size: 16, use: 'metric value · input min' },
  { size: 15, use: 'chat header' },
  { size: 13, use: 'chat body · file labels' },
  { size: 12, use: 'preview text' },
  { size: 11, use: 'pills · "Open"' },
  { size: 10, use: 'subtitles' },
  { size: 9, use: 'mono tags' },
  { size: 8, use: 'category labels' },
  { size: 7, use: 'status badges' },
]
// One-off outliers found that no scale would predict.
const TYPE_OUTLIERS = [76, 64, 52, 48, 44, 36, 30, 28, 26, 24, 22, 19, 17, 14.5, 13.5, 10.5, 9.5]

// Distinct radii (px) found across the app.
const RADII = [2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12]
// Distinct spacing values (px) found (gaps / padding / margins).
const SPACING = [1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 14, 16]
// A few of the distinct line-heights found.
const LEADINGS = [1.04, 1.1, 1.2, 1.45, 1.55, 1.7]

// ─────────────────────────────────────────────────────────────────────────────

export function StyleguideClient() {
  const themeKey = useThemeKey()

  return (
    <main className="mx-auto min-h-dvh max-w-5xl space-y-12 bg-background p-8 text-foreground">
      {/* Header + theme toggle */}
      <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div className="space-y-1">
          <h1 className="font-serif text-3xl text-foreground">The CFO&apos;s Office — Styleguide</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Dev-only. Reads the live token layer and the real components, so it renders the declared
            system <em>including its drift</em>. The toggle flips the whole page — light vars are scoped to{' '}
            <code className="font-mono">:root[data-theme=light]</code>, so a nested both-theme column
            can&apos;t resolve them. See <code className="font-mono">audit/visual-consistency.md</code>.
          </p>
        </div>
        <ThemeToggle />
      </header>

      {/* 1 — Colour tokens */}
      <Section
        n="01"
        title="Colour tokens"
        note="Every colour token defined in globals.css, rendered from var(--…). The resolved value is read live via getComputedStyle, so it reflects the active theme. The drift panel shows the tokens.ts neutrals (the stale grey generation) beside the shipped walnut vars — they disagree."
      >
        <Sub>Backgrounds</Sub>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {BG_VARS.map((v) => <VarSwatch key={v} cssVar={v} label={v} themeKey={themeKey} />)}
        </div>

        <Sub>Surfaces (shadcn-style aliases)</Sub>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {SURFACE_VARS.map((v) => <VarSwatch key={v} cssVar={v} label={v} themeKey={themeKey} />)}
        </div>

        <Sub>Text</Sub>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {TEXT_VARS.map((v) => <VarSwatch key={v} cssVar={v} label={v} themeKey={themeKey} />)}
        </div>

        <Sub>Accent / Gold (the CFO voice)</Sub>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {GOLD_VARS.map((v) => <VarSwatch key={v} cssVar={v} label={v} themeKey={themeKey} />)}
        </div>

        <Sub>Semantic</Sub>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {SEMANTIC_VARS.map((v) => <VarSwatch key={v} cssVar={v} label={v} themeKey={themeKey} />)}
        </div>

        <Sub>Borders / interactive</Sub>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {BORDER_VARS.map((v) => <VarSwatch key={v} cssVar={v} label={v} themeKey={themeKey} />)}
        </div>

        <Sub>Drift — grey gen (tokens.ts) vs walnut gen (shipped vars)</Sub>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <ValueSwatch value={colors.bgBase} label="colors.bgBase" sub="tokens.ts (grey)" />
          <VarSwatch cssVar="--bg-base" label="--bg-base" themeKey={themeKey} />
          <ValueSwatch value={colors.textPrimary} label="colors.textPrimary" sub="tokens.ts (grey)" />
          <VarSwatch cssVar="--text-primary" label="--text-primary" themeKey={themeKey} />
        </div>
      </Section>

      {/* 2 — Folder palette */}
      <Section
        n="02"
        title="Folder palette"
        note="Four folders (Scenarios was dropped in v2.5). Only Values is delivered as a CSS var (--folder-values); goals, cashflow and networth live only in tokens.ts, so components can't var() them — they must import JS."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {FOLDER_KEYS.map((k) => (
            <ValueSwatch key={k} value={folderColors[k]} label={`folderColors.${k}`} />
          ))}
        </div>
        <Sub>Values — also a CSS var</Sub>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <VarSwatch cssVar="--folder-values" label="--folder-values" themeKey={themeKey} />
        </div>
      </Section>

      {/* 3 — Value-category palette + source-conflict panel */}
      <Section
        n="03"
        title="Value categories + source conflict"
        note="Resolved (Phase 1). All three sources — tokens.ts valueCategories, the value-map quadrant, and the dashboard badges — now route through the canonical --value-* tokens, so they AGREE: Foundation blue / Investment green everywhere. The panel renders all three so the agreement is visible, not just asserted; the earlier green→blue inversion is gone."
      >
        <Sub>tokens.ts · valueCategories</Sub>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {VALUE_KEYS.map((k) => (
            <ValueSwatch key={k} value={valueCategories[k].color} label={valueCategories[k].label} sub={k} />
          ))}
        </div>
        <p className="max-w-3xl font-mono text-xs text-muted-foreground">
          Value-category pills (Foundation/Burden/Investment/Leak) are intentionally NOT a Badge
          tone yet — they need the canonical --value-* tokens Visual Phase 1 introduces (decision
          D1). The Badge primitive ships with semantic tones only (see §06). ValuePill stays live
          in TransactionRow until then.
        </p>

        <Sub>Conflict panel — Foundation vs Investment, across three sources</Sub>
        <div className="overflow-hidden rounded-md border border-border">
          <div className="grid grid-cols-3 gap-px bg-border font-mono text-xs">
            <div className="bg-card p-3 text-muted-foreground">source</div>
            <div className="bg-card p-3 text-foreground">Foundation</div>
            <div className="bg-card p-3 text-foreground">Investment</div>
            {CONFLICT_ROWS.map((row) => (
              <ConflictRow key={row.src} row={row} />
            ))}
          </div>
        </div>
        <p className="max-w-3xl font-mono text-xs text-muted-foreground">
          All three rows now read blue → green — they agree. Decision D1 is resolved: the token layer
          was aligned to the shipped blue/green, so tokens.ts no longer inverts against what ships.
        </p>
      </Section>

      {/* 4 — Typography */}
      <Section
        n="04"
        title="Typography"
        note="Root loads Instrument Serif/Sans + Geist Mono; the (office) layout layers on DM Sans / JetBrains Mono / Cormorant Garamond (scoped to /office). This styleguide route is OUTSIDE (office)/, so those three don't load HERE and fall back. Phase 2a encoded the type scale (shown below)."
      >
        <Sub>Fonts in role (loaded)</Sub>
        <div className="space-y-2">
          <p style={{ fontFamily: 'var(--font-instrument-serif), Georgia, serif' }} className="text-2xl text-foreground">
            Instrument Serif — headings, briefings. “Your money tells a story.”
          </p>
          <p style={{ fontFamily: 'var(--font-instrument-sans), system-ui, sans-serif' }} className="text-base text-foreground">
            Instrument Sans — body prose, UI labels. The CFO talks like a person, not a product.
          </p>
          <p style={{ fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' }} className="text-sm text-foreground">
            Geist Mono — numbers, eyebrows, tags. €1,640 · 47 transactions · uploaded 3 Apr
          </p>
        </div>

        <Sub>Encoded type scale — Phase 2a (named, collision-free utilities)</Sub>
        <div className="space-y-1">
          <div className="flex items-baseline gap-4"><span className="text-display text-foreground">Ag €1,640</span><span className="font-mono text-xs text-muted-foreground">text-display · 20 · page title</span></div>
          <div className="flex items-baseline gap-4"><span className="text-h1 text-foreground">Ag €1,640</span><span className="font-mono text-xs text-muted-foreground">text-h1 · 18 · folder heading</span></div>
          <div className="flex items-baseline gap-4"><span className="text-h2 text-foreground">Ag €1,640</span><span className="font-mono text-xs text-muted-foreground">text-h2 · 16 · metric / hero</span></div>
          <div className="flex items-baseline gap-4"><span className="text-h3 text-foreground">Ag €1,640</span><span className="font-mono text-xs text-muted-foreground">text-h3 · 15 · chat header</span></div>
          <div className="flex items-baseline gap-4"><span className="text-body text-foreground">Ag €1,640</span><span className="font-mono text-xs text-muted-foreground">text-body · 13 · body, chat</span></div>
          <div className="flex items-baseline gap-4"><span className="text-body-sm text-foreground">Ag €1,640</span><span className="font-mono text-xs text-muted-foreground">text-body-sm · 12 · inbox preview</span></div>
          <div className="flex items-baseline gap-4"><span className="text-label text-foreground">Ag €1,640</span><span className="font-mono text-xs text-muted-foreground">text-label · 11 · pills, labels</span></div>
          <div className="flex items-baseline gap-4"><span className="text-caption text-foreground">Ag €1,640</span><span className="font-mono text-xs text-muted-foreground">text-caption · 10 · subtitle</span></div>
          <div className="flex items-baseline gap-4"><span className="text-tag text-foreground">Ag €1,640</span><span className="font-mono text-xs text-muted-foreground">text-tag · 9 · provenance</span></div>
          <div className="flex items-baseline gap-4"><span className="text-micro text-foreground">Ag €1,640</span><span className="font-mono text-xs text-muted-foreground">text-micro · 8 · bar labels</span></div>
          <div className="flex items-baseline gap-4"><span className="text-nano text-foreground">AG €1,640</span><span className="font-mono text-xs text-muted-foreground">text-nano · 7 · status badges</span></div>
        </div>

        <Sub>Fonts — tokens.ts cleanup (Phase 1)</Sub>
        <p className="font-mono text-xs text-muted-foreground">
          Removed only the dead `fonts` STRING export from tokens.ts. The families all load:
          Instrument Serif/Sans + Geist Mono (root) and DM Sans / JetBrains Mono / Cormorant
          Garamond (office subtree). Briefing correctly renders Cormorant in /office — it falls
          back to Georgia HERE because the styleguide route sits outside (office)/.
        </p>

        <Sub>Type sizes found in the wild (declared-ish cluster)</Sub>
        <div className="space-y-2">
          {TYPE_SCALE.map(({ size, use }) => (
            <div key={size} className="flex items-baseline gap-4">
              <span style={{ fontSize: `${size}px`, lineHeight: 1.1 }} className="text-foreground">Ag €1,640</span>
              <span className="font-mono text-xs text-muted-foreground">{size}px · {use}</span>
            </div>
          ))}
        </div>

        <Sub>Outlier sizes (no scale predicts these)</Sub>
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          {TYPE_OUTLIERS.map((size) => (
            <span key={size} style={{ fontSize: `${size}px`, lineHeight: 1 }} className="text-muted-foreground">
              {size}px
            </span>
          ))}
        </div>

        <Sub>Line-heights found (sample)</Sub>
        <div className="flex flex-wrap gap-3 font-mono text-xs text-muted-foreground">
          {LEADINGS.map((l) => <span key={l} className="rounded-sm border border-border px-2 py-1">leading {l}</span>)}
        </div>
      </Section>

      {/* 5 — Spacing & radii */}
      <Section
        n="05"
        title="Spacing & radii"
        note="No spacing or radii token scale exists. These are the distinct values found in components — the duplicates and near-duplicates (2 / 2.5 / 3px radii; 9 / 10 / 11px gaps) are the point."
      >
        <Sub>Radii (distinct values found)</Sub>
        <div className="flex flex-wrap gap-5">
          {RADII.map((r) => (
            <div key={r} className="flex flex-col items-center gap-1">
              <span className="h-16 w-16 border border-border bg-card" style={{ borderRadius: `${r}px` }} />
              <span className="font-mono text-xs text-muted-foreground">{r}px</span>
            </div>
          ))}
        </div>

        <Sub>Encoded radii — Phase 2a (control / card / pill)</Sub>
        <div className="flex flex-wrap gap-5">
          <div className="flex flex-col items-center gap-1"><span className="h-16 w-16 rounded-control border border-border bg-card" /><span className="font-mono text-xs text-muted-foreground">rounded-control · 8px</span></div>
          <div className="flex flex-col items-center gap-1"><span className="h-16 w-16 rounded-card border border-border bg-card" /><span className="font-mono text-xs text-muted-foreground">rounded-card · 14px</span></div>
          <div className="flex flex-col items-center gap-1"><span className="h-16 w-16 rounded-pill border border-border bg-card" /><span className="font-mono text-xs text-muted-foreground">rounded-pill · full</span></div>
        </div>

        <Sub>Spacing (distinct values found)</Sub>
        <div className="space-y-2">
          {SPACING.map((w) => (
            <div key={w} className="flex items-center gap-3">
              <span className="h-3 rounded-sm bg-primary" style={{ width: `${w}px` }} />
              <span className="font-mono text-xs text-muted-foreground">{w}px</span>
            </div>
          ))}
        </div>
      </Section>

      {/* 6 — Primitives */}
      <Section
        n="06"
        title="Primitives"
        note="Phase 2b added Card, Badge and Input + Button loading/active states, all reading the Phase-2a scales and one shared focus-visible ring. Dialog/Sheet and Toast stay deferred — under the ≥3-consumer build-to-demand bar."
      >
        <Sub>Button — variants</Sub>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Default</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
        </div>

        <Sub>Button — disabled</Sub>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled>Default</Button>
          <Button variant="outline" disabled>Outline</Button>
          <Button variant="ghost" disabled>Ghost</Button>
          <Button variant="link" disabled>Link</Button>
        </div>

        <Sub>Button — sizes (focus one with Tab to see the focus-visible ring)</Sub>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Add"><Plus size={16} /></Button>
        </div>

        <Sub>Button — loading + active (tap = background shift, not opacity)</Sub>
        <div className="flex flex-wrap items-center gap-3">
          <Button loading>Saving…</Button>
          <Button variant="outline" loading>Loading</Button>
          <Button variant="ghost" loading aria-label="Loading" />
        </div>

        <Sub>Card — variants (default / elevated / inset) + interactive</Sub>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4"><p className="text-body text-text-primary">default</p></Card>
          <Card variant="elevated" className="p-4"><p className="text-body text-text-primary">elevated</p></Card>
          <Card variant="inset" className="p-4"><p className="text-body text-text-primary">inset</p></Card>
          <Card interactive className="p-4"><p className="text-body text-text-primary">interactive — hover, focus (Tab), active</p></Card>
        </div>

        <Sub>Badge — semantic tones (value-category tones deferred to Phase 1)</Sub>
        <div className="flex flex-wrap items-center gap-3">
          <Badge>neutral</Badge>
          <Badge tone="gold">gold</Badge>
          <Badge tone="positive">positive</Badge>
          <Badge tone="negative">negative</Badge>
          <Badge tone="info">info</Badge>
        </div>

        <Sub>Input + Textarea — default · disabled · error (aria-invalid)</Sub>
        <div className="grid max-w-md grid-cols-1 gap-3">
          <Input placeholder="you@example.com" />
          <Input placeholder="Disabled" disabled />
          <Input placeholder="Invalid — aria-invalid" aria-invalid />
          <Textarea placeholder="Notes…" />
        </div>

        <Sub>Still deferred (≥3-consumer bar not met this session)</Sub>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {['Dialog / Sheet', 'Toast'].map((g) => <Gap key={g} name={g} />)}
        </div>
      </Section>

      {/* 7 — Representative molecules */}
      <Section
        n="07"
        title="Representative molecules"
        note="Real components with real props. The Briefing below renders Georgia ONLY because this styleguide route is outside (office)/ where Cormorant loads — in /office it renders Cormorant Garamond (no bug; the Phase-0 'Georgia bug' was this styleguide artifact). EmptyStates were collapsed in Phase 2c: one survivor shown in both CTA modes; dashboard/EmptyState stays fenced for session-32."
      >
        <Sub>Briefing</Sub>
        <Briefing accentColor={folderColors.cashflow}>
          You spent more on takeaways than on groceries last month — €214 vs €188. Not a crisis, but worth a glance.
        </Briefing>

        <Sub>DetailHeader</Sub>
        <DetailHeader title="Cash Flow" color={folderColors.cashflow} sub="Apr 2026" backHref="/styleguide" />

        <Sub>DrillDownRow</Sub>
        <div className="space-y-2">
          <DrillDownRow title="Transactions" subtitle="47 this month" href="/styleguide" icon="→" accentColor={folderColors.cashflow} />
          <DrillDownRow title="Recurring" subtitle="9 detected" href="/styleguide" icon="↻" accentColor={folderColors.values} />
        </div>

        <Sub>Stat-card grid — now Card + tokens + type scale (MetricTile deleted)</Sub>
        <div className="grid grid-cols-3 gap-3">
          <Card variant="inset" className="p-3">
            <p className="text-micro uppercase tracking-wider text-text-tertiary">INCOME</p>
            <p className="text-h2 font-semibold tabular-nums text-positive">€3,200</p>
          </Card>
          <Card variant="inset" className="p-3">
            <p className="text-micro uppercase tracking-wider text-text-tertiary">SPENDING</p>
            <p className="text-h2 font-semibold tabular-nums text-negative">€2,460</p>
          </Card>
          <Card variant="inset" className="p-3">
            <p className="text-micro uppercase tracking-wider text-text-tertiary">SURPLUS</p>
            <p className="text-h2 font-semibold tabular-nums text-accent-gold">€740</p>
          </Card>
        </div>

        <Sub>EmptyState — the single survivor (Phase 3b 6→1), shown in both CTA modes</Sub>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-md border border-border">
            <DashboardEmptyState
              icon={<Wallet size={20} />}
              body="No transactions yet — upload a statement to see your cash flow."
              actionLabel="Upload"
              actionHref="/styleguide"
              accent={folderColors.cashflow}
            />
            <p className="border-t border-border p-2 font-mono text-xs text-muted-foreground">link CTA (actionHref)</p>
          </div>
          <div className="rounded-md border border-border">
            <DashboardEmptyState
              title="Nothing here yet"
              body="The survivor also renders custom CTA content via children — e.g. the goal-flow chat button."
            >
              <p className="text-caption text-text-tertiary">children escape hatch</p>
            </DashboardEmptyState>
            <p className="border-t border-border p-2 font-mono text-xs text-muted-foreground">children CTA</p>
          </div>
          <div className="rounded-md border border-border">
            <DashboardEmptyState
              title="Nothing here yet"
              body="The survivor also renders Button CTAs (onAction) with an optional secondary action."
              actionLabel="Primary"
              onAction={() => {}}
              secondaryActionLabel="Secondary"
              onSecondaryAction={() => {}}
            />
            <p className="border-t border-border p-2 font-mono text-xs text-muted-foreground">DashboardEmptyState · button CTAs</p>
          </div>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          Phase 3b completed the 6→1 collapse: balance-sheet/EmptyState, bills/EmptyBillsState,
          dashboard/EmptyState and office/sections/GoalsEmptyState all fold into this survivor.
          The goal-flow chat CTA (GoalsEmptyStateCTA) is retained as a small client button leaf,
          passed via children — it is a chat trigger, not an empty-state container.
        </p>
      </Section>

      <footer className="border-t border-border pt-4 font-mono text-xs text-muted-foreground">
        <Scale size={14} className="mb-1 inline" /> Visual Consistency Phase 0 · identification only · no token was modified.
        <TrendingUp size={14} className="mx-2 inline" /> <Target size={14} className="inline" /> Phase 1 resolves the conflicts.
      </footer>
    </main>
  )
}

// Conflict-panel row: solid swatches per source. JS-value sources fill via
// inline style; the Tailwind-class source fills via currentColor so the chip
// matches the class colour without us writing a literal.
function ConflictRow({ row }: { row: (typeof CONFLICT_ROWS)[number] }) {
  return (
    <>
      <div className="bg-card p-3 text-muted-foreground">{row.src}</div>
      <div className="bg-card p-3"><ConflictChip cell={row.foundation} /></div>
      <div className="bg-card p-3"><ConflictChip cell={row.investment} /></div>
    </>
  )
}

function ConflictChip({ cell }: { cell: { kind: 'value' | 'class'; v: string } }) {
  if (cell.kind === 'class') {
    return (
      <span className={cell.v}>
        <span className="flex items-center gap-2">
          <span className="block h-8 w-12 rounded-md" style={{ background: 'currentColor' }} />
          <span className="text-xs">{cell.v}</span>
        </span>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-2">
      <span className="block h-8 w-12 rounded-md border border-border" style={{ background: cell.v }} />
      <span className="text-xs text-muted-foreground">{cell.v}</span>
    </span>
  )
}
