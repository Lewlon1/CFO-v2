'use client'

import { useEffect } from 'react'
import { ArrowRight } from 'lucide-react'
import { useDashboardData } from '@/lib/hooks/useDashboardData'
import { Briefing } from './Briefing'
import { DetailHeader } from './DetailHeader'
import { DrillDownRow } from './DrillDownRow'
import { useTrackEvent } from '@/lib/events/use-track-event'

const ACCENT = '#E8A84C'

const VALUE_META: Record<string, { label: string; color: string; order: number }> = {
  foundation: { label: 'Foundation', color: '#22C55E', order: 1 },
  investment: { label: 'Investment', color: '#3B82F6', order: 2 },
  leak: { label: 'Leak', color: '#F43F5E', order: 3 },
  burden: { label: 'Burden', color: '#8B5CF6', order: 4 },
  no_idea: { label: 'Unclassified', color: '#6B7280', order: 5 },
}

function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export interface ValuesDashboardGap {
  label: string
  narrative: string
}

interface ValuesDashboardProps {
  currency: string
  archetype: {
    name: string | null
    subtitle: string | null
    traits: string[]
    version: number | null
  } | null
  gaps: ValuesDashboardGap[]
  profileCompleteness: number
}

export function ValuesDashboard({
  currency,
  archetype,
  gaps,
  profileCompleteness,
}: ValuesDashboardProps) {
  const trackEvent = useTrackEvent()
  const { summary, isLoading } = useDashboardData()

  useEffect(() => {
    trackEvent('values_dashboard_viewed', 'engagement')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="px-3.5 pt-2 pb-24">
      <DetailHeader title="Values & You" color={ACCENT} backHref="/office" />

      <Briefing accentColor={ACCENT}>
        {buildBriefing(archetype, gaps)}
      </Briefing>

      {archetype?.name && (
        <ArchetypeCard archetype={archetype} profileCompleteness={profileCompleteness} />
      )}

      {isLoading ? (
        <div className="h-24 rounded-[10px] bg-bg-deep animate-pulse mb-4" />
      ) : (
        <ValueBreakdown summary={summary} currency={currency} />
      )}

      {gaps.length > 0 && <GapsList gaps={gaps} />}

      <div className="flex flex-col gap-2">
        <DrillDownRow
          title="Your archetype"
          subtitle="profile · financial personality"
          href="/office/values/archetype"
          icon="☆"
          accentColor={ACCENT}
        />
        <DrillDownRow
          title="Values breakdown"
          subtitle="dashboard · this month"
          href="/office/values/value-split"
          icon="◈"
          accentColor={ACCENT}
        />
        <DrillDownRow
          title="The Gap"
          subtitle="analysis · belief vs reality"
          href="/office/values/the-gap"
          icon="◎"
          accentColor={ACCENT}
        />
        <DrillDownRow
          title="What your CFO knows"
          subtitle="transparency · view & edit"
          href="/office/values/portrait"
          icon="◇"
          accentColor={ACCENT}
        />
        <DrillDownRow
          title="Export your data"
          subtitle="download · profile + transactions"
          href="/office/values/export"
          icon="⇣"
          accentColor={ACCENT}
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function buildBriefing(
  archetype: ValuesDashboardProps['archetype'],
  gaps: ValuesDashboardGap[],
): string {
  if (!archetype?.name) {
    return `I don't have your archetype yet. Finish the Value Map and I can tell you how your spending lines up with what you say matters.`
  }
  if (gaps.length === 0) {
    return `You're ${archetype.name}. I haven't spotted any Gaps between what you said matters and what your money is actually doing. That's rare — keep it up.`
  }
  const plural = gaps.length === 1 ? 'Gap' : 'Gaps'
  return `You're ${archetype.name}. I found ${gaps.length} ${plural} where your words and your spending disagree — worth a look.`
}

// ─────────────────────────────────────────────────────────────────────────────

function ArchetypeCard({
  archetype,
  profileCompleteness,
}: {
  archetype: NonNullable<ValuesDashboardProps['archetype']>
  profileCompleteness: number
}) {
  const firstTwo = archetype.traits.slice(0, 4)

  return (
    <div
      className="rounded-[12px] mb-4 px-[14px] py-[16px]"
      style={{
        background: `linear-gradient(160deg, ${ACCENT}12 0%, var(--bg-card) 60%)`,
        border: `0.5px solid ${ACCENT}40`,
      }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-11 h-11 rounded-[10px] flex items-center justify-center text-[22px]"
          style={{
            background: `${ACCENT}20`,
            border: `1px solid ${ACCENT}`,
            color: ACCENT,
            fontFamily: 'var(--font-cormorant), Georgia, serif',
          }}
        >
          ⚓
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: ACCENT }}
          >
            Your archetype
          </div>
          <div
            className="text-[22px] leading-tight tracking-[-0.01em] text-text-primary truncate"
            style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}
          >
            {archetype.name}
          </div>
        </div>
        <div
          className="px-[10px] py-[4px] rounded-[12px] text-[10px] font-semibold shrink-0"
          style={{
            background: `${ACCENT}20`,
            border: `0.5px solid ${ACCENT}40`,
            color: ACCENT,
          }}
        >
          {Math.round(profileCompleteness)}% profiled
        </div>
      </div>
      {firstTwo.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {firstTwo.map((t) => (
            <span
              key={t}
              className="text-[11px] px-2 py-1 rounded-full border"
              style={{
                color: 'var(--text-secondary)',
                borderColor: 'rgba(255,255,255,0.06)',
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function ValueBreakdown({
  summary,
  currency,
}: {
  summary: ReturnType<typeof useDashboardData>['summary']
  currency: string
}) {
  const order: Array<keyof typeof VALUE_META> = ['foundation', 'investment', 'leak', 'burden']
  const entries = order
    .map((key) => {
      const vc = summary?.spending_by_value_category?.[key]
      return vc && vc.pct > 0
        ? { key, amount: vc.amount, pct: vc.pct, meta: VALUE_META[key] }
        : null
    })
    .filter((v): v is { key: keyof typeof VALUE_META; amount: number; pct: number; meta: typeof VALUE_META[string] } => !!v)

  if (entries.length === 0) return null

  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-[10px]">
        <div className="text-[11px] font-semibold text-text-primary">Spending, by meaning</div>
        <div className="text-[10px] text-text-tertiary italic">
          {summary?.month
            ? new Date(summary.month).toLocaleDateString('en-GB', { month: 'long' })
            : 'this month'}
        </div>
      </div>
      <div className="flex h-2 rounded-[4px] overflow-hidden mb-[10px]">
        {entries.map((e) => (
          <div key={e.key} style={{ width: `${e.pct}%`, background: e.meta.color }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {entries.map((e) => (
          <div key={e.key} className="flex items-center gap-[7px]">
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: e.meta.color }} />
            <span className="text-[11px] text-text-secondary flex-1">{e.meta.label}</span>
            <span className="font-data text-[11px] text-text-primary tabular-nums">
              {formatCurrency(e.amount, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function GapsList({ gaps }: { gaps: ValuesDashboardGap[] }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-[10px]">
        <div className="text-[11px] font-semibold text-text-primary">The Gap · belief vs reality</div>
        <a
          href="/office/values/the-gap"
          className="text-[10px] flex items-center gap-0.5"
          style={{ color: ACCENT }}
        >
          {gaps.length} active <ArrowRight size={10} strokeWidth={2} />
        </a>
      </div>
      <div className="flex flex-col gap-2">
        {gaps.slice(0, 3).map((g, i) => (
          <div
            key={`${g.label}-${i}`}
            className="rounded-[8px] px-3 py-[11px] bg-bg-card border border-[rgba(255,255,255,0.04)]"
          >
            <div className="text-[12px] font-semibold text-text-primary truncate">{g.label}</div>
            <div className="text-[10.5px] text-text-tertiary mt-1 leading-[1.4]">{g.narrative}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default ValuesDashboard
