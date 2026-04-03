"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { CategoryPicker } from "./category-picker"
import { Button } from "@/components/ui/button"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import type { PreviewRow, RowStatus } from "./csv-upload-wizard"
import type { Category } from "@/lib/types/database"

const PAGE_SIZE = 50

type Props = {
  rows: PreviewRow[]
  currency: string
  categories: Category[]
  onRowCategoryChange: (index: number, categoryId: string, categoryName: string) => void
  merchantCounts: Map<string, number>
}

function statusBadge(status: RowStatus) {
  switch (status) {
    case "ready":
      return <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-950/30">Ready</Badge>
    case "uncategorised":
      return <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30">Uncategorised</Badge>
    case "duplicate":
      return <Badge variant="outline" className="text-muted-foreground border-muted bg-muted/50">Already imported</Badge>
    case "error":
      return <Badge variant="outline" className="text-red-500 border-red-200 bg-red-50 dark:bg-red-950/30">Error</Badge>
  }
}

export function CsvPreviewTable({ rows, currency, categories, onRowCategoryChange, merchantCounts }: Props) {
  const [page, setPage] = useState(0)

  // Sort: non-duplicates first, then duplicates
  const sortedRows = useMemo(() => {
    const indexed = rows.map((row, i) => ({ row, originalIndex: i }))
    indexed.sort((a, b) => {
      const aDup = a.row.status === "duplicate" ? 1 : 0
      const bDup = b.row.status === "duplicate" ? 1 : 0
      return aDup - bDup
    })
    return indexed
  }, [rows])

  const totalPages = Math.ceil(sortedRows.length / PAGE_SIZE)
  const pageRows = sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <p className="text-muted-foreground">
          {rows.length} transactions
          {totalPages > 1 && ` · page ${page + 1} of ${totalPages}`}
        </p>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Merchant</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Amount</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Category</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map(({ row, originalIndex }) => {
              const isDuplicate = row.status === "duplicate"
              const isError = row.status === "error"
              const count = merchantCounts.get(row.normalised_merchant) ?? 0

              return (
                <tr
                  key={originalIndex}
                  className={cn(
                    "border-b last:border-0",
                    isDuplicate && "opacity-50 line-through",
                    isError && "bg-red-50 dark:bg-red-950/10"
                  )}
                >
                  <td className="px-3 py-2 tabular-nums text-xs whitespace-nowrap">
                    {row.transaction_date}
                  </td>
                  <td className="px-3 py-2 truncate max-w-[200px]">
                    {isError ? (
                      <span className="text-red-500 text-xs">{row.parseError}</span>
                    ) : (
                      <span className="text-muted-foreground">
                        {row.merchant || row.description || "—"}
                        {count > 1 && !isDuplicate && (
                          <span className="ml-1.5 text-xs text-muted-foreground/60">
                            ×{count}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums font-medium whitespace-nowrap",
                      row.type === "income" && "text-green-600",
                      row.type === "expense" && "text-red-500"
                    )}
                  >
                    {row.type === "income" ? "+" : row.type === "expense" ? "-" : ""}
                    {row.amount.toLocaleString("en", { minimumFractionDigits: 2 })}{" "}
                    <span className="text-xs text-muted-foreground font-normal">
                      {row.currency || currency}
                    </span>
                  </td>
                  <td className="px-3 py-2 min-w-[160px]">
                    {isDuplicate || isError ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {row.ai_suggested && (
                          <span
                            className="text-xs text-violet-500 shrink-0"
                            title="AI suggested category"
                            aria-label="AI suggested"
                          >
                            ✦
                          </span>
                        )}
                        <CategoryPicker
                          categories={categories.filter(
                            (c) => c.type === row.type || c.type === undefined
                          )}
                          value={row.category_id ?? null}
                          onValueChange={(val) => {
                            const cat = categories.find((c) => c.id === val)
                            onRowCategoryChange(originalIndex, val, cat?.name ?? "")
                          }}
                          placeholder="Select…"
                          rowType={row.type as Category["type"]}
                          includeNoCategory
                          className="h-7 text-xs w-full"
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {statusBadge(row.status)}
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
          <p className="text-muted-foreground">
            Page {page + 1} of {totalPages}
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
    </div>
  )
}
