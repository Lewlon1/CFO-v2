'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { ReconciledBill, Cadence } from '@/lib/analytics/reconcile-fixed-costs'
import type { RecurringCandidate } from '@/lib/analytics/recurring-candidates'
import type { CoverageLine } from '@/lib/analytics/category-coverage'
import type { BillSubtype } from '@/lib/analytics/benchmark/types'
import { formatCurrency } from '@/lib/format/currency'
import { monthlyEq, keyToBillSubtype } from '@/components/onboarding-v2/fixed-cost-display'
import { ConfirmFixedCosts, bankedKey } from '@/components/onboarding-v2/confirm-fixed-costs'
import { CandidateBills, type CandidateDecision } from '@/components/onboarding-v2/candidate-bills'
import {
  MissingCosts,
  type CaptureDecision,
  COUNCIL_TAX_KEY,
  COUNCIL_TAX_LABEL,
  COUNCIL_TAX_CADENCE,
} from '@/components/onboarding-v2/missing-costs'
import { confirmFixedCosts } from './confirm-actions'

type Props = {
  items: ReconciledBill[]
  variable: ReconciledBill[]
  candidates: RecurringCandidate[]
  coverage: CoverageLine[]
  currency: string
}

/**
 * Stateful container for the Step-4 confirm screen. All editing is local React
 * state — nothing persists until "Continue", which assembles a single
 * ConfirmPayload and calls confirmFixedCosts. The live total is for legibility
 * only; the authoritative total is recomputed server-side after commit. Free
 * cash flow stays the First Read's payoff and is deliberately NOT shown here.
 */
