'use client'

import { useState } from 'react'
import { ValueCategoryPill } from './ValueCategoryPill'

export type UncategorisedTransaction = {
  id: string
  date: string
  description: string
  amount: number
  currency: string
  value_category: string | null
  value_confidence: number | null
  category_id: string | null
}

type Props = {
  transactions: UncategorisedTransaction[]
  totalCount: number
}

function formatAmount(amount: number, currency: string) {
  const abs = Math.abs(amount)
  const formatted = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency
  return `${amount < 0 ? '-' : '+'}${symbol}${formatted}`
}

export function UncategorisedQueue({ transactions: initial, totalCount: initialCount }: Props) {
  const [items, setItems] = useState(initial)
  const [remaining, setRemaining] = useState(initialCount)

  function handleUpdate(txnId: string, newCategory: string) {
    setItems((prev) =>
      prev.map((t) =>
        t.id === txnId
          ? { ...t, value_category: newCategory, value_confidence: 1.0 }
          : t
      )
    )
    // Remove from queue after a brief moment so user sees the change
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== txnId))
      setRemaining((r) => Math.max(0, r - 1))
    }, 400)
  }

  if (remaining === 0 || items.length === 0) {
    if (initialCount > 0) {
      // Was showing items, now all caught up
      return (
        <div className="rounded-lg border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          All caught up
        </div>
      )
    }
    return null
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{remaining}</span>{' '}
        {remaining === 1 ? 'transaction needs' : 'transactions need'} your input
      </p>

      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory">
        {items.map((t, i) => (
          <div
            key={t.id}
            className="shrink-0 w-[280px] rounded-lg border border-border bg-card p-3 space-y-2 snap-start"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{t.description}</p>
                <p className="text-xs text-muted-foreground">{t.date}</p>
              </div>
              <span className={`text-sm font-medium tabular-nums shrink-0 ${t.amount >= 0 ? 'text-green-600' : 'text-foreground'}`}>
                {formatAmount(t.amount, t.currency)}
              </span>
            </div>
            <ValueCategoryPill
              transactionId={t.id}
              currentCategory={t.value_category}
              confidence={t.value_confidence ?? 0}
              description={t.description}
              onUpdate={(newCat) => handleUpdate(t.id, newCat)}
              defaultExpanded={i < 3}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
