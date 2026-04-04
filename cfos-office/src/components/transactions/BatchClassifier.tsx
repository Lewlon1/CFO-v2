'use client'

import { useState } from 'react'
import { Shield, TrendingUp, Droplets, Weight } from 'lucide-react'
import { VALUE_COLORS, formatCurrency } from '@/lib/constants/dashboard'
import type { Transaction } from './TransactionList'

const VC_BUTTONS = [
  { vc: 'foundation', Icon: Shield },
  { vc: 'investment', Icon: TrendingUp },
  { vc: 'leak', Icon: Droplets },
  { vc: 'burden', Icon: Weight },
] as const

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
      <div className="rounded-xl border border-border bg-card p-6 animate-[value-card-enter_0.3s_ease-out]">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="min-w-0 flex-1">
            <p className="text-lg font-medium text-foreground">{current.description}</p>
            <p className="text-sm text-muted-foreground mt-1">{current.date}</p>
          </div>
          <span className={`text-lg font-semibold tabular-nums flex-shrink-0 ${
            current.amount >= 0 ? 'text-emerald-400' : 'text-foreground'
          }`}>
            {current.amount < 0 ? '-' : '+'}{formatCurrency(Math.abs(current.amount), current.currency)}
          </span>
        </div>

        <p className="text-sm text-muted-foreground mb-4">What does this spending mean to you?</p>

        {/* Value category buttons */}
        <div className="grid grid-cols-2 gap-3">
          {VC_BUTTONS.map(({ vc, Icon }) => {
            const colors = VALUE_COLORS[vc]
            return (
              <button
                key={vc}
                onClick={() => classify(vc)}
                disabled={isSaving}
                className={`rounded-lg border ${colors.border} ${colors.bg} p-4 text-left hover:opacity-80 transition-opacity disabled:opacity-40 min-h-[44px]`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 ${colors.text}`} />
                  <span className={`text-sm font-medium ${colors.text}`}>{colors.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">{colors.description}</p>
              </button>
            )
          })}
        </div>

        {/* Apply to similar toggle */}
        <label className="flex items-center gap-2 text-sm text-muted-foreground mt-4 cursor-pointer">
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
