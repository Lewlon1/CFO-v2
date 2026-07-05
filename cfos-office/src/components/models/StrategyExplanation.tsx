'use client'

import { MARKET_DEFAULTS } from '@/lib/models/marketDefaults'
import { gbp, pct } from '@/lib/models/format'
import type { ModelBreakdown, ResolvedValues, ScenarioKey } from '@/lib/models/types'

export type ExplanationKind = ScenarioKey | 'saleToday' | 'yearOneCF'

// Inline figure — engine-computed numbers get a mono/tabular treatment so they
// stand out from the prose. Zero arithmetic happens here.
function Fig({ children }: { children: React.ReactNode }) {
  return <span className="font-data tabular-nums text-text-primary">{children}</span>
}

function Line({ children }: { children: React.ReactNode }) {
  return <p>{children}</p>
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-text-tertiary">{children}</p>
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] leading-relaxed text-text-tertiary space-y-1.5">{children}</div>
}

export function StrategyExplanation({
  kind,
  breakdown,
  horizonYears,
  resolved,
}: {
  kind: ExplanationKind
  breakdown: ModelBreakdown
  horizonYears: number
  resolved: ResolvedValues
}) {
  // Surfaces where a number came from — the first time provenance sources reach
  // this UI. Market-default slots name their published source; anything the user
  // stated or edited is simply "your figure".
  function note(slotId: string): string {
    const origin = resolved.provenance[slotId]
    if (origin === 'market' && MARKET_DEFAULTS[slotId]) {
      return `market default — ${MARKET_DEFAULTS[slotId].source}`
    }
    return 'your figure'
  }

  if (kind === 'invest') {
    const b = breakdown.invest
    return (
      <Wrap>
        <Line>
          Selling today leaves you <Fig>{gbp(b.start)}</Fig> after selling costs, the mortgage and CGT — your{' '}
          <Fig>{pct(breakdown.saleToday.sharePct)}</Fig> share.
        </Line>
        <Line>
          In an index fund at <Fig>{pct(b.ratePct)}</Fig>/yr, that compounds to <Fig>{gbp(b.end)}</Fig> over{' '}
          <Fig>{b.years}</Fig> years.
        </Line>
        <Note>
          {pct(b.ratePct)}/yr index-fund return: {note('investment_return_pct')}.
        </Note>
      </Wrap>
    )
  }

  if (kind === 'cash') {
    const b = breakdown.cash
    return (
      <Wrap>
        <Line>
          The same <Fig>{gbp(b.start)}</Fig> from selling today, parked in savings at <Fig>{pct(b.ratePct)}</Fig>/yr —{' '}
          <Fig>{gbp(b.end)}</Fig> after <Fig>{b.years}</Fig> years. The floor: what doing nothing clever earns.
        </Line>
        <Note>
          {pct(b.ratePct)}/yr savings rate: {note('cash_rate_pct')}.
        </Note>
      </Wrap>
    )
  }

  if (kind === 'rent') {
    const b = breakdown.rent
    const y = b.yearOne
    return (
      <Wrap>
        <Line>
          Year 1 of letting: <Fig>{gbp(y.grossRentFull)}</Fig> gross rent, less <Fig>{gbp(y.voidLoss)}</Fig> for empty
          weeks, <Fig>{gbp(y.agentFee)}</Fig> agent fee, <Fig>{gbp(y.maintenance)}</Fig> maintenance,{' '}
          <Fig>{gbp(y.ownCosts)}</Fig> service charge &amp; insurance, <Fig>{gbp(y.mortgageInterest)}</Fig> mortgage
          interest and <Fig>{gbp(y.tax)}</Fig> tax —{' '}
          {y.netShare < 0 ? (
            <>
              a <Fig>{gbp(Math.abs(y.netShare))}</Fig> shortfall you&apos;d fund each year at your{' '}
              <Fig>{pct(breakdown.saleToday.sharePct)}</Fig> share.
            </>
          ) : (
            <>
              <Fig>{gbp(y.netShare)}</Fig> to you at your <Fig>{pct(breakdown.saleToday.sharePct)}</Fig> share.
            </>
          )}
        </Line>
        <Line>
          The property and the rent both grow at <Fig>{pct(b.appreciationPct)}</Fig>/yr; net rent sits in cash earning{' '}
          <Fig>{pct(b.cashRatePct)}</Fig>/yr.
        </Line>
        <Line>
          Sell at year <Fig>{horizonYears}</Fig>: your share of the net sale is <Fig>{gbp(b.saleNetShareAtHorizon)}</Fig>
          , plus the <Fig>{gbp(b.rentPotAtHorizon)}</Fig> rent pot — <Fig>{gbp(b.total)}</Fig> all in.
        </Line>
        <Note>
          {pct(b.appreciationPct)}/yr house-price growth: {note('appreciation_pct')}.
        </Note>
      </Wrap>
    )
  }

  if (kind === 'redeploy' && breakdown.redeploy) {
    const b = breakdown.redeploy
    const y = b.yearOne
    return (
      <Wrap>
        <Line>
          Your <Fig>{gbp(b.deposit)}</Fig> becomes the deposit on a <Fig>{gbp(b.newPropertyPrice)}</Fig> home. Buying
          costs add <Fig>{gbp(b.buyingCosts)}</Fig>, so you&apos;d borrow <Fig>{gbp(b.newMortgage)}</Fig>.
        </Line>
        <Line>
          Year 1: you stop paying <Fig>{gbp(y.avoidedRent)}</Fig> rent, but pay <Fig>{gbp(y.interest)}</Fig> interest and{' '}
          <Fig>{gbp(y.maintenance)}</Fig> upkeep —{' '}
          {y.netBenefit < 0 ? (
            <>
              a <Fig>{gbp(Math.abs(y.netBenefit))}</Fig> annual shortfall.
            </>
          ) : (
            <>
              <Fig>{gbp(y.netBenefit)}</Fig> ahead.
            </>
          )}
        </Line>
        <Line>
          At <Fig>{pct(b.appreciationPct)}</Fig>/yr growth, year-<Fig>{horizonYears}</Fig> equity after selling costs is{' '}
          <Fig>{gbp(b.equityAtHorizon)}</Fig>,{' '}
          {b.potAtHorizon < 0 ? (
            <>
              less a <Fig>{gbp(Math.abs(b.potAtHorizon))}</Fig> running shortfall — <Fig>{gbp(b.total)}</Fig>.
            </>
          ) : (
            <>
              plus <Fig>{gbp(b.potAtHorizon)}</Fig> saved — <Fig>{gbp(b.total)}</Fig>.
            </>
          )}
        </Line>
        <Note>
          {pct(b.appreciationPct)}/yr growth on the new home: {note('new_property_appreciation_pct')}.
        </Note>
      </Wrap>
    )
  }

  if (kind === 'saleToday') {
    const b = breakdown.saleToday
    return (
      <Wrap>
        <Line>
          <Fig>{gbp(b.propertyValue)}</Fig> value − <Fig>{gbp(b.sellingCosts)}</Fig> selling costs −{' '}
          <Fig>{gbp(b.mortgageBalance)}</Fig> mortgage − <Fig>{gbp(b.cgt)}</Fig> CGT = <Fig>{gbp(b.netTotal)}</Fig>. Your{' '}
          <Fig>{pct(b.sharePct)}</Fig> share: <Fig>{gbp(b.myProceeds)}</Fig>.
        </Line>
        <Line>
          CGT is one flat <Fig>{pct(resolved.values.cgt_rate_pct ?? 0)}</Fig> rate on the gain — no rebasing, no
          allowances.
        </Line>
        <Note>CGT rate: {note('cgt_rate_pct')}.</Note>
      </Wrap>
    )
  }

  if (kind === 'yearOneCF') {
    const y = breakdown.rent.yearOne
    const rows: Array<[string, number]> = [
      ['Gross rent', y.grossRentFull],
      ['Void weeks', -y.voidLoss],
      ['Agent fee', -y.agentFee],
      ['Maintenance', -y.maintenance],
      ['Service charge & insurance', -y.ownCosts],
      ['Mortgage interest', -y.mortgageInterest],
      ['Rental tax', -y.tax],
    ]
    return (
      <div className="text-[12px] leading-relaxed text-text-tertiary space-y-1">
        {rows.map(([label, val]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <span>{label}</span>
            <span className="font-data tabular-nums text-text-primary">{gbp(val)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-1">
          <span>= whole property, {pct(breakdown.saleToday.sharePct)} to you</span>
          <span className="font-data tabular-nums text-text-primary">
            {gbp(y.netTotal)} · {gbp(y.netShare)}
          </span>
        </div>
      </div>
    )
  }

  return null
}
