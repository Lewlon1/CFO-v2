'use client'

import { useState, useEffect } from 'react'
import { CategoryBadge } from './CategoryBadge'
import { ValueCategoryPill } from './ValueCategoryPill'
import type { Category } from '@/lib/parsers/types'
import type { FilterState } from './TransactionFilters'

export type Transaction = {
  id: string
  date: string
  description: string
  amount: number
  currency: string
  category_id: string | null
  value_category: string | null
  value_confidence: number | null
  value_confirmed_by_user: boolean
  prediction_source: string | null
  is_recurring: boolean
  is_holiday_spend: boolean
  user_confirmed: boolean
}

type Props = {
  transactions: Transaction[]
  categories: Category[]
  filters: FilterState
  onRecategorised: () => void
}

const PAGE_SIZE = 50

function formatAmount(amount: number, currency: string) {
  const abs = Math.abs(amount)
  const formatted = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency
  const sign = amount < 0 ? '-' : '+'
  return `${sign}${symbol}${formatted}`
}

type EditState = {
  transactionId: string
  newValue: string
  applyToSimilar: boolean
  description: string
  isSaving: boolean
}

export function TransactionList({ transactions, categories, filters, onRecategorised }: Props) {
  const [page, setPage] = useState(0)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [localTxns, setLocalTxns] = useState(transactions)

  // Sync when parent data changes
  useEffect(() => { setLocalTxns(transactions) }, [transactions])

  // Filter
  const filtered = localTxns.filter((t) => {
    if (filters.search) {
      const q = filters.search.toLowerCase()
      if (!t.description.toLowerCase().includes(q)) return false
    }
    if (filters.categoryId && t.category_id !== filters.categoryId) return false
    if (filters.valueCategory && t.value_category !== filters.valueCategory) return false
    if (filters.month && !t.date.startsWith(filters.month)) return false
    return true
  })

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Reset page when filters change
  useEffect(() => { setPage(0) }, [filters])

  // Optimistic value category update from pill
  function handleValueUpdate(txnId: string, newCategory: string) {
    setLocalTxns((prev) =>
      prev.map((t) =>
        t.id === txnId
          ? { ...t, value_category: newCategory, value_confidence: 1.0, value_confirmed_by_user: true, prediction_source: 'user_confirmed' }
          : t
      )
    )
  }

  // Category change via modal
  async function saveEdit() {
    if (!edit) return
    setEdit({ ...edit, isSaving: true })

    await fetch('/api/transactions/recategorise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactionId: edit.transactionId,
        field: 'category_id',
        newValue: edit.newValue,
        applyToSimilar: edit.applyToSimilar,
        description: edit.description,
      }),
    })

    setEdit(null)
    onRecategorised()
  }

  if (filtered.length === 0) {
    return (
      <div className="rounded-lg border border-border p-12 text-center text-muted-foreground text-sm">
        {transactions.length === 0 ? 'No transactions yet. Upload a bank statement to get started.' : 'No transactions match your filters.'}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Mobile: card list */}
      <div className="md:hidden space-y-2">
        {pageRows.map((t) => {
          const cat = categories.find((c) => c.id === t.category_id) ?? null
          return (
            <div key={t.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{t.description}</p>
                  <p className="text-xs text-muted-foreground">{t.date}</p>
                </div>
                <span className={`text-sm font-medium tabular-nums shrink-0 ${t.amount >= 0 ? 'text-green-600' : 'text-foreground'}`}>
                  {formatAmount(t.amount, t.currency)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => setEdit({ transactionId: t.id, newValue: t.category_id ?? '', applyToSimilar: false, description: t.description, isSaving: false })}
                  className="min-h-[36px] flex items-center"
                >
                  <CategoryBadge category={cat} />
                </button>
                <ValueCategoryPill
                  transactionId={t.id}
                  currentCategory={t.value_category}
                  confidence={t.value_confidence ?? 0}
                  description={t.description}
                  onUpdate={(newCat) => handleValueUpdate(t.id, newCat)}
                />
                {t.is_recurring && <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">recurring</span>}
                {t.is_holiday_spend && <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">holiday</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">Date</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Description</th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">Amount</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Category</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pageRows.map((t) => {
              const cat = categories.find((c) => c.id === t.category_id) ?? null
              return (
                <tr key={t.id} className="bg-card hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{t.date}</td>
                  <td className="px-4 py-2.5 max-w-[300px]">
                    <span className="block truncate" title={t.description}>{t.description}</span>
                    <div className="flex gap-1 mt-0.5">
                      {t.is_recurring && <span className="text-xs text-blue-600">recurring</span>}
                      {t.is_holiday_spend && <span className="text-xs text-purple-600">holiday</span>}
                    </div>
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap ${t.amount >= 0 ? 'text-green-600' : 'text-foreground'}`}>
                    {formatAmount(t.amount, t.currency)}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => setEdit({ transactionId: t.id, newValue: t.category_id ?? '', applyToSimilar: false, description: t.description, isSaving: false })}
                      className="hover:opacity-70 transition-opacity"
                    >
                      <CategoryBadge category={cat} />
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <ValueCategoryPill
                      transactionId={t.id}
                      currentCategory={t.value_category}
                      confidence={t.value_confidence ?? 0}
                      description={t.description}
                      onUpdate={(newCat) => handleValueUpdate(t.id, newCat)}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded border border-input disabled:opacity-40 min-h-[36px]"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 rounded border border-input disabled:opacity-40 min-h-[36px]"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Category recategorise modal (value category now handled by pill) */}
      {edit && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setEdit(null) }}
        >
          <div className="bg-card rounded-t-2xl md:rounded-xl border border-border w-full max-w-sm p-5 space-y-4">
            <div>
              <h3 className="font-semibold text-foreground">Change category</h3>
              <p className="text-sm text-muted-foreground mt-0.5 truncate">{edit.description}</p>
            </div>

            <select
              value={edit.newValue}
              onChange={(e) => setEdit({ ...edit, newValue: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px]"
            >
              <option value="">Uncategorised</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <div className="flex gap-2">
              <button
                onClick={saveEdit}
                disabled={edit.isSaving}
                className="flex-1 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-40"
              >
                {edit.isSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setEdit(null)}
                className="rounded-md border border-input px-4 py-2 text-sm min-h-[44px]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
