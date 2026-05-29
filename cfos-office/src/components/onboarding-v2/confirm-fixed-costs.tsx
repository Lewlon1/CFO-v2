'use client'

import type { ReconciledBill } from '@/lib/analytics/reconcile-fixed-costs'
import { formatCurrency } from '@/lib/format/currency'
import { formatBenchmarkObservation } from '@/lib/analytics/benchmark/format'

/** Stable key for a banked row — shared with the orchestrator so dismissals
 *  map back to the right declared label / detected name. */
export function bankedKey(item: ReconciledBill, idx: number): string {
  return `${item.source}:${item.label}:${item.amount}:${idx}`
}

type Props = {
  /** Visible (non-superseded) reconcile items — rent + declared + committed detected. */
  items: ReconciledBill[]
  /** Keys (from bankedKey) the user has dropped. */
  dismissed: Set<string>
  onToggle: (key: string) => void
  currency: string
}

/**
 * Section 1 — "Banked automatically". The reconciler already deduped declared
 * vs detected and held discretionary-but-regular spend out; this surfaces the
 * committed set the user can nod at or drop. Presentational only: the
 * orchestrator owns the dismissal state and the single commit.
 */
export function ConfirmFixedCosts({ items, dismissed, onToggle, currency }: Props) {
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
          Steady, repeating costs I could see. Drop anything that isn&apos;t a real fixed cost.
        </p>
      </div>

      <ul className="space-y-2">
        {items.map((item, idx) => {
          const key = bankedKey(item, idx)
          const isDismissed = dismissed.has(key)
          const observation = item.benchmark_verdict
            ? formatBenchmarkObservation({
                label: item.label,
                monthly_amount: item.monthly_equivalent,
                verdict: item.benchmark_verdict,
              })
            : null
          return (
            <li
              key={key}
              className={`rounded-lg border px-3 py-3 flex items-center justify-between gap-3 transition-opacity ${
                isDismissed
                  ? 'border-[var(--border-subtle)] bg-[var(--bg-muted)] opacity-60'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'
              }`}
            >
              <div className="min-w-0">
                <p
                  className={`text-sm font-medium text-text-primary truncate ${
                    isDismissed ? 'line-through' : ''
                  }`}
                >
                  {item.label}
                </p>
                <p className="text-xs text-text-muted">
                  {formatCurrency(item.amount, currency)} · {item.cadence}
                  {item.source === 'detected' && ' · detected'}
                  {item.source === 'declared' && item.matched_detected && ' · matched'}
                </p>
                {observation ? (
                  <p className="text-xs text-amber-500 mt-1 leading-snug">{observation}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onToggle(key)}
                aria-pressed={isDismissed}
                className="text-xs px-3 py-2 min-h-[44px] min-w-[44px] rounded border border-[var(--border-subtle)] hover:bg-[var(--bg-muted)] transition-colors shrink-0"
              >
                {isDismissed ? 'Keep' : 'Drop'}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
