'use client'

import { useEffect } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { Upload, ArrowRight } from 'lucide-react'
import { useDashboardData } from '@/lib/hooks/useDashboardData'
import { Briefing } from './Briefing'
import { DashboardEmptyState } from './DashboardEmptyState'
import { DetailHeader } from './DetailHeader'
import { DrillDownRow } from './DrillDownRow'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { formatCurrencyRounded, formatMonthShort } from '@/lib/utils/format-currency-rounded'
import { folderColors } from '@/lib/tokens'
import type { TrendsResponse } from '@/app/api/dashboard/trends/route'
import { IncomeShapeBadge } from '@/components/dev/IncomeShapeBadge'
import { getTransformPosture, type PostureProfile } from '@/lib/analytics/posture-helpers'
import type { FinancialPosture } from '@/lib/analytics/posture'
import type { BalanceTrajectory } from '@/lib/analytics/cashflow-aggregates'

const ACCENT = folderColors.cashflow

interface IncomeShapeData {
  income_shape: string | null
  income_volatility: number | null
  income_shape_deposit_count: number | null
  financial_posture: FinancialPosture | null
  posture_confidence: number | null
  runway_days: number | null
  t3m_income_monthly: number | null
  t3m_spend_monthly: number | null
  balance_trajectory: BalanceTrajectory | null
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed')
  return res.json() as Promise<TrendsResponse>
}

const shapeFetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed')
  return res.json() as Promise<IncomeShapeData>
}

interface CashFlowDashboardProps {
  currency: string
}

