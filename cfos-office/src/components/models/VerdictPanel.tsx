'use client'

import { Card } from '@/components/ui/Card'
import { FlipPoints } from './FlipPoints'
import type { ModelResult, ResolvedValues } from '@/lib/models/types'

const SCENARIO_LABELS: Record<string, string> = {
  rent: 'Keep & rent out',
  invest: 'Sell & invest',
  cash: 'Sell & hold cash',
  redeploy: 'Sell & redeploy into a new home',
}

function gbp(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—'
  return (n < 0 ? '−£' : '£') + Math.abs(Math.round(n)).toLocaleString('en-GB')
}

export function VerdictPanel({
  model,
  resolved,
  flips,
  filledCount,
  totalRequired,
}: {
  model: ModelResult | null
  resolved: ResolvedValues
  flips: (number | null)[]
  filledCount: number
  totalRequired: number
}) {
  if (!model) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center">
        <div className="text-[13px] text-text-tertiary">
          {filledCount} of {totalRequired} required assumptions on file. The interview fills the rest — or enter them straight into the ledger.
        </div>
      </div>
    )
  }

  const ranking = Object.entries(model.terminals)
    .filter(([, val]) => val !== null)
    .map(([key, val]) => ({ key, val: val as number, label: SCENARIO_LABELS[key] ?? key }))
    .sort((a, b) => b.val - a.val)
  const best = ranking[0]

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="font-data text-[11px] tracking-widest text-accent-gold mb-2">
        VERDICT · {resolved.values.horizon_years}-YEAR HORIZON · {resolved.values.ownership_share_pct}% SHARE
      </div>

      <div className="space-y-2">
        {ranking.map((r, i) => (
          <Card key={r.key} variant={i === 0 ? 'elevated' : 'default'} className="flex items-center justify-between p-3">
            <span className="text-[13px] text-text-primary" style={{ fontWeight: i === 0 ? 600 : 400 }}>
              {r.label}
            </span>
            <div className="text-right">
              <div className="font-data text-[13px] tabular-nums text-text-primary">{gbp(r.val)}</div>
              {i > 0 && <div className="font-data text-[11px] tabular-nums text-negative">−{gbp(best.val - r.val).replace('£', '')}</div>}
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Card variant="default" className="p-3">
          <div className="text-[11px] text-text-tertiary">Sale today nets you</div>
          <div className="font-data text-[13px] tabular-nums text-text-primary">{gbp(model.myProceeds0)}</div>
          <div className="text-[11px] text-text-tertiary">after costs, CGT {gbp(model.cgtToday)}</div>
        </Card>
        <Card variant="default" className="p-3">
          <div className="text-[11px] text-text-tertiary">Rent-out cash flow, yr 1</div>
          <div
            className="font-data text-[13px] tabular-nums"
            style={{ color: (model.firstYearCF ?? 0) < 0 ? 'var(--negative)' : 'var(--positive)' }}
          >
            {gbp(model.firstYearCF)}/yr
          </div>
        </Card>
      </div>

      <FlipPoints flips={flips} currentAppreciation={resolved.values.appreciation_pct ?? 0} />

      <Card variant="inset" className="mt-4 mb-2 p-3 text-[12px] leading-relaxed text-text-tertiary">
        Decision support, not a recommendation. Tax is a single effective rate — no rebasing, no allowances, no
        residency-specific mechanics. Mortgages are interest-only; rent tracks house prices; net rent parks at the
        cash rate. Market defaults are illustrative.
      </Card>
    </div>
  )
}
