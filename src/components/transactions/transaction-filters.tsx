"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "@/components/ui/select"
import type { BankAccount, Category, TransactionType } from "@/lib/types/database"

export type FilterState = {
  dateFrom: string
  dateTo: string
  type: TransactionType | "all"
  categoryId: string
  accountId: string
  search: string
}

type PeriodPreset = "this_month" | "last_month" | "last_3_months" | "custom"

function getPresetDates(preset: PeriodPreset): { dateFrom: string; dateTo: string } {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  if (preset === "this_month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return { dateFrom: from.toISOString().slice(0, 10), dateTo: today }
  }
  if (preset === "last_month") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth(), 0)
    return { dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) }
  }
  if (preset === "last_3_months") {
    const from = new Date(now.getFullYear(), now.getMonth() - 2, 1)
    return { dateFrom: from.toISOString().slice(0, 10), dateTo: today }
  }
  return { dateFrom: "", dateTo: "" }
}

function detectPreset(dateFrom: string, dateTo: string): PeriodPreset {
  const presets: PeriodPreset[] = ["this_month", "last_month", "last_3_months"]
  for (const p of presets) {
    const { dateFrom: pFrom, dateTo: pTo } = getPresetDates(p)
    if (pFrom === dateFrom && pTo === dateTo) return p
  }
  return "custom"
}

type Props = {
  filters: FilterState
  onChange: (filters: FilterState) => void
  accounts: BankAccount[]
  categories: Category[]
}

export function TransactionFilters({ filters, onChange, accounts, categories }: Props) {
  function update(patch: Partial<FilterState>) {
    onChange({ ...filters, ...patch })
  }

  const activePreset = detectPreset(filters.dateFrom, filters.dateTo)

  function applyPreset(preset: PeriodPreset) {
    if (preset === "custom") return
    const { dateFrom, dateTo } = getPresetDates(preset)
    update({ dateFrom, dateTo })
  }

  const presets: { value: PeriodPreset; label: string }[] = [
    { value: "this_month", label: "This month" },
    { value: "last_month", label: "Last month" },
    { value: "last_3_months", label: "Last 3 months" },
    { value: "custom", label: "Custom" },
  ]

  return (
    <div className="space-y-3">
      {/* Period presets */}
      <div className="flex gap-1 flex-wrap">
        {presets.map((p) => (
          <Button
            key={p.value}
            variant={activePreset === p.value ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-3"
            onClick={() => applyPreset(p.value)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Custom date inputs — only visible when custom is active */}
      {activePreset === "custom" && (
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              className="h-8 text-sm w-36"
              value={filters.dateFrom}
              onChange={(e) => update({ dateFrom: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              className="h-8 text-sm w-36"
              value={filters.dateTo}
              onChange={(e) => update({ dateTo: e.target.value })}
            />
          </div>
        </div>
      )}

      {/* Other filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select
            value={filters.type}
            onValueChange={(v: unknown) =>
              update({ type: v as TransactionType | "all" })
            }
          >
            <SelectTrigger className="h-8 w-32 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="income">Income</SelectItem>
              <SelectItem value="expense">Expense</SelectItem>
              <SelectItem value="transfer">Transfer</SelectItem>
            </SelectPopup>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Account</Label>
          <Select
            value={filters.accountId}
            onValueChange={(v: unknown) => update({ accountId: v as string })}
          >
            <SelectTrigger className="h-8 w-40 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Category</Label>
          <Select
            value={filters.categoryId}
            onValueChange={(v: unknown) => update({ categoryId: v as string })}
          >
            <SelectTrigger className="h-8 w-40 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>

        <div className="space-y-1 flex-1 min-w-[160px]">
          <Label className="text-xs">Search</Label>
          <Input
            className="h-8 text-sm"
            placeholder="Merchant or description…"
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}
