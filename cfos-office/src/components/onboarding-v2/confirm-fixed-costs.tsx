'use client'

import { useState } from 'react'
import type { ReconciledBill, Cadence } from '@/lib/analytics/reconcile-fixed-costs'
import { formatCurrency } from '@/lib/format/currency'
import { formatBenchmarkObservation } from '@/lib/analytics/benchmark/format'
import { Select } from '@/components/ui/Select'
import { BillAmountInput } from './candidate-bills'
import { CADENCE_OPTIONS, monthlyEq } from './fixed-cost-display'

/** Stable key for a banked row — shared with the orchestrator so dismissals
 *  map back to the right declared label / detected name. Uses the ORIGINAL
 *  amount from props, so the key survives local edits. */
export function bankedKey(item: ReconciledBill, idx: number): string {
  return `${item.source}:${item.label}:${item.amount}:${idx}`
}

/** A user correction to a banked row's amount / cadence. Orchestrator-owned. */
export type BankedEdit = { amount: number; cadence: Cadence }

type Props = {
  /** Visible (non-superseded) reconcile items — rent + declared + committed detected. */
  items: ReconciledBill[]
  /** Keys (from bankedKey) the user has dropped. */
  dismissed: Set<string>
  onToggle: (key: string) => void
  /** Per-row amount/cadence corrections, keyed by bankedKey. */
  edits: Record<string, BankedEdit>
  onEdit: (key: string, next: BankedEdit) => void
  currency: string
}

/**
 * Section 1 — "Banked automatically". The reconciler already deduped declared
 * vs detected and held discretionary-but-regular spend out; this surfaces the
 * committed set the user can nod at, correct, or drop. Editing reveals the
 * same amount + cadence controls as the candidate tier (the detector's cadence
 * guess on sparse data — e.g. a bi-monthly read on a monthly subscription —
 * is exactly the thing the user can fix here). Presentational only: the
 * orchestrator owns dismissal + edit state and the single commit; which rows
 * have their editor open is purely local UI state.
 */
export function ConfirmFixedCosts({ items, dismissed, onToggle, edits, onEdit, currency }: Props) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  function toggleOpen(key: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (items.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="text-base font-medium text-text-primary leading-tight">
          Banked automatically
        </h2>
        <div className="rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-muted)] px-4 py-4">
          <p className="text-sm text-text-secondary leading-snug">
            Nothing clean enough to count on its own yet — nothing repeated at a
            steady amount and date. Anything real that&apos;s missing, add it below.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-medium text-text-primary leading-tight">
          Banked automatically
        </h2>
        <p className="text-sm text-text-secondary leading-snug">
          Steady, repeating costs I could see. Fix anything I got wrong; drop
          anything that isn&apos;t a real fixed cost.
        </p>
      </div>

      <ul className="space-y-2">
        {items.map((item, idx) => {
          const key = bankedKey(item, idx)
          const isDismissed = dismissed.has(key)
          const edit = edits[key]
          const effAmount = edit?.amount ?? item.amount
          const effCadence = edit?.cadence ?? item.cadence
          const isEdited =
            edit != null && (edit.amount !== item.amount || edit.cadence !== item.cadence)
          const isOpen = open.has(key) && !isDismissed
          // The rent line mirrors user_profiles.monthly_rent, which is a
          // monthly figure by definition — amount is editable, cadence isn't.
          const isRent = item.source === 'rent'
          const observation = item.benchmark_verdict
            ? formatBenchmarkObservation({
                label: item.label,
                monthly_amount: monthlyEq(effAmount, effCadence),
                verdict: item.benchmark_verdict,
              })
            : null
          return (
            <li
              key={key}
              className={`rounded-lg border px-3 py-3 space-y-3 transition-opacity ${
                isDismissed
                  ? 'border-[var(--border-subtle)] bg-[var(--bg-muted)] opacity-60'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className={`text-sm font-medium text-text-primary truncate ${
                      isDismissed ? 'line-through' : ''
                    }`}
                  >
                    {item.label}
                  </p>
                  <p className="text-xs text-text-muted">
                    {formatCurrency(effAmount, currency)} · {effCadence}
                    {isEdited && ' · edited'}
                    {!isEdited && item.source === 'detected' && ' · detected'}
                    {!isEdited && item.source === 'declared' && item.matched_detected && ' · matched'}
                  </p>
                  {observation ? (
                    <p className="text-xs text-amber-500 mt-1 leading-snug">{observation}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!isDismissed && (
                    <button
                      type="button"
                      onClick={() => toggleOpen(key)}
                      aria-expanded={isOpen}
                      className={`text-xs px-3 py-2 min-h-[44px] min-w-[44px] rounded border transition-colors ${
                        isOpen
                          ? 'border-primary bg-primary/10 text-text-primary'
                          : 'border-[var(--border-subtle)] hover:bg-[var(--bg-muted)]'
                      }`}
                    >
                      {isOpen ? 'Done' : 'Edit'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onToggle(key)}
                    aria-pressed={isDismissed}
                    className="text-xs px-3 py-2 min-h-[44px] min-w-[44px] rounded border border-[var(--border-subtle)] hover:bg-[var(--bg-muted)] transition-colors"
                  >
                    {isDismissed ? 'Keep' : 'Drop'}
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-text-muted mb-1">Amount</label>
                    <BillAmountInput
                      currency={currency}
                      amount={effAmount}
                      onAmount={(value) => onEdit(key, { amount: value, cadence: effCadence })}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-text-muted mb-1">Every</label>
                    {isRent ? (
                      <p className="text-sm text-text-secondary px-3 py-2 min-h-[44px] flex items-center rounded border border-[var(--border-subtle)] bg-[var(--bg-muted)]">
                        monthly
                      </p>
                    ) : (
                      <Select
                        value={effCadence}
                        onChange={(e) =>
                          onEdit(key, { amount: effAmount, cadence: e.target.value as Cadence })
                        }
                        className="bg-bg-base"
                      >
                        {CADENCE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                  <p className="text-sm text-text-secondary tabular-nums whitespace-nowrap pb-2">
                    {formatCurrency(monthlyEq(effAmount, effCadence), currency)}/mo
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
