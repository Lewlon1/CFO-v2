'use client'

import type { RecurringCandidate } from '@/lib/analytics/recurring-candidates'
import type { Cadence } from '@/lib/analytics/reconcile-fixed-costs'
import { formatCurrency } from '@/lib/format/currency'
import { moneySymbol } from '@/lib/utils/money'
import { Select } from '@/components/ui/Select'
import { CADENCE_OPTIONS, monthlyEq, capitaliseLabel } from './fixed-cost-display'

export type CandidateDecision = { counted: boolean; amount: number; cadence: Cadence }

type Props = {
  candidates: RecurringCandidate[]
  state: Record<string, CandidateDecision>
  onChange: (name: string, patch: Partial<CandidateDecision>) => void
  currency: string
}

/**
 * Section 2 — "Worth a look". Clusters that failed the strict gate but still
 * look committed (a metro pass billed twice, a wobbly-amount subscription).
 * High-confidence ones default to counted; low-confidence default to skipped
 * with an ochre nudge. Editable amount + cadence; per-month equivalent shown.
 * Presentational — the orchestrator owns the state and the live total.
 */
export function CandidateBills({ candidates, state, onChange, currency }: Props) {
  if (candidates.length === 0) return null
  const symbol = moneySymbol(currency)

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-medium text-text-primary leading-tight">Worth a look</h2>
        <p className="text-sm text-text-secondary leading-snug">
          These repeat, but not cleanly enough to bank without a nod. Count the
          ones that are real commitments.
        </p>
      </div>

      <ul className="space-y-2">
        {candidates.map((c) => {
          const d = state[c.name] ?? { counted: c.confidence === 'high', amount: c.amount, cadence: c.cadence }
          const perMonth = monthlyEq(d.amount, d.cadence)
          return (
            <li
              key={c.name}
              className={`rounded-lg border px-3 py-3 space-y-3 transition-opacity ${
                d.counted
                  ? 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-muted)] opacity-70'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {capitaliseLabel(c.name)}
                  </p>
                  <p className="text-xs text-text-muted">
                    seen {c.occurrences}× · {c.cadence} · ~{formatCurrency(c.amount, currency)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onChange(c.name, { counted: !d.counted })}
                  aria-pressed={d.counted}
                  className={`text-xs px-3 py-2 min-h-[44px] rounded border transition-colors shrink-0 ${
                    d.counted
                      ? 'border-text-primary bg-text-primary text-bg-base'
                      : 'border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]'
                  }`}
                >
                  {d.counted ? 'Counted' : 'Skipped'}
                </button>
              </div>

              {c.confidence === 'low' && !d.counted && (
                <p className="text-xs text-amber-500 leading-snug">
                  The amount moves around — only count it if it&apos;s a real commitment.
                </p>
              )}

              {d.counted && (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-text-muted mb-1">Amount</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">
                        {symbol}
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="1"
                        value={Number.isFinite(d.amount) ? d.amount : ''}
                        onChange={(e) => onChange(c.name, { amount: Number.parseFloat(e.target.value) || 0 })}
                        className="w-full pl-7 pr-2 py-2 min-h-[44px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-text-primary/40"
                      />
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-text-muted mb-1">Every</label>
                    <Select
                      value={d.cadence}
                      onChange={(e) => onChange(c.name, { cadence: e.target.value as Cadence })}
                      className="bg-bg-base"
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
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
