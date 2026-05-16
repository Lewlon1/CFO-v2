'use client'

import type { CoverageGapV2 } from '@/lib/analytics/gap-analyser'
import { formatCurrencyRounded } from '@/lib/utils/format-currency-rounded'

export interface CoverageGapCardProps {
  gap: CoverageGapV2
  currency: string
  onTellC?: () => void
}

export function CoverageGapCard({ gap, currency, onTellC }: CoverageGapCardProps) {
  const monthly = Math.round(gap.monthly_total)
  const share = Math.round(gap.share_of_spend_pct)

  return (
    <div
      className="rounded-lg p-4 mb-3.5"
      style={{
        background: 'var(--office-bg-secondary)',
        // Dashed border distinguishes coverage gaps from stated-intent cards.
        border: '1px dashed var(--office-border)',
      }}
    >
      <div className="flex items-baseline justify-between mb-3">
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
            className="text-[11px]"
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

      <p
        className="italic m-0 mb-3 text-[15px] leading-[1.4]"
        style={{
          fontFamily: 'var(--font-instrument-serif), Georgia, serif',
          color: 'var(--office-text-muted)',
        }}
      >
        Not in your Value Map yet. The money&apos;s moving here every month with
        no stated take from you.
      </p>

      {/* Smaller textual CTA — outlined neutral, hover gold. Lower-priority
          than the multi_intent primary button. */}
      <button
        onClick={onTellC}
        className="rounded text-[12px] transition-all duration-200 min-h-[36px]"
        style={{
          padding: '8px 12px',
          background: 'transparent',
          color: 'var(--office-text-secondary)',
          border: '1px solid var(--office-border)',
          letterSpacing: '0.02em',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent-gold)'
          e.currentTarget.style.color = 'var(--accent-gold)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--office-border)'
          e.currentTarget.style.color = 'var(--office-text-secondary)'
        }}
      >
        Tell C. what this is to you  →
      </button>
    </div>
  )
}
