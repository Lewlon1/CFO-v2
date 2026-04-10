'use client'

import type { Category } from '@/lib/parsers/types'

export type FilterState = {
  search: string
  categoryId: string
  valueCategory: string
  month: string  // YYYY-MM or ''
}

type Props = {
  filters: FilterState
  onChange: (filters: FilterState) => void
  categories: Category[]
}

const VALUE_OPTIONS = [
  { value: 'foundation', label: 'Foundation' },
  { value: 'investment', label: 'Investment' },
  { value: 'leak', label: 'Leak' },
  { value: 'burden', label: 'Burden' },
  { value: 'no_idea', label: 'No Idea' },
]

export function TransactionFilters({ filters, onChange, categories }: Props) {
  function set(patch: Partial<FilterState>) {
    onChange({ ...filters, ...patch })
  }

  const hasActive = filters.search || filters.categoryId || filters.valueCategory || filters.month

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <input
        type="search"
        placeholder="Search transactions…"
        value={filters.search}
        onChange={(e) => set({ search: e.target.value })}
        className="flex-1 min-w-[160px] rounded-md border border-input bg-background px-3 py-1.5 text-sm min-h-[36px] placeholder:text-muted-foreground"
      />

      <select
        value={filters.categoryId}
        onChange={(e) => set({ categoryId: e.target.value })}
        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm min-h-[36px]"
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <select
        value={filters.valueCategory}
        onChange={(e) => set({ valueCategory: e.target.value })}
        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm min-h-[36px]"
      >
        <option value="">All value types</option>
        {VALUE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      <input
        type="month"
        value={filters.month}
        onChange={(e) => set({ month: e.target.value })}
        className="rounded-md border border-input bg-background px-3 py-1.5 text-sm min-h-[36px]"
      />

      {hasActive && (
        <button
          onClick={() => onChange({ search: '', categoryId: '', valueCategory: '', month: '' })}
          className="text-sm text-muted-foreground hover:text-foreground underline min-h-[36px] px-1"
        >
          Clear
        </button>
      )}
    </div>
  )
}
