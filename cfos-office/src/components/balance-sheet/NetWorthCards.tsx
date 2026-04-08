'use client'

import { TrendingDown, TrendingUp, ArrowRight } from 'lucide-react'
import { formatCurrency } from '@/lib/constants/dashboard'

type Props = {
  netWorth: number
  totalAssets: number
  totalLiabilities: number
  accessibleAssets: number
  netWorthChange: number | null
  netWorthChangePct: number | null
  currency?: string
}

export function NetWorthCards({
  netWorth,
  totalAssets,
  totalLiabilities,
  accessibleAssets,
  netWorthChange,
  netWorthChangePct,
  currency = 'EUR',
}: Props) {
  const positive = (netWorthChange ?? 0) >= 0

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Net Worth — primary */}
      <div className="rounded-lg border border-border bg-card p-4 sm:col-span-2 lg:col-span-1">
        <p className="text-xs text-muted-foreground mb-1">Net Worth</p>
        <p
          className={`text-2xl font-semibold tabular-nums ${
            netWorth >= 0 ? 'text-foreground' : 'text-red-400'
          }`}
        >
          {netWorth < 0 ? '-' : ''}
          {formatCurrency(Math.abs(netWorth), currency)}
        </p>
        {netWorthChange != null && (
          <div
            className={`flex items-center gap-1 mt-1 text-xs ${
              positive ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            <span className="tabular-nums">
              {positive ? '+' : '-'}
              {formatCurrency(Math.abs(netWorthChange), currency)}
              {netWorthChangePct != null && ` (${positive ? '+' : ''}${netWorthChangePct.toFixed(1)}%)`}
            </span>
          </div>
        )}
      </div>

      {/* Total Assets */}
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground mb-1">Total Assets</p>
        <p className="text-lg font-semibold text-emerald-400 tabular-nums">
          {formatCurrency(totalAssets, currency)}
        </p>
      </div>

      {/* Total Liabilities */}
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground mb-1">Total Liabilities</p>
        <p className="text-lg font-semibold text-red-400 tabular-nums">
          {formatCurrency(totalLiabilities, currency)}
        </p>
      </div>

      {/* Accessible */}
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
          Accessible <ArrowRight className="w-3 h-3" />
        </p>
        <p className="text-lg font-semibold text-foreground tabular-nums">
          {formatCurrency(accessibleAssets, currency)}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">Available within days</p>
      </div>
    </div>
  )
}
