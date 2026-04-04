'use client'

import { TrendingDown, TrendingUp } from 'lucide-react'
import { formatCurrency } from '@/lib/constants/dashboard'

type Props = {
  totalIncome: number
  totalSpending: number
  surplusDeficit: number
  vsPreviousMonthPct: number | null
  currency?: string
}

export function SummaryCards({ totalIncome, totalSpending, surplusDeficit, vsPreviousMonthPct, currency = 'EUR' }: Props) {
  const hasIncome = totalIncome > 0

  return (
    <div className="grid grid-cols-3 gap-3">
      {/* Income */}
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground mb-1">Income</p>
        {hasIncome ? (
          <p className="text-lg font-semibold text-emerald-400 tabular-nums">
            {formatCurrency(totalIncome, currency)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No income detected</p>
        )}
      </div>

      {/* Spending */}
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground mb-1">Spending</p>
        <p className="text-lg font-semibold text-foreground tabular-nums">
          {formatCurrency(totalSpending, currency)}
        </p>
        {vsPreviousMonthPct !== null && (
          <div className={`flex items-center gap-1 mt-1 text-xs ${
            vsPreviousMonthPct <= 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {vsPreviousMonthPct <= 0 ? (
              <TrendingDown className="w-3 h-3" />
            ) : (
              <TrendingUp className="w-3 h-3" />
            )}
            <span>{Math.abs(vsPreviousMonthPct).toFixed(1)}%</span>
          </div>
        )}
      </div>

      {/* Surplus / Deficit */}
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground mb-1">
          {surplusDeficit >= 0 ? 'Surplus' : 'Deficit'}
        </p>
        {hasIncome ? (
          <p className={`text-lg font-semibold tabular-nums ${
            surplusDeficit >= 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {surplusDeficit >= 0 ? '+' : '-'}{formatCurrency(Math.abs(surplusDeficit), currency)}
          </p>
        ) : (
          <p className="text-lg font-semibold text-muted-foreground">&mdash;</p>
        )}
      </div>
    </div>
  )
}
