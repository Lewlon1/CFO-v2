'use client'

import { RefreshCw, AlertTriangle } from 'lucide-react'
import { formatCurrency } from '@/lib/constants/dashboard'
import type { RecurringItem } from '@/app/api/dashboard/summary/route'

function frequencyLabel(frequency: string): string {
  switch (frequency) {
    case 'bimonthly':      return 'every 2mo'
    case 'quarterly':      return 'quarterly'
    case 'every 6 months': return 'every 6mo'
    case 'annual':         return 'annual'
    default:               return frequency
  }
}

type Props = {
  items: RecurringItem[]
  monthlyTotal: number
}

export function RecurringPanel({ items, monthlyTotal }: Props) {
  if (items.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-muted-foreground">Recurring Bills</h3>
        </div>
        <span className="text-sm font-medium text-foreground tabular-nums">
          {formatCurrency(monthlyTotal)} ≈/mo
        </span>
      </div>
      <div className="divide-y divide-border">
        {items.slice(0, 8).map((item) => {
          const changed = item.previous_amount !== null && Math.abs(item.avg_amount - item.previous_amount) > 0.5
          return (
            <div key={item.description} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-foreground truncate">{item.description}</p>
                  {item.frequency !== 'monthly' && (
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {item.estimated_frequency ? '~' : ''}{frequencyLabel(item.frequency)}
                    </span>
                  )}
                  {item.frequency === 'monthly' && item.estimated_frequency && (
                    <span className="text-xs text-muted-foreground flex-shrink-0">~mo</span>
                  )}
                </div>
                {changed && item.previous_amount !== null && (
                  <div className="flex items-center gap-1 text-xs text-amber-400 mt-0.5">
                    <AlertTriangle className="w-3 h-3" />
                    <span>
                      {formatCurrency(item.previous_amount)} &rarr; {formatCurrency(item.avg_amount)}
                    </span>
                  </div>
                )}
              </div>
              <span className="text-sm text-foreground tabular-nums flex-shrink-0">
                {formatCurrency(item.avg_amount)}
              </span>
            </div>
          )
        })}
      </div>
      {items.length > 8 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          +{items.length - 8} more
        </p>
      )}
    </div>
  )
}
