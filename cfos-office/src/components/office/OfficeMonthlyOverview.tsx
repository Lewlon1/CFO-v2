'use client'

import { useState } from 'react'
import { useDashboardData } from '@/lib/hooks/useDashboardData'
import { formatCurrencyRounded } from '@/lib/utils/format-currency-rounded'
import { colors } from '@/lib/tokens'

// Theme-reactive alpha helpers (Phase 3b) — replace the frozen white/colour
// alpha chrome that didn't adapt to light theme. color-mix keeps the tint
// reactive to the underlying token in both themes.
const positiveSoft = 'color-mix(in oklab, var(--positive) 50%, transparent)'
const negativeSoft = 'color-mix(in oklab, var(--negative) 50%, transparent)'

const ICON_EMOJI: Record<string, string> = {
  'shopping-basket': '🛒',
  'shopping-bag': '🛍',
  utensils: '🍽',
  train: '🚌',
  plane: '✈️',
  'gamepad-2': '🎮',
  'heart-pulse': '💊',
  zap: '⚡',
  home: '🏠',
  smartphone: '📱',
  circle: '📋',
}

function iconToEmoji(icon: string): string {
  return ICON_EMOJI[icon] ?? '📋'
}

function MonthSelector({ months, current, onChange }: {
  months: string[]
  current: string
  onChange: (m: string) => void
}) {
  const idx = months.indexOf(current)
  const canPrev = idx < months.length - 1
  const canNext = idx > 0
  const label = new Date(current).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }).toUpperCase()

  return (
    <div className="flex items-center justify-center gap-3.5 mb-3">
      <button
        onClick={() => canPrev && onChange(months[idx + 1])}
        className="w-7 h-7 rounded-control bg-muted flex items-center justify-center"
        disabled={!canPrev}
        style={{ opacity: canPrev ? 1 : 0.3 }}
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
          <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span className="font-data text-[11px] text-text-secondary min-w-[70px] text-center">{label}</span>
      <button
        onClick={() => canNext && onChange(months[idx - 1])}
        className="w-7 h-7 rounded-control bg-muted flex items-center justify-center"
        disabled={!canNext}
        style={{ opacity: canNext ? 1 : 0.3 }}
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}

