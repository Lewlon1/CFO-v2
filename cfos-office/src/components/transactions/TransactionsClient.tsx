'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UploadWizard } from '@/components/upload/UploadWizard'
import { TransactionList, type Transaction } from './TransactionList'
import { TransactionFilters, type FilterState } from './TransactionFilters'
import type { Category } from '@/lib/parsers/types'

type Props = {
  transactions: Transaction[]
  categories: Category[]
}

export function TransactionsClient({ transactions, categories }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [showUpload, setShowUpload] = useState(transactions.length === 0)
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    categoryId: '',
    valueCategory: '',
    month: '',
  })

  function handleImported() {
    // Data is ready — refresh the transaction list but keep the panel open
    // so the user can see the ImportResult screen and choose what to do next
    startTransition(() => router.refresh())
  }

  function handleDone() {
    setShowUpload(false)
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
            onChange={setFilters}
            categories={categories}
          />
          <TransactionList
            transactions={transactions}
            categories={categories}
            filters={filters}
            onRecategorised={() => startTransition(() => router.refresh())}
          />
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