export function CashFlowDashboard({ currency }: CashFlowDashboardProps) {
  const trackEvent = useTrackEvent()
  const { summary, isLoading } = useDashboardData()
  const { data: trends } = useSWR<TrendsResponse>('/api/dashboard/trends?months=6', fetcher)
  const { data: incomeShape } = useSWR<IncomeShapeData>('/api/profile/income-shape', shapeFetcher)

  useEffect(() => {
    trackEvent('cashflow_dashboard_viewed', 'engagement')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const monthLabel = summary?.month
    ? new Date(summary.month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : undefined

  return (
    <div className="px-3.5 pt-2 pb-24">
      <DetailHeader title="Cash Flow" color={ACCENT} sub={monthLabel} backHref="/office" />

      {isLoading ? (
        <div className="space-y-3">
          <div className="h-24 rounded-[10px] bg-bg-deep animate-pulse" />
          <div className="h-40 rounded-[10px] bg-bg-deep animate-pulse" />
        </div>
      ) : !summary ? (
        <DashboardEmptyState
          icon={<Upload size={18} className="text-text-muted" />}
          body="Upload a recent bank statement and your CFO can start showing you what's going on."
          actionLabel="Upload →"
          actionHref="/office/cash-flow/upload"
          accent={ACCENT}
        />
      ) : (
        <>
          <div className="mb-2">
            <IncomeShapeBadge data={incomeShape ?? null} />
          </div>

          <PostureHero data={incomeShape ?? null} currency={currency} />

          <Briefing accentColor={ACCENT}>
            {buildBriefing(summary, currency)}
          </Briefing>

          <MetricsRow summary={summary} currency={currency} />

          {trends && trends.months.length > 1 && (
            <TrendBars months={trends.months} currency={currency} />
          )}

          <CategoryBreakdown summary={summary} currency={currency} />

          <DrillDowns
            posture={incomeShape ?? null}
            summary={summary}
            currency={currency}
          />

          <Link
            href="/office/cash-flow/upload"
            className="flex items-center justify-center gap-2 min-h-[44px] rounded-[10px] px-3.5 py-2.5 text-[12px] font-medium"
            style={{
              border: `0.5px dashed ${ACCENT}`,
              color: ACCENT,
            }}
          >
            <Upload size={12} strokeWidth={2} />
            Share another statement
          </Link>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function buildBriefing(
  summary: NonNullable<ReturnType<typeof useDashboardData>['summary']>,
  currency: string,
): string {
  const amount = formatCurrencyRounded(summary.total_spending, currency)
  const delta = summary.vs_previous_month_pct
  const isFirstMonth = (summary.available_months?.length ?? 1) <= 1
  if (delta == null) {
    if (isFirstMonth) {
      return `You spent ${amount} across ${summary.transaction_count} transactions. First full month — I'll start looking for patterns.`
    }
    // Multi-month user but no comparable prior figure (e.g. previous month
    // had €0 spending). Don't fake a "first month" — just state the facts.
    return `You spent ${amount} across ${summary.transaction_count} transactions this month.`
  }
  if (Math.abs(delta) < 3) {
    return `You spent ${amount} this month, roughly in line with last month. Steady — but that's also how creep hides.`
  }
  const direction = delta > 0 ? 'over' : 'under'
  return `You spent ${amount} this month, ${Math.abs(Math.round(delta))}% ${direction} last. ${
    delta > 0
      ? 'Worth a look at what moved.'
      : 'Nice result — let me know if it was deliberate.'
  }`
}

// ─────────────────────────────────────────────────────────────────────────────

function MetricsRow({
  summary,
  currency,
}: {
  summary: NonNullable<ReturnType<typeof useDashboardData>['summary']>
  currency: string
}) {
  const delta = summary.vs_previous_month_pct
  const prevDelta =
    delta != null && Math.abs(delta) >= 0.5
      ? summary.total_spending - summary.total_spending / (1 + delta / 100)
      : null
  const metrics = [
    {
      label: 'Spent',
      value: formatCurrencyRounded(summary.total_spending, currency),
      sub: `${summary.transaction_count} txns`,
      color: 'var(--text-primary)',
    },
    {
      label: 'vs prev',
      value: prevDelta != null
        ? `${prevDelta > 0 ? '+' : '−'}${formatCurrencyRounded(Math.abs(Math.round(prevDelta)), currency)}`
        : '—',
      sub: delta != null ? `${Math.round(delta)}% ${delta >= 0 ? 'up' : 'down'}` : 'no baseline',
      color: delta != null && delta > 0 ? 'var(--negative)' : delta != null && delta < 0 ? 'var(--positive)' : 'var(--text-secondary)',
    },
    {
      label: 'Net',
      value: `${summary.surplus_deficit >= 0 ? '+' : '−'}${formatCurrencyRounded(Math.abs(summary.surplus_deficit), currency)}`,
      sub: summary.total_income > 0 ? 'income − spend' : 'no income this month',
      color: 'var(--text-secondary)',
    },
  ]

  return (
    <div className="flex gap-2 mb-4">
      {metrics.map((m) => (
        <div
          key={m.label}
          className="flex-1 min-w-0 rounded-[8px] px-2.5 py-2.5 bg-bg-card border border-[rgba(255,255,255,0.04)]"
        >
          <div
            className="text-[9px] font-semibold uppercase tracking-[0.12em] text-text-tertiary"
          >
            {m.label}
          </div>
          <div
            className="font-data text-[14px] mt-1 font-medium tabular-nums truncate"
            style={{ color: m.color }}
          >
            {m.value}
          </div>
          <div className="text-[9.5px] text-text-tertiary mt-0.5 truncate">{m.sub}</div>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function TrendBars({
  months,
  currency,
}: {
  months: TrendsResponse['months']
  currency: string
}) {
  const max = Math.max(...months.map((m) => m.total_spending))
  const latest = months[months.length - 1]

  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-[10px]">
        <div className="text-[11px] font-semibold text-text-primary">Monthly spend · {months.length} months</div>
        <div className="text-[10px] text-text-tertiary italic">
          latest {formatCurrencyRounded(latest?.total_spending ?? 0, currency)}
        </div>
      </div>
      <div className="flex items-end gap-[5px] h-[54px]">
        {months.map((m, i) => {
          const isNow = i === months.length - 1
          const h = max > 0 ? (m.total_spending / max) * 100 : 0
          return (
            <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full rounded-[2px]"
                style={{
                  height: `${Math.max(h, 4)}%`,
                  background: isNow ? ACCENT : 'rgba(255,255,255,0.08)',
                }}
              />
              <div
                className="text-[9px]"
                style={{ color: isNow ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
              >
                {formatMonthShort(m.month)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function CategoryBreakdown({
  summary,
  currency,
}: {
  summary: NonNullable<ReturnType<typeof useDashboardData>['summary']>
  currency: string
}) {
  const all = Object.entries(summary.spending_by_category)
    .map(([slug, cat]) => ({
      slug,
      name: cat.name,
      amount: cat.amount,
      pct: cat.pct,
      color: cat.color?.startsWith('#') ? cat.color : '#888',
    }))
    .sort((a, b) => b.amount - a.amount)

  if (all.length === 0) return null

  const visible = all.slice(0, 6)
  const topSlice = all.slice(0, 7)
  const other = all.slice(7).reduce((sum, c) => sum + c.pct, 0)

  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-[10px]">
        <div className="text-[11px] font-semibold text-text-primary">Where it went</div>
        <Link
          href="/office/cash-flow/spending-breakdown"
          className="text-[10px] flex items-center gap-0.5"
          style={{ color: ACCENT }}
        >
          All {all.length} <ArrowRight size={10} strokeWidth={2} />
        </Link>
      </div>
      <div className="flex h-2 rounded-[4px] overflow-hidden mb-3">
        {topSlice.map((c) => (
          <div key={c.slug} style={{ width: `${c.pct}%`, background: c.color }} />
        ))}
        {other > 0 && <div style={{ width: `${other}%`, background: 'rgba(255,255,255,0.08)' }} />}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {visible.map((c) => (
          <div key={c.slug} className="flex items-center gap-[7px]">
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.color }} />
            <span className="text-[11px] text-text-secondary flex-1 truncate">{c.name}</span>
            <span className="font-data text-[11px] text-text-primary tabular-nums">
              {formatCurrencyRounded(c.amount, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Posture-aware hero. Renders nothing for stable/unknown/low-confidence users —
// the existing Briefing/MetricsRow stack remains the headline in those cases.
// If a required field is null when the transform fires, render nothing — no
// half-rendered transforms.

function PostureHero({ data, currency }: { data: IncomeShapeData | null; currency: string }) {
  const profile: PostureProfile = {
    financial_posture: data?.financial_posture ?? null,
    posture_confidence: data?.posture_confidence ?? null,
  }
  const transform = getTransformPosture(profile)
  if (!transform) return null

  if (transform === 'surviving') {
    if (data?.runway_days == null) return null
    return (
      <div className="mb-3">
        <div className="font-data text-[28px] tabular-nums text-text-primary leading-tight">
          Runway: {data.runway_days} days
        </div>
        <div className="text-[11px] text-text-secondary mt-0.5">
          {trajectoryCopy(data.balance_trajectory)}
        </div>
      </div>
    )
  }

  // planning
  if (data?.t3m_income_monthly == null || data?.t3m_spend_monthly == null) return null
  const t3mNet = Math.round((data.t3m_income_monthly - data.t3m_spend_monthly) * 3)
  const sign = t3mNet >= 0 ? '+' : '−'
  return (
    <div className="mb-3">
      <div className="font-data text-[28px] tabular-nums text-text-primary leading-tight">
        Last 3 months: {sign}{formatCurrencyRounded(Math.abs(t3mNet), currency)} net
      </div>
      <div className="text-[11px] text-text-secondary mt-0.5">
        T3M income {formatCurrencyRounded(Math.round(data.t3m_income_monthly), currency)}/mo,
        spend {formatCurrencyRounded(Math.round(data.t3m_spend_monthly), currency)}/mo.
      </div>
    </div>
  )
}

function trajectoryCopy(t: BalanceTrajectory | null | undefined): string {
  if (t === 'growing') return 'Balance trending up over the last 3 months.'
  if (t === 'growing_slowly') return 'Balance edging up.'
  if (t === 'flat') return 'Balance flat across the last 3 months.'
  if (t === 'shrinking') return 'Balance shrinking — watch this.'
  return ''
}

// ─────────────────────────────────────────────────────────────────────────────
// Drill-down list with posture-aware ordering. Card configs are stable;
// only render order changes per posture. Stable / unknown / below-threshold
// fall through to the default order.

type DrillDownKey = 'monthly-overview' | 'bills' | 'spending-breakdown' | 'patterns' | 'transactions'

function DrillDowns({
  posture,
  summary,
  currency,
}: {
  posture: IncomeShapeData | null
  summary: NonNullable<ReturnType<typeof useDashboardData>['summary']>
  currency: string
}) {
  const profile: PostureProfile = {
    financial_posture: posture?.financial_posture ?? null,
    posture_confidence: posture?.posture_confidence ?? null,
  }
  const transform = getTransformPosture(profile)

  const cards: Record<DrillDownKey, { title: string; subtitle: string; href: string; icon: string }> = {
    'monthly-overview': {
      title: 'Monthly overview',
      subtitle: 'dashboard · this month',
      href: '/office/cash-flow/monthly-overview',
      icon: '◉',
    },
    bills: {
      title: 'Bills & subscriptions',
      subtitle: summary.recurring?.items?.length
        ? `${summary.recurring.items.length} recurring · ${formatCurrencyRounded(summary.recurring.monthly_total, currency)} / month`
        : 'tracker · known providers',
      href: '/office/cash-flow/bills',
      icon: '↻',
    },
    'spending-breakdown': {
      title: 'Spending breakdown',
      subtitle: 'dashboard · by category',
      href: '/office/cash-flow/spending-breakdown',
      icon: '⊞',
    },
    patterns: {
      title: 'Spending patterns',
      subtitle: 'insights · regular habits',
      href: '/office/cash-flow/patterns',
      icon: '◈',
    },
    transactions: {
      title: 'All transactions',
      subtitle: `${summary.transaction_count} this month · searchable`,
      href: '/office/cash-flow/transactions',
      icon: '≡',
    },
  }

  const order: DrillDownKey[] = (() => {
    if (transform === 'surviving') {
      // Bills first — subscription audit IS survival here.
      return ['bills', 'monthly-overview', 'spending-breakdown', 'patterns', 'transactions']
    }
    if (transform === 'planning') {
      // Most analytical card first.
      return ['patterns', 'spending-breakdown', 'monthly-overview', 'bills', 'transactions']
    }
    return ['monthly-overview', 'bills', 'spending-breakdown', 'patterns', 'transactions']
  })()

  return (
    <div className="flex flex-col gap-2 mb-4">
      {order.map((key) => {
        const c = cards[key]
        return (
          <DrillDownRow
            key={key}
            title={c.title}
            subtitle={c.subtitle}
            href={c.href}
            icon={c.icon}
            accentColor={ACCENT}
          />
        )
      })}
    </div>
  )
}

export default CashFlowDashboard
