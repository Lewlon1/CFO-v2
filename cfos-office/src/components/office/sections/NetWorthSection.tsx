'use client'

import Link from 'next/link'
import { formatCurrencyRounded } from '@/lib/utils/format-currency-rounded'
import { colors, folderColors } from '@/lib/tokens'

interface NetWorthSectionProps {
  totalAssets: number
  totalLiabilities: number
  currency?: string
  hasData: boolean
}

export function NetWorthSection({ totalAssets, totalLiabilities, currency = 'EUR', hasData }: NetWorthSectionProps) {
  if (!hasData) {
    return (
      <Link
        href="/office/net-worth/upload"
        className="flex flex-col items-center gap-3 py-6 text-center w-full"
      >
        <p className="text-sm text-text-secondary">
          Track your assets and debts to see your net worth
        </p>
        <span className="text-sm font-medium text-folder-networth">Set up &rarr;</span>
      </Link>
    )
  }

  const netWorth = totalAssets - totalLiabilities
  const pctAssets = totalAssets > 0 ? (totalAssets / (totalAssets + totalLiabilities)) * 100 : 100

  return (
    <div className="pt-1">
      <div className="flex items-baseline gap-1.5">
        <span className={`font-data text-h1 font-extrabold tracking-[-0.03em] tabular-nums ${netWorth >= 0 ? 'text-folder-networth' : 'text-negative'}`}>
          {formatCurrencyRounded(netWorth, currency)}
        </span>
        <span className="text-label text-text-tertiary">net worth</span>
      </div>
      {(totalAssets > 0 || totalLiabilities > 0) && (
        <div className="flex h-[5px] rounded-[3px] overflow-hidden mt-2">
          <div style={{ flex: pctAssets, background: folderColors.networth }} />
          {totalLiabilities > 0 && (
            <div style={{ flex: 100 - pctAssets, background: colors.negative }} />
          )}
        </div>
      )}
    </div>
  )
}

export default NetWorthSection
