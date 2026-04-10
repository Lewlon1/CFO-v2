'use client'

import { useState } from 'react'
import { QUADRANTS, QUADRANT_ORDER } from '@/lib/value-map/constants'
import { formatAmount, formatDate } from '@/lib/value-map/format'
import type { Transaction } from './TransactionList'

type Props = {
  transactions: Transaction[]
  onClassified: () => void
}

export function BatchClassifier({ transactions, onClassified }: Props) {
  const unsure = transactions.filter(t => !t.value_category || t.value_category === 'unsure')
  const [currentIdx, setCurrentIdx] = useState(0)
  const [classified, setClassified] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [applyToSimilar, setApplyToSimilar] = useState(true)

  if (unsure.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">All transactions have been classified.</p>
      </div>
    )
  }

  const current = unsure[currentIdx]
  if (!current) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-lg font-semibold text-foreground mb-2">All done!</p>
        <p className="text-sm text-muted-foreground">
          You classified {classified} transaction{classified !== 1 ? 's' : ''}.
        </p>
      </div>
    )
  }

  async function classify(vc: string) {
    setIsSaving(true)
    await fetch('/api/transactions/recategorise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactionId: current.id,
        field: 'value_category',
        newValue: vc,
        applyToSimilar,
        description: current.description,
      }),
    })
    setIsSaving(false)
    setClassified(c => c + 1)
    setCurrentIdx(i => i + 1)
    onClassified()
  }

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {classified} of {unsure.length} classified
        </span>
        <div className="flex-1 mx-4 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${(classified / unsure.length) * 100}%` }}
          />
        </div>
        <span className="text-muted-foreground tabular-nums">
          {unsure.length - classified} left
        </span>
      </div>

      {/* Current transaction card */}
      <div className="rounded-xl border border-border bg-card px-6 py-4 animate-[value-card-enter_0.3s_ease-out]">
        <div className="flex flex-col items-center text-center space-y-1">
          <p className="text-lg font-semibold text-foreground">
            {current.description ?? 'Transaction'}
          </p>
          <p className="font-mono text-2xl font-bold text-foreground">
            {formatAmount(Math.abs(current.amount), current.currency)}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatDate(current.date)}</span>
          </div>
          {current.category_id && (
            <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {current.category_id.replace(/_/g, ' ')}
            </span>
          )}
        </div>

        {/* Question */}
        <p className="text-xs font-medium text-muted-foreground text-center uppercase tracking-wide mt-4 mb-3">
          How do you feel about this spend?
        </p>

        {/* Value category buttons — matching ValueMapCard styling */}
        <div className="grid grid-cols-2 gap-2">
          {QUADRANT_ORDER.map((qId) => {
            const q = QUADRANTS[qId]
            return (
              <button
                key={qId}
                onClick={() => classify(qId)}
                disabled={isSaving}
                className="flex flex-col items-center justify-center gap-1 rounded-xl border-2 p-4 transition-all duration-150 active:scale-[0.97] min-h-[80px] hover:bg-card/80 disabled:opacity-40"
                style={{
                  borderColor: q.colour + '40',
                  backgroundColor: q.colour + '08',
                }}
              >
                <span className="text-xl" role="img" aria-hidden>{q.emoji}</span>
                <span className="text-sm font-semibold" style={{ color: q.colour }}>
                  {q.name}
                </span>
                <span className="text-xs text-muted-foreground leading-tight">
                  {q.tagline}
                </span>
              </button>
            )
          })}
        </div>

        {/* Skip */}
        <div className="flex justify-center mt-3">
          <button
            onClick={() => setCurrentIdx(i => i + 1)}
            disabled={isSaving}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors min-h-[44px] px-4 disabled:opacity-40"
          >
            Skip
          </button>
        </div>

        {/* Apply to similar toggle */}
        <label className="flex items-center gap-2 text-sm text-muted-foreground mt-2 cursor-pointer">
          <input
            type="checkbox"
            checked={applyToSimilar}
            onChange={(e) => setApplyToSimilar(e.target.checked)}
            className="h-4 w-4"
          />
          Apply to all similar transactions
        </label>
      </div>
    </div>
  )
}
