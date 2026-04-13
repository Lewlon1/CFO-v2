'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UploadWizard } from '@/components/upload/UploadWizard'
import { TransactionList, type Transaction } from './TransactionList'
import { TransactionFilters, type FilterState } from './TransactionFilters'
import { BatchClassifier } from './BatchClassifier'
import { UncategorisedQueue, type UncategorisedTransaction } from './UncategorisedQueue'
import type { Category } from '@/lib/parsers/types'

type Props = {
  transactions: Transaction[]
  categories: Category[]
  initialFilters?: FilterState
  uncategorised?: UncategorisedTransaction[]
  uncategorisedCount?: number
}

const EMPTY_FILTERS: FilterState = { search: '', categoryId: '', valueCategory: '', month: '' }

export function TransactionsClient({ transactions, categories, initialFilters, uncategorised, uncategorisedCount }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [showUpload, setShowUpload] = useState(transactions.length === 0)
  const [filters, setFilters] = useState<FilterState>(initialFilters ?? EMPTY_FILTERS)

  const isBatchMode = filters.valueCategory === 'no_idea'

  function handleImported() {
    startTransition(() => router.refresh())
  }

  function handleDone() {
    setShowUpload(false)
  }

  function handleFilterChange(newFilters: FilterState) {
    setFilters(newFilters)
    // Sync to URL for deep-linking
    const params = new URLSearchParams()
    if (newFilters.search) params.set('search', newFilters.search)
    if (newFilters.categoryId) params.set('category', newFilters.categoryId)
    if (newFilters.valueCategory) params.set('value_category', newFilters.valueCategory)
    if (newFilters.month) params.set('month', newFilters.month)
    const qs = params.toString()
    router.replace(`/transactions${qs ? `?${qs}` : ''}`, { scroll: false })
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">Transactions</h1>
        {!showUpload && (
          <button
            onClick={() => setShowUpload(true)}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium min-h-[44px]"
          >
            Upload statement
          </button>
        )}
      </div>

      {/* Upload wizard panel */}
      {showUpload && (
        <div className="rounded-xl border border-border bg-card p-4 md:p-6">
          {transactions.length > 0 && (
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-foreground">Upload a bank statement</h2>
              <button
                onClick={() => setShowUpload(false)}
                className="text-sm text-muted-foreground hover:text-foreground min-h-[44px] px-2"
              >
                Cancel
              </button>
            </div>
          )}
          <UploadWizard categories={categories} onImported={handleImported} onDone={handleDone} />
        </div>
      )}

      {/* Transaction list */}
      {transactions.length > 0 && !showUpload && (
        <>
          <TransactionFilters
            filters={filters}
            onChange={handleFilterChange}
            categories={categories}
          />

          {isBatchMode ? (
            <BatchClassifier
              transactions={transactions}
              onClassified={() => startTransition(() => router.refresh())}
            />
          ) : (
            <>
              {uncategorised && uncategorised.length > 0 && (
                <UncategorisedQueue
                  transactions={uncategorised}
                  totalCount={uncategorisedCount ?? uncategorised.length}
                />
              )}
              <TransactionList
                transactions={transactions}
                categories={categories}
                filters={filters}
                onRecategorised={() => startTransition(() => router.refresh())}
              />
            </>
          )}
        </>
      )}

      {transactions.length > 0 && showUpload && (
        <p className="text-sm text-muted-foreground text-center">
          {transactions.length.toLocaleString()} transactions already imported.
        </p>
      )}
    </div>
  )
}