export function OfficeMonthlyOverview() {
  const [month, setMonth] = useState<string | undefined>()
  const { summary, isLoading } = useDashboardData(month)

  if (isLoading) {
    return (
      <div className="px-3.5 pt-2 pb-24">
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-16 rounded-control bg-bg-inset animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="px-3.5 pt-6 pb-24 text-center">
        <p className="text-[13px] text-text-secondary">No data yet. Upload a statement to see your monthly overview.</p>
      </div>
    )
  }

  const { total_income, total_spending, surplus_deficit, transaction_count, spending_by_category, vs_previous_month_pct } = summary

  const categories = Object.entries(spending_by_category)
    .sort(([, a], [, b]) => b.amount - a.amount)
    .slice(0, 6)
  const maxCat = categories[0]?.[1]?.amount ?? 1

  // Weekly approximation (proportional heights)
  const weeklyAvg = total_spending / 4
  const barRatios = [0.55, 0.85, 1, 0.42]

  const vsPct = vs_previous_month_pct != null ? vs_previous_month_pct : null
  const vsPctColor = vsPct != null && vsPct < 0 ? positiveSoft : vsPct != null && vsPct > 0 ? negativeSoft : colors.textTertiary
  const vsPctText = vsPct != null ? `${vsPct > 0 ? '+' : ''}${Math.round(vsPct)}% vs prev` : ''

  return (
    <div className="px-3.5 pt-2 pb-24">
      {summary.available_months.length > 0 && (
        <MonthSelector
          months={summary.available_months}
          current={summary.month}
          onChange={setMonth}
        />
      )}

      {/* Metric grid */}
      <div className="grid grid-cols-2 gap-1.5 mb-1.5">
        <div className="rounded-control bg-bg-inset px-[10px] py-[10px]">
          <p className="text-[9px] text-text-tertiary mb-[3px]">Income</p>
          <p className="font-data text-[16px] font-extrabold tracking-[-0.03em] text-positive">{formatCurrencyRounded(total_income)}</p>
          <p className="font-data text-[8px] mt-[2px]" style={{ color: positiveSoft }}>+0% vs prev</p>
        </div>
        <div className="rounded-control bg-bg-inset px-[10px] py-[10px]">
          <p className="text-[9px] text-text-tertiary mb-[3px]">Spent</p>
          <p className="font-data text-[16px] font-extrabold tracking-[-0.03em] text-text-primary">{formatCurrencyRounded(total_spending)}</p>
          {vsPct != null && <p className="font-data text-[8px] mt-[2px]" style={{ color: vsPctColor }}>{vsPctText}</p>}
        </div>
        <div className="rounded-control bg-bg-inset px-[10px] py-[10px]">
          <p className="text-[9px] text-text-tertiary mb-[3px]">{surplus_deficit >= 0 ? 'Surplus' : 'Deficit'}</p>
          <p className={`font-data text-[16px] font-extrabold tracking-[-0.03em] ${surplus_deficit >= 0 ? 'text-positive' : 'text-negative'}`}>{formatCurrencyRounded(surplus_deficit)}</p>
        </div>
        <div className="rounded-control bg-bg-inset px-[10px] py-[10px]">
          <p className="text-[9px] text-text-tertiary mb-[3px]">Transactions</p>
          <p className="font-data text-[16px] font-extrabold tracking-[-0.03em] text-text-primary">{transaction_count}</p>
        </div>
      </div>

      {/* Provenance */}
      <div className="flex items-center gap-[3px] font-data text-[7px] text-text-ghost mt-1 mb-3">
        <span className="w-[3px] h-[3px] rounded-full bg-card" />
        {transaction_count} transactions
      </div>

      {/* Weekly spending bar chart */}
      <p className="text-[10px] font-bold text-text-muted tracking-[0.04em] uppercase mb-1.5">Weekly spending</p>
      <div className="relative h-[70px] mb-1">
        <div className="flex items-end gap-1 h-full relative z-[2]">
          {barRatios.map((r, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-[3px]"
              style={{
                height: `${r * 100}%`,
                backgroundColor: colors.positive,
                opacity: 0.6 + r * 0.4,
              }}
            />
          ))}
        </div>
        {/* Average line at ~mean of ratios */}
        <div
          className="absolute left-0 right-0 z-[3]"
          style={{
            bottom: '49px',
            borderTop: `1.5px dashed ${colors.goldSoft}`,
          }}
        />
        <span
          className="absolute right-0 z-[4] font-data text-[8px]"
          style={{
            bottom: '51px',
            color: colors.goldSoft,
          }}
        >
          avg {formatCurrencyRounded(weeklyAvg)}/wk
        </span>
      </div>

      {/* Category breakdown */}
      <p className="text-[10px] font-bold text-text-muted tracking-[0.04em] uppercase mt-3.5 mb-1.5">By category</p>
      {categories.map(([slug, cat]) => (
        <div key={slug} className="flex items-center gap-2 py-2 border-b border-border-subtle">
          <span className="text-[13px] w-4 text-center shrink-0">{iconToEmoji(cat.icon)}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-text-primary">{cat.name}</p>
            <div className="h-[5px] rounded-pill mt-[3px] bg-muted overflow-hidden">
              <div
                className="h-full rounded-pill"
                style={{
                  width: `${(cat.amount / maxCat) * 100}%`,
                  backgroundColor: colors.positive,
                }}
              />
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="font-data text-[11px] font-medium">{formatCurrencyRounded(cat.amount)}</p>
            <p className="font-data text-[8px] text-text-tertiary">{cat.pct?.toFixed(1) ?? '0'}%</p>
          </div>
        </div>
      ))}
    </div>
  )
}
