'use client'

import { useState } from 'react'
import { useDashboardData } from '@/lib/hooks/useDashboardData'

const VALUE_CONFIG = {
  foundation: { color: '#22C55E', label: 'Foundation', desc: 'Essentials, non-negotiable' },
  investment: { color: '#3B82F6', label: 'Investment', desc: 'Building future value' },
  leak: { color: '#F43F5E', label: 'Leak', desc: 'Avoidable, habitual drain' },
  burden: { color: '#8B5CF6', label: 'Burden', desc: 'Unavoidable but resented' },
  no_idea: { color: '#F59E0B', label: 'Unsure', desc: 'Not yet classified' },
} as const

type VCKey = keyof typeof VALUE_CONFIG

function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function ValueDonut({ segments, total }: { segments: { key: VCKey; pct: number }[]; total: number }) {
  // SVG donut chart — stroke-dasharray based
  const R = 15.9
  const C = 2 * Math.PI * R // ~100
  let offset = 25 // starting offset

  return (
    <div className="text-center">
      <svg width={120} height={120} viewBox="0 0 42 42" className="mx-auto mb-1.5 block">
        {/* Background ring */}
        <circle cx={21} cy={21} r={R} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={4} />
        {/* Segments */}
        {segments.map(seg => {
          const dash = (seg.pct / 100) * C
          const el = (
            <circle
              key={seg.key}
              cx={21}
              cy={21}
              r={R}
              fill="none"
              stroke={VALUE_CONFIG[seg.key].color}
              strokeWidth={4}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={offset}
              strokeLinecap="round"
            />
          )
          offset -= dash
          return el
        })}
        {/* Center text */}
        <text x={21} y={20} textAnchor="middle" fill="rgba(245,245,240,0.6)" fontFamily="JetBrains Mono" fontSize={4.5} fontWeight={500}>
          {formatCurrency(total)}
        </text>
        <text x={21} y={25} textAnchor="middle" fill="rgba(245,245,240,0.2)" fontFamily="JetBrains Mono" fontSize={2.5}>
          total spent
        </text>
      </svg>
    </div>
  )
}

