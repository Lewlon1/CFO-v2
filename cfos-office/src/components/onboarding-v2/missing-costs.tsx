'use client'

import type { CoverageLine } from '@/lib/analytics/category-coverage'
import type { Cadence } from '@/lib/analytics/reconcile-fixed-costs'
import { formatCurrency } from '@/lib/format/currency'
import { moneySymbol } from '@/lib/utils/money'
import { Select } from '@/components/ui/Select'
import { CADENCE_OPTIONS, monthlyEq } from './fixed-cost-display'

export type CaptureDecision = { included: boolean; amount: string; cadence: Cadence }

/** Always-available optional line — council tax / IBI almost never lands in a
 *  90-day window, so it is offered rather than coverage-gated. */
export const COUNCIL_TAX_KEY = 'council_tax'
export const COUNCIL_TAX_LABEL = 'Council tax / IBI'
export const COUNCIL_TAX_CADENCE: Cadence = 'monthly'

type Props = {
  coverage: CoverageLine[]
  state: Record<string, CaptureDecision>
  onChange: (key: string, patch: Partial<CaptureDecision>) => void
  currency: string
}

function CaptureRow({
  keyId,
  label,
  decision,
  onChange,
  symbol,
  currency,
  fallbackCadence,
}: {
  keyId: string
  label: string
  decision: CaptureDecision | undefined
  onChange: (key: string, patch: Partial<CaptureDecision>) => void
  symbol: string
  currency: string
  fallbackCadence: Cadence
}) {
  const d = decision ?? { included: false, amount: '', cadence: fallbackCadence }
  if (!d.included) {
    return (
      <button
        type="button"
        onClick={() => onChange(keyId, { included: true })}
        className="w-full min-h-[44px] text-left text-sm text-text-secondary rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-2 hover:bg-[var(--bg-muted)] transition-colors"
      >
        + Add {label.toLowerCase()}
      </button>
    )
  }
  const perMonth = monthlyEq(Number.parseFloat(d.amount) || 0, d.cadence)
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <button
          type="button"
          onClick={() => onChange(keyId, { included: false })}
          className="text-xs text-text-muted px-2 py-2 min-h-[44px] min-w-[44px] hover:text-text-secondary"
          aria-label={`Remove ${label}`}
        >
          Remove
        </button>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">
              {symbol}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              value={d.amount}
              onChange={(e) => onChange(keyId, { amount: e.target.value })}
              placeholder="0"
              className="w-full pl-7 pr-2 py-2 min-h-[44px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-text-primary/40"
            />
          </div>
        </div>
        <div className="flex-1">
          <Select
            value={d.cadence}
            onChange={(e) => onChange(keyId, { cadence: e.target.value as Cadence })}
          >
            {CADENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-sm text-text-secondary tabular-nums whitespace-nowrap pb-2">
          {formatCurrency(perMonth, currency)}/mo
        </p>
      </div>
    </div>
  )
}

/**
 * Section 4 — "What's missing". For each expected fixed-cost category absent
 * from the statement, name the absence and open a capture line. This is the
 * route by which multi-account costs (utilities or rent paid elsewhere) get
 * counted. CFO voice: third-person observation, no advice, no switch language.
 */
export function MissingCosts({ coverage, state, onChange, currency }: Props) {
  const symbol = moneySymbol(currency)
  const utilityLines = coverage.filter((l) => l.group === 'utilities')
  const uncoveredUtilities = utilityLines.filter((l) => !l.covered)
  const allUtilitiesUncovered =
    utilityLines.length > 0 && uncoveredUtilities.length === utilityLines.length
  const housing = coverage.find((l) => l.key === 'housing')
  const insurance = coverage.find((l) => l.key === 'insurance_any')

  const utilitiesSubtotal = uncoveredUtilities.reduce((sum, l) => {
    const d = state[l.key]
    if (!d?.included) return sum
    return sum + monthlyEq(Number.parseFloat(d.amount) || 0, d.cadence)
  }, 0)

  return (
    <section className="space-y-3">
      <h2 className="text-base font-medium text-text-primary leading-tight">What&apos;s missing</h2>

      {uncoveredUtilities.length > 0 && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-4 space-y-3">
          <div className="space-y-1.5">
            <span className="inline-block text-caption font-medium uppercase tracking-wide text-text-muted">

              C. noticed
            </span>
            <p className="text-sm font-medium text-text-primary leading-snug">
              {allUtilitiesUncovered
                ? 'No utilities in this statement.'
                : 'Some utilities aren’t in this statement.'}
            </p>
            <p className="text-xs text-text-secondary leading-snug">
              Electricity, gas, water and broadband often bill from a different
              account. Add what you pay and the total will include them.
            </p>
          </div>

          <div className="space-y-2">
            {uncoveredUtilities.map((line) => (
              <CaptureRow
                key={line.key}
                keyId={line.key}
                label={line.label}
                decision={state[line.key]}
                onChange={onChange}
                symbol={symbol}
                currency={currency}
                fallbackCadence={line.defaultCadence}
              />
            ))}
          </div>

          {utilitiesSubtotal > 0 && (
            <div className="flex items-center justify-between pt-1 border-t border-[var(--border-subtle)]">
              <p className="text-xs text-text-muted">Utilities added</p>
              <p className="text-sm text-text-secondary tabular-nums">
                {formatCurrency(utilitiesSubtotal, currency)}/mo
              </p>
            </div>
          )}
        </div>
      )}

      {housing && !housing.covered && (
        <CaptureRow
          keyId={housing.key}
          label={housing.label}
          decision={state[housing.key]}
          onChange={onChange}
          symbol={symbol}
          currency={currency}
          fallbackCadence={housing.defaultCadence}
        />
      )}

      {insurance && !insurance.covered && (
        <CaptureRow
          keyId={insurance.key}
          label={insurance.label}
          decision={state[insurance.key]}
          onChange={onChange}
          symbol={symbol}
          currency={currency}
          fallbackCadence={insurance.defaultCadence}
        />
      )}

      <CaptureRow
        keyId={COUNCIL_TAX_KEY}
        label={COUNCIL_TAX_LABEL}
        decision={state[COUNCIL_TAX_KEY]}
        onChange={onChange}
        symbol={symbol}
        currency={currency}
        fallbackCadence={COUNCIL_TAX_CADENCE}
      />
    </section>
  )
}
