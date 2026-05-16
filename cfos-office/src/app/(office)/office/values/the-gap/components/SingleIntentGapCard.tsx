'use client'

import type { SingleIntentGapV2 } from '@/lib/analytics/gap-analyser'
import { formatCurrencyRounded } from '@/lib/utils/format-currency-rounded'
import { QUADRANT_COLOURS, QUADRANT_LABELS } from './quadrant-tokens'

export interface SingleIntentGapCardProps {
  gap: SingleIntentGapV2
  currency: string
}

export function SingleIntentGapCard({ gap, currency }: SingleIntentGapCardProps) {
  const quadrant = gap.stated_quadrant
  const colour = QUADRANT_COLOURS[quadrant]
  const monthly = Math.round(gap.actual_monthly_spend)
  const share = Math.round(gap.pct_of_total_spending)

  return (
    <div
      className="rounded-lg p-4 mb-3.5"
      style={{
        background: 'var(--office-bg-secondary)',
        border: '1px solid var(--office-border)',
      }}
    >
      {/* Header row: category name + monthly + share-of-spend */}
      <div className="flex items-baseline justify-between mb-2.5">
        <div
          className="text-[20px] leading-tight"
          style={{
            fontFamily: 'var(--font-instrument-serif), Georgia, serif',
            color: 'var(--office-text)',
          }}
        >
          {gap.category_name}
        </div>
        <div className="text-right">
          <div
            className="text-[15px] tabular-nums"
            style={{
              fontFamily: 'var(--font-data), ui-monospace, monospace',
              color: 'var(--office-text)',
            }}
          >
            {formatCurrencyRounded(monthly, currency)}/mo
          </div>
          <div
            className="text-[11px] tracking-wider"
            style={{
              fontFamily: 'var(--font-data), ui-monospace, monospace',
              color: 'var(--office-text-muted)',
              letterSpacing: '0.03em',
            }}
          >
            {share}% of spend
          </div>
        </div>
      </div>

      {/* Quadrant pip */}
      <div className="flex items-center gap-1.5 mb-2.5">
        <div
          className="rounded-full"
          style={{
            width: '7px',
            height: '7px',
            background: colour,
          }}
        />
        <span
          className="text-[12px] font-medium"
          style={{ color: colour, letterSpacing: '0.02em' }}
        >
          {QUADRANT_LABELS[quadrant]}
        </span>
      </div>

      {/* Verdict — italic serif line, sourced from narrative_hint */}
      <p
        className="text-[16px] italic m-0 leading-[1.4]"
        style={{
          fontFamily: 'var(--font-instrument-serif), Georgia, serif',
          color: 'var(--office-text-secondary)',
        }}
      >
        {gap.narrative_hint}
      </p>
    </div>
  )
}
