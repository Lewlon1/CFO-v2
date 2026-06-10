'use client'

// VM-5 — the Alignment Score tile. The headline metric: does spending match
// what the user says matters. Renders a number ONLY above the honesty floor
// (the API withholds sub-floor scores as null); otherwise the calibrating
// state with the exact € still unmapped — a money fact — linking into the
// existing unmapped-chip correction flow on the transactions list.
//
// Months without a displayable score render as gaps in the sparkline, never
// zeros. Copy is observation only — no praise, no judgement.

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { AlignmentSummary } from '@/app/api/dashboard/summary/route'
import { folderColors } from '@/lib/tokens'
import { formatCurrencyRounded } from '@/lib/utils/format-currency-rounded'

const ACCENT = folderColors.values

interface AlignmentTileProps {
  alignment: AlignmentSummary
  currency: string
}

export function AlignmentTile({ alignment, currency }: AlignmentTileProps) {
  const { current, calibrating, history } = alignment

  return (
    <div className="rounded-card mb-4 px-[14px] py-[14px] bg-bg-card border border-border-subtle">
      <div className="flex items-baseline justify-between mb-2">
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: ACCENT }}
        >
          Alignment
        </div>
        <div className="text-[10px] text-text-tertiary italic">
          spending vs what you say matters
        </div>
      </div>

      {current ? (
        <div className="flex items-center gap-4">
          <div
            className="font-data text-[28px] leading-none tabular-nums text-text-primary shrink-0"
          >
            {Math.round(current.pct)}%
          </div>
          <div className="flex-1 min-w-0">
            <AlignmentSparkline history={history} />
          </div>
        </div>
      ) : (
        <div>
          <div className="text-[13px] text-text-secondary leading-[1.45]">
            Calibrating
            {calibrating && calibrating.unmapped_monthly > 0 && (
              <>
                {' '}— {formatCurrencyRounded(calibrating.unmapped_monthly, currency)}/month
                still unmapped
              </>
            )}
            .
          </div>
          <Link
            href="/office/cash-flow/transactions"
            className="inline-flex items-center gap-1 mt-2 text-[11px] min-h-[44px] py-2"
            style={{ color: ACCENT }}
          >
            Sort what&apos;s unmapped <ArrowRight size={11} strokeWidth={2} />
          </Link>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function AlignmentSparkline({ history }: { history: AlignmentSummary['history'] }) {
  const W = 120
  const H = 32
  const PAD = 3

  if (history.length === 0) return null

  // x position by month slot; y by score (0–100, fixed domain). Null months
  // break the line into segments — a gap is rendered as absence, never as 0.
  const x = (i: number) =>
    history.length === 1 ? W / 2 : PAD + (i / (history.length - 1)) * (W - PAD * 2)
  const y = (pct: number) => H - PAD - (pct / 100) * (H - PAD * 2)

  const segments: { i: number; pct: number }[][] = []
  let run: { i: number; pct: number }[] = []
  history.forEach((m, i) => {
    if (m.pct == null) {
      if (run.length > 0) segments.push(run)
      run = []
    } else {
      run.push({ i, pct: m.pct })
    }
  })
  if (run.length > 0) segments.push(run)

  const hasAnyPoint = segments.length > 0
  if (!hasAnyPoint) return null

  const monthLabel = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { month: 'short' })

  return (
    <div>
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-8"
        role="img"
        aria-label="Alignment over the last six months"
      >
        {segments.map((seg, si) =>
          seg.length === 1 ? (
            <circle
              key={si}
              cx={x(seg[0].i)}
              cy={y(seg[0].pct)}
              r={1.8}
              fill={ACCENT}
            />
          ) : (
            <polyline
              key={si}
              points={seg.map((p) => `${x(p.i)},${y(p.pct)}`).join(' ')}
              fill="none"
              stroke={ACCENT}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ),
        )}
      </svg>
      <div className="flex justify-between font-data text-[8px] text-text-tertiary mt-[2px]">
        <span>{monthLabel(history[0].month)}</span>
        {history.length > 1 && (
          <span>{monthLabel(history[history.length - 1].month)}</span>
        )}
      </div>
    </div>
  )
}

export default AlignmentTile
