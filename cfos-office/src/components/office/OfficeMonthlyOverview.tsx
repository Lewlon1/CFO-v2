'use client'

import { useState } from 'react'
import { useDashboardData } from '@/lib/hooks/useDashboardData'

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

function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
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
        className="w-7 h-7 rounded-[6px] bg-[rgba(255,255,255,0.04)] flex items-center justify-center"
        disabled={!canPrev}
        style={{ opacity: canPrev ? 1 : 0.3 }}
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
          <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span className="font-data text-[11px] text-[rgba(245,245,240,0.6)] min-w-[70px] text-center">{label}</span>
      <button
        onClick={() => canNext && onChange(months[idx - 1])}
        className="w-7 h-7 rounded-[6px] bg-[rgba(255,255,255,0.04)] flex items-center justify-center"
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
            <div key={i} className="h-16 rounded-[8px] bg-[rgba(0,0,0,0.15)] animate-pulse" />
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
  const vsPctColor = vsPct != null && vsPct < 0 ? 'rgba(34,197,94,0.5)' : vsPct != null && vsPct > 0 ? 'rgba(243,63,94,0.5)' : 'rgba(245,245,240,0.25)'
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
        <div className="rounded-[8px] bg-[rgba(0,0,0,0.15)] px-[10px] py-[10px]">
          <p className="text-[9px] text-[rgba(245,245,240,0.3)] mb-[3px]">Income</p>
          <p className="font-data text-[16px] font-extrabold tracking-[-0.03em] text-[#22C55E]">{formatCurrency(total_income)}</p>
          <p className="font-data text-[8px] mt-[2px]" style={{ color: 'rgba(34,197,94,0.5)' }}>+0% vs prev</p>
        </div>
        <div className="rounded-[8px] bg-[rgba(0,0,0,0.15)] px-[10px] py-[10px]">
          <p className="text-[9px] text-[rgba(245,245,240,0.3)] mb-[3px]">Spent</p>
          <p className="font-data text-[16px] font-extrabold tracking-[-0.03em] text-text-primary">{formatCurrency(total_spending)}</p>
          {vsPct != null && <p className="font-data text-[8px] mt-[2px]" style={{ color: vsPctColor }}>{vsPctText}</p>}
        </div>
        <div className="rounded-[8px] bg-[rgba(0,0,0,0.15)] px-[10px] py-[10px]">
          <p className="text-[9px] text-[rgba(245,245,240,0.3)] mb-[3px]">{surplus_deficit >= 0 ? 'Surplus' : 'Deficit'}</p>
          <p className={`font-data text-[16px] font-extrabold tracking-[-0.03em] ${surplus_deficit >= 0 ? 'text-[#22C55E]' : 'text-[#F43F5E]'}`}>{formatCurrency(surplus_deficit)}</p>
        </div>
        <div className="rounded-[8px] bg-[rgba(0,0,0,0.15)] px-[10px] py-[10px]">
          <p className="text-[9px] text-[rgba(245,245,240,0.3)] mb-[3px]">Transactions</p>
          <p className="font-data text-[16px] font-extrabold tracking-[-0.03em] text-text-primary">{transaction_count}</p>
        </div>
      </div>

      {/* Provenance */}
      <div className="flex items-center gap-[3px] font-data text-[7px] text-[rgba(245,245,240,0.14)] mt-1 mb-3">
        <span className="w-[3px] h-[3px] rounded-full bg-[rgba(245,245,240,0.1)]" />
        {transaction_count} transactions
      </div>

      {/* Weekly spending bar chart */}
      <p className="text-[10px] font-bold text-[rgba(245,245,240,0.25)] tracking-[0.04em] uppercase mb-1.5">Weekly spending</p>
      <div className="relative h-[70px] mb-1">
        <div className="flex items-end gap-1 h-full relative z-[2]">
          {barRatios.map((r, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-[3px]"
              style={{
                height: `${r * 100}%`,
                backgroundColor: '#22C55E',
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
            borderTop: '1.5px dashed rgba(232,168,76,0.4)',
          }}
        />
        <span
          className="absolute right-0 z-[4] font-data text-[8px]"
          style={{
            bottom: '51px',
            color: 'rgba(232,168,76,0.5)',
          }}
        >
          avg {formatCurrency(weeklyAvg)}/wk
        </span>
      </div>

      {/* Category breakdown */}
      <p className="text-[10px] font-bold text-[rgba(245,245,240,0.25)] tracking-[0.04em] uppercase mt-3.5 mb-1.5">By category</p>
      {categories.map(([slug, cat]) => (
        <div key={slug} className="flex items-center gap-2 py-2 border-b border-[rgba(255,255,255,0.03)]">
          <span className="text-[13px] w-4 text-center shrink-0">{iconToEmoji(cat.icon)}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-text-primary">{cat.name}</p>
            <div className="h-[5px] rounded-[2.5px] mt-[3px] bg-[rgba(255,255,255,0.04)] overflow-hidden">
              <div
                className="h-full rounded-[2.5px]"
                style={{
                  width: `${(cat.amount / maxCat) * 100}%`,
                  backgroundColor: '#22C55E',
                }}
              />
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="font-data text-[11px] font-medium">{formatCurrency(cat.amount)}</p>
            <p className="font-data text-[8px] text-[rgba(245,245,240,0.3)]">{cat.pct?.toFixed(1) ?? '0'}%</p>
          </div>
        </div>
      ))}
    </div>
  )
}
