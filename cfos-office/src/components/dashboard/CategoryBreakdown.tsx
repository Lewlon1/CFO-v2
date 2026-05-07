'use client'

import { CATEGORY_COLORS, formatCurrency } from '@/lib/constants/dashboard'
import type { CategorySummary } from '@/app/api/dashboard/summary/route'
import * as LucideIcons from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

function getIcon(name: string): LucideIcon {
  // Convert kebab-case to PascalCase to look up the named export.
  const pascal = name
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
  // The lucide-react module is a Record<string, LucideIcon> at runtime; the
  // namespace cast here is the cleanest way to do a dynamic lookup.
  const icons = LucideIcons as unknown as Record<string, LucideIcon>
  return icons[pascal] ?? LucideIcons.Circle
}

type Props = {
  categories: Record<string, CategorySummary>
  month: string
  onCategoryClick: (slug: string) => void
}

export function CategoryBreakdown({ categories, onCategoryClick }: Props) {
  const sorted = Object.entries(categories).sort(([, a], [, b]) => b.amount - a.amount)

  if (sorted.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <h3 className="text-sm font-medium text-muted-foreground px-4 pt-4 pb-2">Category Breakdown</h3>
      <div className="divide-y divide-border">
        {sorted.map(([slug, cat]) => {
          const Icon = getIcon(cat.icon)
          const color = CATEGORY_COLORS[cat.color] ?? '#6B7280'

          return (
            <button
              key={slug}
              onClick={() => onCategoryClick(slug)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left min-h-[44px]"
            >
              <div
                className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: color + '1A' }}
              >
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{cat.name}</p>
                <p className="text-xs text-muted-foreground">{cat.count} transaction{cat.count !== 1 ? 's' : ''}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-medium text-foreground tabular-nums">{formatCurrency(cat.amount)}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{cat.pct.toFixed(1)}%</p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
