'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import type { ReconciledBill, Cadence } from '@/lib/analytics/reconcile-fixed-costs'
import type { RecurringCandidate } from '@/lib/analytics/recurring-candidates'
import type { CoverageLine } from '@/lib/analytics/category-coverage'
import type { BillSubtype } from '@/lib/analytics/benchmark/types'
import { formatCurrency } from '@/lib/format/currency'
import { monthlyEq, keyToBillSubtype } from '@/components/onboarding-v2/fixed-cost-display'
import { ConfirmFixedCosts, bankedKey, type BankedEdit } from '@/components/onboarding-v2/confirm-fixed-costs'
import { CandidateBills, type CandidateDecision } from '@/components/onboarding-v2/candidate-bills'
import {
  MissingCosts,
  type CaptureDecision,
  COUNCIL_TAX_KEY,
  COUNCIL_TAX_LABEL,
  COUNCIL_TAX_CADENCE,
} from '@/components/onboarding-v2/missing-costs'
import { confirmFixedCosts } from '@/app/onboarding-v2/confirm/confirm-actions'
import { CfoThinking } from '@/components/brand/CfoThinking'

type ConfirmData = {
  items: ReconciledBill[]
  variable: ReconciledBill[]
  candidates: RecurringCandidate[]
  coverage: CoverageLine[]
  currency: string
}

type Props = {
  /** Fires after confirmFixedCosts commits. In 'onboarding' mode the step is now
   *  details_confirmed; in 'check' mode the step is unchanged and the host fires
   *  the reality-check Read. */
  onConfirmed: () => void
  /**
   * 'onboarding' (default) — value-first confirm; stamps details_confirmed.
   * 'check' — OB-3 statement-check mission; the commit deliberately does NOT
   * advance to details_confirmed (that would trigger the legacy value-first
   * Read). See confirm-actions.ts.
   */
  mode?: 'onboarding' | 'check'
}

/**
 * In-sheet fixed-cost confirm beat. The reconciliation logic and sub-components
 * are lifted verbatim from the old /onboarding-v2/confirm ConfirmOrchestrator;
 * the difference is that this fetches its data from /api/onboarding-v2/confirm-data
 * (so it can run inside the chat sheet) and calls onConfirmed instead of
 * router.push. All editing is local state — nothing persists until "Continue".
 */
export function ConfirmBeatBlock({ onConfirmed, mode = 'onboarding' }: Props) {
  const [data, setData] = useState<ConfirmData | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/onboarding-v2/confirm-data', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((d: ConfirmData) => {
        if (!cancelled) setData(d)
      })
      .catch((err) => {
        console.error('[confirm-beat-block] load failed', err)
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loadError) {
    return (
      <p className="px-4 py-6 text-sm text-text-secondary">
        Couldn&apos;t load your fixed costs. Refresh to try again.
      </p>
    )
  }
  if (!data) return <CfoThinking variant="block" />

  return <ConfirmBeatInner data={data} onConfirmed={onConfirmed} mode={mode} />
}

function ConfirmBeatInner({
  data,
  onConfirmed,
  mode,
}: {
  data: ConfirmData
  onConfirmed: () => void
  mode: 'onboarding' | 'check'
}) {
  const { items, variable, candidates, coverage, currency } = data
  const isCheck = mode === 'check'
  const [pending, startTransition] = useTransition()

  const visibleItems = useMemo(() => items.filter((i) => !i.superseded), [items])

  // Section 1 — dropped banked rows + per-row amount/cadence corrections.
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [bankedEdits, setBankedEdits] = useState<Record<string, BankedEdit>>({})

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
  function setBankedEdit(key: string, next: BankedEdit) {
    setBankedEdits((prev) => ({ ...prev, [key]: next }))
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
      const key = bankedKey(item, idx)
      if (dismissed.has(key)) return
      const edit = bankedEdits[key]
      sum += edit ? monthlyEq(edit.amount, edit.cadence) : item.monthly_equivalent
    })
    for (const c of candidates) {
      const d = candidateState[c.name]
      if (d?.counted) sum += monthlyEq(d.amount, d.cadence)
    }
    for (const d of Object.values(captured)) {
      if (d.included) sum += monthlyEq(Number.parseFloat(d.amount) || 0, d.cadence)
    }
    return sum
  }, [visibleItems, dismissed, bankedEdits, candidates, candidateState, captured])

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
        })

        // Banked rows the user corrected (and kept) — no-op edits are filtered
        // so untouched rows never round-trip.
        const bankedEditLines: Array<{
          label: string
          source: 'rent' | 'declared' | 'detected'
          amount: number
          cadence: Cadence
          bill_subtype: BillSubtype | null
        }> = []
        visibleItems.forEach((item, idx) => {
          const key = bankedKey(item, idx)
          if (dismissed.has(key)) return
          const edit = bankedEdits[key]
          if (!edit || !(edit.amount > 0)) return
          if (edit.amount === item.amount && edit.cadence === item.cadence) return
          bankedEditLines.push({
            label: item.label,
            source: item.source,
            amount: edit.amount,
            cadence: edit.cadence,
            bill_subtype: item.bill_subtype,
          })
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

        await confirmFixedCosts(
          {
            declaredDismissals,
            detectedDismissals,
            bankedEdits: bankedEditLines,
            acceptedCandidates,
            skippedCandidates,
            declaredLines,
          },
          { mode },
        )
        onConfirmed()
      } catch (err) {
        console.error('[confirm-beat-block] commit failed', err)
      }
    })
  }

  return (
    <div className="flex flex-col">
      <div className="px-4 py-4 space-y-6">
        <div className="space-y-1">
          <h2 className="text-base font-medium text-text-primary leading-tight">
            Your fixed costs
          </h2>
          <p className="text-sm text-text-secondary leading-snug">
            {isCheck
              ? 'What goes out every month no matter what. Get this right and the check against your sketch is true to the pound.'
              : 'What goes out every month no matter what. Get this right and the picture that follows is yours, not a guess.'}
          </p>
        </div>

        <ConfirmFixedCosts
          items={visibleItems}
          dismissed={dismissed}
          onToggle={toggleDismissed}
          edits={bankedEdits}
          onEdit={setBankedEdit}
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
            <h3 className="text-sm font-medium text-text-secondary leading-tight">
              Recurring, but it flexes
            </h3>
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

      <div className="sticky bottom-0 border-t border-[var(--border-subtle)] bg-bg-elevated/95 backdrop-blur">
        <div className="px-4 py-3 space-y-3">
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
            className="w-full min-h-[44px] rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 text-sm font-medium px-4 py-3 disabled:opacity-40 transition-colors"
          >
            {pending
              ? 'Saving…'
              : isCheck
                ? 'Looks right — check it against my sketch'
                : 'Looks right — show me the picture'}
          </button>
        </div>
      </div>
    </div>
  )
}
