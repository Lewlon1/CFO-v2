'use client'

import Link from 'next/link'

function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

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
        <span className="text-sm font-medium text-[#06B6D4]">Set up &rarr;</span>
      </Link>
    )
  }

  const netWorth = totalAssets - totalLiabilities

  return (
    <div className="pt-1">
      <div className="flex items-baseline gap-1.5">
        <span className={`font-data text-[16px] font-extrabold tracking-[-0.03em] ${netWorth >= 0 ? 'text-[#06B6D4]' : 'text-[#F43F5E]'}`}>
          {formatCurrency(netWorth, currency)}
        </span>
        <span className="text-[11px] text-[rgba(245,245,240,0.3)]">net worth</span>
      </div>
    </div>
  )
}

export default NetWorthSection
