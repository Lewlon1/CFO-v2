'use client'

import type { ValueMapMetadata } from '@/lib/analytics/gap-analyser'
import { QUADRANT_COLOURS, QUADRANT_LABELS, type Quadrant } from './quadrant-tokens'

export type VmRowsByQuadrant = Record<Quadrant, string[]>

export interface ValueMapSummaryProps {
  metadata: ValueMapMetadata
  vmRowsByQuadrant: VmRowsByQuadrant
  onRetake?: () => void
}

const ROW_ORDER: Quadrant[] = ['foundation', 'investment', 'leak', 'burden', 'unsure']

function SummaryRow({
  quadrant,
  count,
  items,
}: {
  quadrant: Quadrant
  count: number
  items: string
}) {
  const colour = QUADRANT_COLOURS[quadrant]
  return (
    <div className="flex items-baseline gap-2.5">
      <div className="flex items-center gap-1.5" style={{ minWidth: '110px' }}>
        <div
          className="rounded-full shrink-0"
          style={{ width: '7px', height: '7px', background: colour }}
        />
        <span
          className="text-[12px] font-medium"
          style={{ color: 'var(--office-text)' }}
        >
          {QUADRANT_LABELS[quadrant]}
        </span>
        <span
          className="text-[11px]"
          style={{
            fontFamily: 'var(--font-data), ui-monospace, monospace',
            color: 'var(--office-text-muted)',
          }}
        >
          ({count})
        </span>
      </div>
      <span
        className="flex-1 text-[12px]"
        style={{ color: 'var(--office-text-secondary)' }}
      >
        {items}
      </span>
    </div>
  )
}

export function ValueMapSummary({
  metadata,
  vmRowsByQuadrant,
  onRetake,
}: ValueMapSummaryProps) {
  const baselineLabel =
    metadata.staleness_days > 0
      ? `baseline · ${metadata.staleness_days}d ago`
      : 'baseline · today'

  return (
    <div
      className="rounded-lg p-4"
      style={{
        background: 'var(--office-bg-secondary)',
        border: '1px solid var(--office-border)',
      }}
    >
      {/* Header — title + baseline staleness */}
      <div className="flex items-baseline justify-between mb-3.5">
        <div
          className="text-[17px]"
          style={{
            fontFamily: 'var(--font-instrument-serif), Georgia, serif',
            color: 'var(--office-text)',
          }}
        >
          Your Value Map
        </div>
        <div
          className="text-[10px]"
          style={{
            fontFamily: 'var(--font-data), ui-monospace, monospace',
            color: 'var(--office-text-muted)',
            letterSpacing: '0.05em',
          }}
        >
          {baselineLabel}
        </div>
      </div>

      {/* One row per quadrant — keeps fixed order so the eye can scan */}
      <div className="flex flex-col gap-2">
        {ROW_ORDER.map((q) => {
          const items = vmRowsByQuadrant[q] ?? []
          if (items.length === 0) return null
          return (
            <SummaryRow
              key={q}
              quadrant={q}
              count={items.length}
              items={items.join(' · ')}
            />
          )
        })}
      </div>

      {/* Coverage line + retake CTA */}
      <div
        className="flex justify-between items-center mt-3.5"
        style={{
          paddingTop: '12px',
          borderTop: '1px solid var(--office-border)',
        }}
      >
        <span
          className="text-[11px]"
          style={{
            fontFamily: 'var(--font-data), ui-monospace, monospace',
            color: 'var(--office-text-muted)',
            letterSpacing: '0.04em',
          }}
        >
          {metadata.classifications_count} classifications · {Math.round(metadata.coverage_pct)}% spend covered
        </span>
        <button
          onClick={onRetake}
          className="text-[11px] p-0 bg-transparent border-0 cursor-pointer min-h-[28px]"
          style={{
            fontFamily: 'var(--font-data), ui-monospace, monospace',
            color: 'var(--accent-gold)',
            letterSpacing: '0.04em',
          }}
        >
          retake →
        </button>
      </div>
    </div>
  )
}
