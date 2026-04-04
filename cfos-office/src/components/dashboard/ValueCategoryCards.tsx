'use client'

import { Shield, TrendingUp, Droplets, Weight } from 'lucide-react'
import { VALUE_COLORS, formatCurrency } from '@/lib/constants/dashboard'
import type { ValueCategorySummary } from '@/app/api/dashboard/summary/route'

const VC_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  foundation: Shield,
  investment: TrendingUp,
  leak: Droplets,
  burden: Weight,
}

type EnrichedVCS = ValueCategorySummary & {
  top_categories?: { slug: string; name: string; amount: number }[]
}

type Props = {
  breakdown: Record<string, EnrichedVCS>
  month: string
  onCardClick: (vc: string) => void
}

export function ValueCategoryCards({ breakdown, onCardClick }: Props) {
  const order = ['foundation', 'investment', 'leak', 'burden']

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {order.map(vc => {
        const data = breakdown[vc]
        const colors = VALUE_COLORS[vc]
        const Icon = VC_ICONS[vc]

        return (
          <button
            key={vc}
            onClick={() => onCardClick(vc)}
            className={`rounded-lg border ${colors.border} ${colors.bg} p-4 text-left hover:opacity-90 transition-opacity min-h-[44px]`}
          >
            <div className="flex items-center gap-2 mb-2">
              {Icon && <Icon className={`w-4 h-4 ${colors.text}`} />}
              <span className={`text-xs font-medium ${colors.text}`}>{colors.label}</span>
            </div>
            <p className={`text-lg font-semibold ${colors.text} tabular-nums`}>
              {data ? formatCurrency(data.amount) : formatCurrency(0)}
            </p>
            {data && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.count} transaction{data.count !== 1 ? 's' : ''}
              </p>
            )}
            {data?.top_categories && data.top_categories.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {data.top_categories.map(tc => (
                  <div key={tc.slug} className="flex justify-between text-xs">
                    <span className="text-muted-foreground truncate mr-2">{tc.name}</span>
                    <span className="text-foreground tabular-nums flex-shrink-0">{formatCurrency(tc.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
