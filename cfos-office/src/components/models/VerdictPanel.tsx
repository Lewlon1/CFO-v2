'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { FlipPoints } from './FlipPoints'
import { HorizonTable } from './HorizonTable'
import { StrategyExplanation, type ExplanationKind } from './StrategyExplanation'
import { gbp } from '@/lib/models/format'
import type { LeaderChange, ModelResult, ResolvedValues, ScenarioKey } from '@/lib/models/types'

const SCENARIO_LABELS: Record<string, string> = {
  rent: 'Keep & rent out',
  invest: 'Sell & invest',
  cash: 'Sell & hold cash',
  redeploy: 'Sell & redeploy into a new home',
}

// Tap-to-expand card: the whole header row is a ≥44px button that reveals a
// deterministic breakdown of how the headline number was reached. Independent
// open state per card (a short list — no single-open accordion needed).
function ExpandableCard({
  id,
  variant,
  header,
  children,
}: {
  id: string
  variant: 'default' | 'elevated'
  header: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const panelId = `verdict-exp-${id}`
  return (
    <Card variant={variant} className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full flex items-center justify-between gap-2 p-3 min-h-[44px] text-left"
      >
        <div className="flex-1 min-w-0">{header}</div>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div id={panelId} className="px-3 pb-3 pt-2 border-t border-border-subtle">
          {children}
        </div>
      )}
    </Card>
  )
}

export function VerdictPanel({
  model,
  resolved,
  flips,
  horizons,
  changes,
  filledCount,
  totalRequired,
}: {
  model: ModelResult | null
  resolved: ResolvedValues
  flips: (number | null)[]
  horizons: number[]
  changes: LeaderChange[]
  filledCount: number
  totalRequired: number
}) {
  if (!model) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-center">
        <div className="text-[13px] text-text-tertiary">
          {filledCount} of {totalRequired} required assumptions on file. The interview fills the rest — or enter them
          straight into the ledger.
        </div>
      </div>
    )
  }

  const ranking = Object.entries(model.terminals)
    .filter(([, val]) => val !== null)
    .map(([key, val]) => ({ key: key as ScenarioKey, val: val as number, label: SCENARIO_LABELS[key] ?? key }))
    .sort((a, b) => b.val - a.val)
  const best = ranking[0]

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <div className="font-data text-[11px] tracking-widest text-accent-gold mb-2">
        VERDICT · {resolved.values.horizon_years}-YEAR HORIZON · {resolved.values.ownership_share_pct}% SHARE
      </div>

      <div className="space-y-2">
        {ranking.map((r, i) => (
          <ExpandableCard
            key={r.key}
            id={r.key}
            variant={i === 0 ? 'elevated' : 'default'}
            header={
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-text-primary" style={{ fontWeight: i === 0 ? 600 : 400 }}>
                  {r.label}
                </span>
                <div className="text-right">
                  <div className="font-data text-[13px] tabular-nums text-text-primary">{gbp(r.val)}</div>
                  {i > 0 && (
                    <div className="font-data text-[11px] tabular-nums text-negative">
                      −{gbp(best.val - r.val).replace('£', '')}
                    </div>
                  )}
                </div>
              </div>
            }
          >
            <StrategyExplanation
              kind={r.key as ExplanationKind}
              breakdown={model.breakdown}
              horizonYears={model.horizonYears}
              resolved={resolved}
            />
          </ExpandableCard>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <ExpandableCard
          id="saleToday"
          variant="default"
          header={
            <div>
              <div className="text-[11px] text-text-tertiary">Sale today nets you</div>
              <div className="font-data text-[13px] tabular-nums text-text-primary">{gbp(model.myProceeds0)}</div>
              <div className="text-[11px] text-text-tertiary">after costs, CGT {gbp(model.cgtToday)}</div>
            </div>
          }
        >
          <StrategyExplanation
            kind="saleToday"
            breakdown={model.breakdown}
            horizonYears={model.horizonYears}
            resolved={resolved}
          />
        </ExpandableCard>
        <ExpandableCard
          id="yearOneCF"
          variant="default"
          header={
            <div>
              <div className="text-[11px] text-text-tertiary">Rent-out cash flow, yr 1</div>
              <div
                className="font-data text-[13px] tabular-nums"
                style={{ color: (model.firstYearCF ?? 0) < 0 ? 'var(--negative)' : 'var(--positive)' }}
              >
                {gbp(model.firstYearCF)}/yr
              </div>
            </div>
          }
        >
          <StrategyExplanation
            kind="yearOneCF"
            breakdown={model.breakdown}
            horizonYears={model.horizonYears}
            resolved={resolved}
          />
        </ExpandableCard>
      </div>

      <HorizonTable
        rows={model.rows}
        horizons={horizons}
        statedHorizon={model.horizonYears}
        order={ranking.map((r) => r.key)}
        changes={changes}
      />

      <FlipPoints flips={flips} currentAppreciation={resolved.values.appreciation_pct ?? 0} />

      <Card variant="inset" className="mt-4 mb-2 p-3 text-[12px] leading-relaxed text-text-tertiary">
        Decision support, not a recommendation. Tax is a single effective rate — no rebasing, no allowances, no
        residency-specific mechanics. Mortgages are interest-only; rent tracks house prices; net rent parks at the
        cash rate. Market defaults are illustrative.
      </Card>
    </div>
  )
}