export function ConfirmOrchestrator({ items, variable, candidates, coverage, currency }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const visibleItems = useMemo(() => items.filter((i) => !i.superseded), [items])

  // Section 1 — dropped banked rows.
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())

  // Section 2 — per-candidate decision; high-confidence defaults to counted.
  const [candidateState, setCandidateState] = useState<Record<string, CandidateDecision>>(() =>
    Object.fromEntries(
      candidates.map((c) => [c.name, { counted: c.confidence === 'high', amount: c.amount, cadence: c.cadence }]),
    ),
  )

  // Section 4 — capture lines, seeded for every coverage key + council tax.
  const captureMeta = useMemo(() => {
    const meta: Record<string, { label: string; bill_subtype: BillSubtype | null; defaultCadence: Cadence }> = {}
    for (const line of coverage) {
      meta[line.key] = {
        label: line.label,
        bill_subtype: keyToBillSubtype(line.key),
        defaultCadence: line.defaultCadence,
      }
    }
    meta[COUNCIL_TAX_KEY] = { label: COUNCIL_TAX_LABEL, bill_subtype: null, defaultCadence: COUNCIL_TAX_CADENCE }
    return meta
  }, [coverage])

  const [captured, setCaptured] = useState<Record<string, CaptureDecision>>(() =>
    Object.fromEntries(
      Object.entries(captureMeta).map(([key, m]) => [key, { included: false, amount: '', cadence: m.defaultCadence }]),
    ),
  )

  function toggleDismissed(key: string) {
    setDismissed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  function patchCandidate(name: string, patch: Partial<CandidateDecision>) {
    setCandidateState((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }))
  }
  function patchCapture(key: string, patch: Partial<CaptureDecision>) {
    setCaptured((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { included: false, amount: '', cadence: captureMeta[key]?.defaultCadence ?? 'monthly' }), ...patch },
    }))
  }

  const liveTotal = useMemo(() => {
    let sum = 0
    visibleItems.forEach((item, idx) => {
      if (!dismissed.has(bankedKey(item, idx))) sum += item.monthly_equivalent
    })
    for (const c of candidates) {
      const d = candidateState[c.name]
      if (d?.counted) sum += monthlyEq(d.amount, d.cadence)
    }
    for (const d of Object.values(captured)) {
      if (d.included) sum += monthlyEq(Number.parseFloat(d.amount) || 0, d.cadence)
    }
    return sum
  }, [visibleItems, dismissed, candidates, candidateState, captured])

  function handleContinue() {
    if (pending) return
    startTransition(async () => {
      try {
        const declaredDismissals: string[] = []
        const detectedDismissals: string[] = []
        visibleItems.forEach((item, idx) => {
          if (!dismissed.has(bankedKey(item, idx))) return
          if (item.source === 'declared') declaredDismissals.push(item.label)
          else if (item.source === 'detected') detectedDismissals.push(item.label)
          // rent drops are not persisted (monthly_rent is the source of truth)
        })

        const acceptedCandidates = candidates
          .filter((c) => candidateState[c.name]?.counted)
          .map((c) => {
            const d = candidateState[c.name]
            return { name: c.name, amount: d.amount, cadence: d.cadence, bill_subtype: c.bill_subtype }
          })
        const skippedCandidates = candidates
          .filter((c) => !candidateState[c.name]?.counted)
          .map((c) => {
            const d = candidateState[c.name]
            return { name: c.name, amount: d.amount, cadence: d.cadence }
          })

        const declaredLines = Object.entries(captured)
          .filter(([, d]) => d.included && (Number.parseFloat(d.amount) || 0) > 0)
          .map(([key, d]) => {
            const meta = captureMeta[key]
            return {
              label: meta?.label ?? key,
              amount: Number.parseFloat(d.amount),
              cadence: d.cadence,
              bill_subtype: meta?.bill_subtype ?? null,
            }
          })

        const { redirectTo } = await confirmFixedCosts({
          declaredDismissals,
          detectedDismissals,
          acceptedCandidates,
          skippedCandidates,
          declaredLines,
        })
        router.push(redirectTo)
      } catch (err) {
        console.error('[confirm-orchestrator] commit failed', err)
      }
    })
  }

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[430px] mx-auto w-full px-4 py-6 space-y-6">
          <div className="space-y-1">
            <h1 className="text-lg font-medium text-text-primary leading-tight">
              Your fixed costs
            </h1>
            <p className="text-sm text-text-secondary leading-snug">
              What goes out every month no matter what. Get this right and the
              picture that follows is yours, not a guess.
            </p>
          </div>

          <ConfirmFixedCosts
            items={visibleItems}
            dismissed={dismissed}
            onToggle={toggleDismissed}
            currency={currency}
          />

          <CandidateBills
            candidates={candidates}
            state={candidateState}
            onChange={patchCandidate}
            currency={currency}
          />

          {variable.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-medium text-text-primary leading-tight">
                Recurring, but it flexes
              </h2>
              <p className="text-sm text-text-secondary leading-snug">
                These repeat, but the amount moves — they&apos;re spending, not a
                fixed cost, so they sit outside the total.
              </p>
              <ul className="space-y-1.5">
                {variable.map((v, idx) => (
                  <li
                    key={`${v.label}:${idx}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-2"
                  >
                    <span className="text-sm text-text-secondary line-through truncate">{v.label}</span>
                    <span className="text-xs text-text-muted tabular-nums whitespace-nowrap">
                      ~{formatCurrency(v.monthly_equivalent, currency)}/mo
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <MissingCosts
            coverage={coverage}
            state={captured}
            onChange={patchCapture}
            currency={currency}
          />
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-[var(--border-subtle)] bg-background/95 backdrop-blur">
        <div className="max-w-[430px] mx-auto w-full px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-secondary">Fixed costs / month</p>
            <p className="text-base font-semibold text-text-primary tabular-nums">
              {formatCurrency(liveTotal, currency)}
            </p>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={handleContinue}
            className="w-full min-h-[44px] rounded-lg bg-text-primary text-bg-base text-sm font-medium px-4 py-3 disabled:opacity-40 transition-opacity"
          >
            {pending ? 'Saving…' : 'Looks right — show me the picture'}
          </button>
        </div>
      </div>
    </div>
  )
}
