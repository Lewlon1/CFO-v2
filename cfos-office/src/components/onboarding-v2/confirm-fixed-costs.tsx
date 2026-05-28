'use client'

import { useMemo, useState, useTransition } from 'react'
import type { ReconciledBill } from '@/lib/analytics/reconcile-fixed-costs'
import { formatCurrency } from '@/lib/format/currency'
import { confirmFixedCosts } from '@/app/onboarding-v2/confirm/confirm-actions'

type Props = {
  initialItems: ReconciledBill[]
  initialTotal: number
  currency: string
  onAdvance: (redirectTo: string) => void
}

type DecisionMap = Record<string, 'confirm' | 'dismiss'>

function itemKey(item: ReconciledBill, idx: number): string {
  return `${item.source}:${item.label}:${item.amount}:${idx}`
}

/**
 * A list to nod at, not a form to fill. The reconciler has already deduped
 * declared vs detected — this screen surfaces the merged set so the user
 * can confirm or dismiss each row. Defaults to confirm; the user only acts
 * on the ones they want to drop.
 *
 * The footer total live-updates as the user toggles. The "Looks right"
 * submit hands the confirmed-only list to the server action which writes
 * status flags to user_declared_fixed_costs and refreshes
 * monthly_snapshots.total_fixed_costs to match.
 */
export function ConfirmFixedCosts({
  initialItems,
  initialTotal,
  currency,
  onAdvance,
}: Props) {
  const items = useMemo(
    () => initialItems.filter((item) => !item.superseded),
    [initialItems],
  )

  const [decisions, setDecisions] = useState<DecisionMap>(() =>
    Object.fromEntries(items.map((item, idx) => [itemKey(item, idx), 'confirm'])),
  )
  const [pending, startTransition] = useTransition()

  const liveTotal = useMemo(() => {
    return items.reduce((sum, item, idx) => {
      const decision = decisions[itemKey(item, idx)] ?? 'confirm'
      if (decision === 'dismiss') return sum
      return sum + item.monthly_equivalent
    }, 0)
  }, [items, decisions])

  function toggle(key: string) {
    setDecisions((prev) => ({
      ...prev,
      [key]: prev[key] === 'confirm' ? 'dismiss' : 'confirm',
    }))
  }

  function handleSubmit() {
    if (pending) return
    startTransition(async () => {
      try {
        const confirmed = items
          .map((item, idx) => ({
            label: item.label,
            amount: item.amount,
            cadence: item.cadence,
            source: item.source,
            decision: decisions[itemKey(item, idx)] ?? 'confirm',
          }))
          .filter((row) => row.decision === 'confirm')
        const { redirectTo } = await confirmFixedCosts(confirmed)
        onAdvance(redirectTo)
      } catch (err) {
        console.error('[confirm-fixed-costs] submit failed', err)
      }
    })
  }

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-medium text-text-primary leading-tight">
          Nothing recurring jumped out yet.
        </h2>
        <p className="text-sm text-text-secondary leading-snug">
          That can happen with thin data. The picture will sharpen as more
          months land — let&apos;s look at what&apos;s there.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={handleSubmit}
          className="w-full min-h-[44px] rounded-lg bg-text-primary text-bg-base text-sm font-medium px-4 py-3 disabled:opacity-40"
        >
          Show me the picture
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-lg font-medium text-text-primary leading-tight">
          The fixed costs I can see.
        </h2>
        <p className="text-sm text-text-secondary leading-snug">
          Nod at the ones that are right; tap to drop the ones that aren&apos;t.
        </p>
      </div>

      <ul className="space-y-2">
        {items.map((item, idx) => {
          const key = itemKey(item, idx)
          const decision = decisions[key] ?? 'confirm'
          const isConfirmed = decision === 'confirm'
          return (
            <li
              key={key}
              className={`rounded-lg border px-3 py-3 flex items-center justify-between gap-3 transition-opacity ${
                isConfirmed
                  ? 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-muted)] opacity-60'
              }`}
            >
              <div className="min-w-0">
                <p
                  className={`text-sm font-medium text-text-primary truncate ${
                    !isConfirmed ? 'line-through' : ''
                  }`}
                >
                  {item.label}
                </p>
                <p className="text-xs text-text-muted">
                  {formatCurrency(item.amount, currency)} · {item.cadence}
                  {item.source === 'detected' && ' · detected'}
                  {item.source === 'declared' && item.matched_detected && ' · matched'}
                </p>
                {item.benchmark_flag && (
                  <p className="text-xs text-amber-500 mt-1">
                    Above peer average
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-pressed={!isConfirmed}
                className="text-xs px-3 py-2 min-h-[44px] min-w-[44px] rounded border border-[var(--border-subtle)] hover:bg-[var(--bg-muted)] transition-colors"
              >
                {isConfirmed ? 'Drop' : 'Keep'}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3 flex items-center justify-between">
        <p className="text-sm text-text-secondary">Fixed costs / month</p>
        <p className="text-base font-medium text-text-primary tabular-nums">
          {formatCurrency(liveTotal, currency)}
        </p>
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={handleSubmit}
        className="w-full min-h-[44px] rounded-lg bg-text-primary text-bg-base text-sm font-medium px-4 py-3 disabled:opacity-40"
      >
        {pending ? 'Saving…' : 'Looks right — show me the picture'}
      </button>
    </div>
  )
}
