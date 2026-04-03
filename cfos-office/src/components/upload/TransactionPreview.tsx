'use client'

import { useState } from 'react'
import type { PreviewTransaction, Category } from '@/lib/parsers/types'

const VALUE_OPTIONS = [
  { value: 'foundation', label: 'Foundation' },
  { value: 'investment', label: 'Investment' },
  { value: 'leak', label: 'Leak' },
  { value: 'burden', label: 'Burden' },
  { value: 'unsure', label: 'Unsure' },
]

type RowState = {
  categoryId: string | null
  valueCategory: string
  selected: boolean
}

type Props = {
  transactions: PreviewTransaction[]
  categories: Category[]
  onConfirm: (rows: Array<PreviewTransaction & { categoryId: string | null; valueCategory: string }>) => void
  onCancel: () => void
  isImporting?: boolean
}

function formatAmount(amount: number, currency: string) {
  const abs = Math.abs(amount)
  const formatted = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency
  const sign = amount < 0 ? '-' : '+'
  return `${sign}${symbol}${formatted}`
}

export function TransactionPreview({ transactions, categories, onConfirm, onCancel, isImporting }: Props) {
  const [rows, setRows] = useState<RowState[]>(() =>
    transactions.map((t) => ({
      categoryId: t.suggestedCategoryId,
      valueCategory: t.suggestedValueCategory,
      selected: !t.isDuplicate,
    }))
  )

  const allSelected = rows.every((r) => r.selected)
  const someSelected = rows.some((r) => r.selected)
  const selectedCount = rows.filter((r) => r.selected).length

  function toggleAll() {
    const next = !allSelected
    setRows((prev) => prev.map((r) => ({ ...r, selected: next })))
  }

  function setRow(i: number, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  function handleConfirm() {
    const selected = transactions
      .map((t, i) => ({ ...t, categoryId: rows[i].categoryId, valueCategory: rows[i].valueCategory }))
      .filter((_, i) => rows[i].selected)
    onConfirm(selected)
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-foreground">Review transactions</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          {transactions.filter((t) => t.isDuplicate).length > 0
            ? `${transactions.filter((t) => t.isDuplicate).length} duplicates detected (amber rows). Deselect any you don't want to import.`
            : 'Review and adjust categories before importing.'}
        </p>
      </div>

      {/* Mobile: card list */}
      <div className="md:hidden space-y-2 max-h-[60vh] overflow-y-auto">
        {transactions.map((t, i) => {
          const row = rows[i]
          return (
            <div
              key={i}
              className={`rounded-lg border p-3 space-y-2 ${
                t.isDuplicate ? 'border-amber-300 bg-amber-50' : 'border-border bg-card'
              } ${!row.selected ? 'opacity-50' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <label className="flex items-center gap-2 min-h-[44px] flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(e) => setRow(i, { selected: e.target.checked })}
                    className="h-4 w-4 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{t.description}</p>
                    <p className="text-xs text-muted-foreground">{t.date}</p>
                  </div>
                </label>
                <span
                  className={`text-sm font-medium tabular-nums shrink-0 ${
                    t.amount >= 0 ? 'text-green-600' : 'text-foreground'
                  }`}
                >
                  {formatAmount(t.amount, t.currency)}
                </span>
              </div>

              <div className="flex gap-2">
                <select
                  value={row.categoryId ?? ''}
                  onChange={(e) => setRow(i, { categoryId: e.target.value || null })}
                  className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs min-h-[36px]"
                >
                  <option value="">Uncategorised</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select
                  value={row.valueCategory}
                  onChange={(e) => setRow(i, { valueCategory: e.target.value })}
                  className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs min-h-[36px]"
                >
                  {VALUE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )
        })}
      </div>

      {/* Desktop: table */}
      <div className="hidden md:block rounded-lg border border-border overflow-hidden">
        <div className="max-h-[50vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected }}
                    onChange={toggleAll}
                    className="h-4 w-4"
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Description</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Amount</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Category</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transactions.map((t, i) => {
                const row = rows[i]
                return (
                  <tr
                    key={i}
                    className={`${
                      t.isDuplicate ? 'bg-amber-50' : 'bg-card'
                    } ${!row.selected ? 'opacity-50' : ''}`}
                  >
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={(e) => setRow(i, { selected: e.target.checked })}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{t.date}</td>
                    <td className="px-3 py-2 max-w-[240px]">
                      <span className="block truncate" title={t.description}>{t.description}</span>
                      {t.isDuplicate && (
                        <span className="text-xs text-amber-600 font-medium">duplicate</span>
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium ${
                      t.amount >= 0 ? 'text-green-600' : 'text-foreground'
                    }`}>
                      {formatAmount(t.amount, t.currency)}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={row.categoryId ?? ''}
                        onChange={(e) => setRow(i, { categoryId: e.target.value || null })}
                        className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
                      >
                        <option value="">Uncategorised</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={row.valueCategory}
                        onChange={(e) => setRow(i, { valueCategory: e.target.value })}
                        className="w-full rounded border border-input bg-background px-2 py-1 text-xs"
                      >
                        {VALUE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          onClick={handleConfirm}
          disabled={selectedCount === 0 || isImporting}
          className="flex-1 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium min-h-[44px] disabled:opacity-40"
        >
          {isImporting ? 'Importing…' : `Import ${selectedCount} transaction${selectedCount !== 1 ? 's' : ''}`}
        </button>
        <button
          onClick={onCancel}
          disabled={isImporting}
          className="rounded-md border border-input px-4 py-2 text-sm min-h-[44px]"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