export function OfficeValuesBreakdown() {
  const [month, setMonth] = useState<string | undefined>()
  const { summary, isLoading } = useDashboardData(month)

  if (isLoading) {
    return (
      <div className="px-3.5 pt-2 pb-24">
        <div className="h-[120px] w-[120px] mx-auto rounded-full bg-bg-deep animate-pulse mb-4" />
        <div className="space-y-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-8 bg-bg-deep rounded animate-pulse" />)}
        </div>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="px-3.5 pt-6 pb-24 text-center">
        <p className="text-[13px] text-text-secondary">Upload a statement to see your values breakdown.</p>
      </div>
    )
  }

  const vcData = summary.spending_by_value_category
  const valueOrder: VCKey[] = ['foundation', 'investment', 'leak', 'burden', 'no_idea']
  const segments = valueOrder
    .map(key => ({ key, pct: vcData[key]?.pct ?? 0, amount: vcData[key]?.amount ?? 0 }))
    .filter(s => s.pct > 0)

  // Summary text
  const dominant = segments[0]
  const dominantLabel = dominant ? VALUE_CONFIG[dominant.key].label.toLowerCase() : null

  // Top leaks — we don't have per-category value info, so just show the leak total
  const leakData = vcData['leak']
  const hasLeaks = leakData && leakData.amount > 0

  const unsureData = vcData['no_idea']
  const hasUnsure = unsureData && unsureData.amount > 0

  // Month selector
  const monthLabel = new Date(summary.month).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }).toUpperCase()
  const months = summary.available_months
  const idx = months.indexOf(summary.month)

  return (
    <div className="px-3.5 pt-2 pb-24">
      {/* Month selector */}
      <div className="flex items-center justify-center gap-3.5 mb-3">
        <button
          onClick={() => idx < months.length - 1 && setMonth(months[idx + 1])}
          className="w-7 h-7 rounded-[6px] bg-[rgba(255,255,255,0.04)] flex items-center justify-center"
          style={{ opacity: idx < months.length - 1 ? 1 : 0.3 }}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="font-data text-[11px] text-[rgba(245,245,240,0.6)] min-w-[70px] text-center">{monthLabel}</span>
        <button
          onClick={() => idx > 0 && setMonth(months[idx - 1])}
          className="w-7 h-7 rounded-[6px] bg-[rgba(255,255,255,0.04)] flex items-center justify-center"
          style={{ opacity: idx > 0 ? 1 : 0.3 }}
        >
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Donut chart */}
      <ValueDonut segments={segments} total={summary.total_spending} />

      {/* Summary text */}
      {dominantLabel && (
        <p className="text-[13px] text-center text-[rgba(245,245,240,0.55)] mb-3.5 leading-[1.5]">
          Your money is mostly <span style={{ color: VALUE_CONFIG[segments[0].key].color }}>{dominantLabel}</span>.
          {segments.find(s => s.key === 'leak') && (
            <> But {segments.find(s => s.key === 'leak')!.pct.toFixed(0)}% goes to things you&apos;d cut if you could.</>
          )}
        </p>
      )}

      {/* Value rows */}
      {segments.map(seg => (
        <div key={seg.key} className="flex items-center gap-2 py-2 border-b border-[rgba(255,255,255,0.03)]">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: VALUE_CONFIG[seg.key].color }} />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold">{VALUE_CONFIG[seg.key].label}</p>
            <p className="text-[10px] text-[rgba(245,245,240,0.3)] mt-[1px]">{VALUE_CONFIG[seg.key].desc}</p>
          </div>
          <span className="font-data text-[13px] font-medium shrink-0" style={{ color: VALUE_CONFIG[seg.key].color }}>
            {seg.pct.toFixed(0)}%
          </span>
        </div>
      ))}

      {/* Provenance */}
      <div className="flex items-center gap-[3px] font-data text-[7px] text-[rgba(245,245,240,0.14)] mt-2.5">
        <span className="w-[3px] h-[3px] rounded-full bg-[rgba(245,245,240,0.1)]" />
        {summary.transaction_count} transactions
      </div>

      {/* Top leaks summary */}
      {hasLeaks && (
        <>
          <p className="text-[10px] font-bold text-[rgba(245,245,240,0.25)] tracking-[0.04em] uppercase mt-4 mb-1.5">
            Leaks this month
          </p>
          <div className="flex items-center gap-2 py-2.5 border-b border-[rgba(255,255,255,0.03)]">
            <div className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[12px] shrink-0 bg-[rgba(243,63,94,0.1)] text-[#F43F5E]">
              ↻
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium">Total leaks</p>
              <p className="font-data text-[8px] text-[rgba(245,245,240,0.22)] mt-[2px]">{leakData.count} transactions</p>
            </div>
            <span className="font-data text-[12px] font-medium text-[#F43F5E] shrink-0">
              -{formatCurrency(leakData.amount)}
            </span>
          </div>
        </>
      )}

      {/* Unsure summary */}
      {hasUnsure && (
        <>
          <p className="text-[10px] font-bold text-[rgba(245,245,240,0.25)] tracking-[0.04em] uppercase mt-4 mb-1.5">
            Unsure this month
          </p>
          <div className="flex items-center gap-2 py-2.5 border-b border-[rgba(255,255,255,0.03)]">
            <div className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[12px] shrink-0 bg-[rgba(245,158,11,0.1)] text-[#F59E0B]">
              ?
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium">Not yet classified</p>
              <p className="font-data text-[8px] text-[rgba(245,245,240,0.22)] mt-[2px]">{unsureData.count} transactions</p>
            </div>
            <span className="font-data text-[12px] font-medium text-[#F59E0B] shrink-0">
              -{formatCurrency(unsureData.amount)}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
