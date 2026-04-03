"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { TransactionFilters, type FilterState } from "./transaction-filters"
import { TransactionSummaryBar } from "./transaction-summary-bar"
import { AddTransactionPanel } from "./add-transaction-panel"
import { UncategorisedAttention } from "./uncategorised-attention"
import { MonthOnMonthInsights } from "./month-on-month-insights"
import { PlusIcon, ReceiptIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react"
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { getDisplayMerchant } from "@/lib/categorisation/merchant-display"
import type { BankAccount, Category, Transaction } from "@/lib/types/database"

const PAGE_SIZE = 50

function defaultFilters(): FilterState {
  return {
    dateFrom: "",
    dateTo: "",
    type: "all",
    categoryId: "all",
    accountId: "all",
    search: "",
  }
}

function isDefaultFilters(f: FilterState): boolean {
  return (
    f.dateFrom === "" &&
    f.dateTo === "" &&
    f.type === "all" &&
    f.categoryId === "all" &&
    f.accountId === "all" &&
    f.search === ""
  )
}

type Props = {
  accounts: BankAccount[]
  categories: Category[]
  profileId: string
}

export function TransactionList({ accounts, categories, profileId }: Props) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const supabase = useMemo(() => createClient(), [])

  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [dismissedDuplicates, setDismissedDuplicates] = useState<Set<string>>(new Set())

  const duplicateIds = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const tx of transactions) {
      const key = `${(tx.merchant ?? tx.description ?? "").toLowerCase().trim()}|${tx.transaction_date}|${tx.amount}`
      const group = groups.get(key) ?? []
      group.push(tx.id)
      groups.set(key, group)
    }
    const ids = new Set<string>()
    for (const group of groups.values()) {
      if (group.length >= 2) group.forEach((id) => ids.add(id))
    }
    return ids
  }, [transactions])

  const fetchTransactions = useCallback(async () => {
    setLoading(true)

    let query = supabase
      .from("transactions")
      .select("*", { count: "exact" })
      .eq("profile_id", profileId)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    if (filters.dateFrom) query = query.gte("transaction_date", filters.dateFrom)
    if (filters.dateTo) query = query.lte("transaction_date", filters.dateTo)
    if (filters.type !== "all") query = query.eq("type", filters.type)
    if (filters.categoryId !== "all") query = query.eq("category_id", filters.categoryId)
    if (filters.accountId !== "all") query = query.eq("bank_account_id", filters.accountId)
    if (filters.search) {
      query = query.or(
        `description.ilike.%${filters.search}%,merchant.ilike.%${filters.search}%`
      )
    }

    const { data, count } = await query
    setTransactions((data as Transaction[]) ?? [])
    setTotalCount(count ?? 0)
    setLoading(false)
  }, [supabase, profileId, filters, page])

  useEffect(() => {
    setPage(0)
  }, [filters])

  useEffect(() => {
    fetchTransactions()
  }, [fetchTransactions])

  useEffect(() => {
    setSelectedIds(new Set())
  }, [filters, page])

  function handleFiltersChange(f: FilterState) {
    setFilters(f)
  }

  function handleAddClick() {
    setEditingTx(null)
    setModalOpen(true)
  }

  function handleRowClick(tx: Transaction) {
    setEditingTx(tx)
    setModalOpen(true)
  }

  function handleSuccess(tx: Transaction) {
    setTransactions((prev) => {
      const idx = prev.findIndex((t) => t.id === tx.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = tx
        return next
      }
      return [tx, ...prev]
    })
    setTotalCount((n) => n + 1)
  }

  function handleDelete(id: string) {
    setTransactions((prev) => prev.filter((t) => t.id !== id))
    setTotalCount((n) => Math.max(0, n - 1))
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    setBulkDeleting(true)

    const toDelete = transactions.filter((t) => selectedIds.has(t.id))
    const affectedMonths = new Set(
      toDelete.map((t) => {
        const d = new Date(t.transaction_date)
        return `${d.getFullYear()}-${d.getMonth() + 1}`
      })
    )

    const { error } = await supabase
      .from("transactions")
      .delete()
      .eq("profile_id", profileId)
      .in("id", [...selectedIds])

    if (error) {
      setBulkDeleting(false)
      return
    }

    for (const ym of affectedMonths) {
      const [year, month] = ym.split("-").map(Number)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)("fn_generate_monthly_snapshot", {
        p_profile_id: profileId,
        p_year: year,
        p_month: month,
      })
    }

    setSelectedIds(new Set())
    setConfirmDeleteOpen(false)
    setBulkDeleting(false)
    fetchTransactions()
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  if (!loading && totalCount === 0 && page === 0 && isDefaultFilters(filters)) {
    return (
      <>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <ReceiptIcon className="size-10 text-muted-foreground mb-3" />
            <p className="font-medium text-sm">No transactions yet</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Upload a CSV or add a transaction manually to get started.
            </p>
            <div className="flex gap-2">
              <Link
                href="/transactions/upload"
                className="inline-flex h-8 items-center rounded-lg bg-primary text-primary-foreground px-3 text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Upload
              </Link>
              <Button onClick={handleAddClick}>
                <PlusIcon className="size-4 mr-2" />
                Add manually
              </Button>
            </div>
          </CardContent>
        </Card>
        <AddTransactionPanel
          open={modalOpen}
          onOpenChange={setModalOpen}
          editingTransaction={editingTx}
          accounts={accounts}
          categories={categories}
          profileId={profileId}
          onSuccess={handleSuccess}
          onDelete={handleDelete}
        />

      </>
    )
  }

  return (
    <>
      <div className="space-y-4">
        <UncategorisedAttention
          profileId={profileId}
          categories={categories}
          onCategorised={fetchTransactions}
        />

        <TransactionFilters
          filters={filters}
          onChange={handleFiltersChange}
          accounts={accounts}
          categories={categories}
        />

        <TransactionSummaryBar transactions={transactions} />

        <div className="flex justify-end">
          <Button onClick={handleAddClick}>
            <PlusIcon className="size-4 mr-2" />
            Add transaction
          </Button>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-2.5 text-sm">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setSelectedIds(new Set())}
            >
              <XIcon className="size-4" />
            </button>
            <span className="font-medium">{selectedIds.size} selected</span>
            <Button
              variant="destructive"
              size="sm"
              className="ml-auto h-7"
              onClick={() => setConfirmDeleteOpen(true)}
            >
              Delete selected
            </Button>
          </div>
        )}

        <div className="rounded-lg border overflow-x-auto">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : transactions.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No transactions match your filters.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2.5 w-8">
                    <input
                      type="checkbox"
                      className="rounded border-border"
                      checked={transactions.length > 0 && transactions.every((t) => selectedIds.has(t.id))}
                      ref={(el) => {
                        if (el) {
                          const someSelected = transactions.some((t) => selectedIds.has(t.id))
                          const allSelected = transactions.every((t) => selectedIds.has(t.id))
                          el.indeterminate = someSelected && !allSelected
                        }
                      }}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(new Set(transactions.map((t) => t.id)))
                        } else {
                          setSelectedIds(new Set())
                        }
                      }}
                    />
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Description</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Merchant</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Category</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Account</th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => handleRowClick(tx)}
                  >
                    <td
                      className="px-4 py-3 w-8"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="rounded border-border"
                        checked={selectedIds.has(tx.id)}
                        onChange={(e) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(tx.id)
                            else next.delete(tx.id)
                            return next
                          })
                        }}
                      />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                      {tx.transaction_date}
                    </td>
                    <td className="px-4 py-3 max-w-[180px] truncate">
                      {tx.description ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 max-w-[140px] text-muted-foreground">
                      {(() => {
                        const { primary, secondary, isAmbiguous } = getDisplayMerchant(tx)
                        return (
                          <div className="flex flex-col">
                            <span className="truncate flex items-center gap-1">
                              {primary}
                              {isAmbiguous && (
                                <span className="text-xs opacity-60 shrink-0">?</span>
                              )}
                            </span>
                            {secondary && (
                              <span className="text-xs text-muted-foreground/60 truncate">{secondary}</span>
                            )}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      {tx.category_name ? (
                        <Badge variant="outline" className="text-xs">
                          {tx.category_name}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-[120px]">
                      {tx.account_name}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <span
                          className={cn(
                            "tabular-nums font-medium whitespace-nowrap",
                            tx.type === "income" && "text-green-600",
                            tx.type === "expense" && "text-red-500",
                            tx.type === "transfer" && "text-foreground"
                          )}
                        >
                          {tx.type === "income" ? "+" : tx.type === "expense" ? "-" : ""}
                          {tx.amount.toLocaleString("en", { minimumFractionDigits: 2 })}
                          <span className="text-xs text-muted-foreground font-normal ml-1">
                            {tx.currency}
                          </span>
                        </span>
                        {duplicateIds.has(tx.id) && !dismissedDuplicates.has(tx.id) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                            Possible duplicate
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setDismissedDuplicates((prev) => new Set(prev).add(tx.id))
                              }}
                              className="hover:text-amber-800 dark:hover:text-amber-200"
                              aria-label="Dismiss duplicate warning"
                            >×</button>
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <p className="text-muted-foreground">
              {totalCount} transactions · page {page + 1} of {totalPages}
            </p>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeftIcon className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRightIcon className="size-4" />
              </Button>
            </div>
          </div>
        )}

        <MonthOnMonthInsights profileId={profileId} />
      </div>

      <AddTransactionPanel
        open={modalOpen}
        onOpenChange={setModalOpen}
        editingTransaction={editingTx}
        accounts={accounts}
        categories={categories}
        profileId={profileId}
        onSuccess={handleSuccess}
        onDelete={handleDelete}
      />

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogPopup className="max-w-sm">
          <DialogClose />
          <DialogTitle>Delete {selectedIds.size} transaction{selectedIds.size !== 1 ? "s" : ""}?</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            This cannot be undone.
          </DialogDescription>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)} disabled={bulkDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={bulkDeleting}>
              {bulkDeleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogPopup>
      </Dialog>

    </>
  )
}
