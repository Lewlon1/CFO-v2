'use client'

import Link from 'next/link'
import { SysTag } from '@/components/trust/SysTag'

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
        href="/chat?prefill=I%27d+like+to+set+up+my+balance+sheet"
        className="flex flex-col items-center gap-3 py-6 text-center"
      >
        <p className="text-sm text-office-text-secondary">
          Track your assets and debts to see your net worth
        </p>
        <span className="text-sm font-medium text-office-purple">Set up &rarr;</span>
      </Link>
    )
  }

  const netWorth = totalAssets - totalLiabilities

  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-[8px] bg-bg-deep px-3 py-2.5">
        <p className="font-data text-[8px] uppercase tracking-[0.06em] text-text-tertiary mb-1">Assets</p>
        <p className="font-data text-[16px] font-extrabold tracking-[-0.03em] text-positive leading-tight">
          {formatCurrency(totalAssets, currency)}
        </p>
        <SysTag />
      </div>
      <div className="rounded-[8px] bg-bg-deep px-3 py-2.5">
        <p className="font-data text-[8px] uppercase tracking-[0.06em] text-text-tertiary mb-1">Liabilities</p>
        <p className="font-data text-[16px] font-extrabold tracking-[-0.03em] text-negative leading-tight">
          {formatCurrency(totalLiabilities, currency)}
        </p>
        <SysTag />
      </div>
      <div className="rounded-[8px] bg-bg-deep px-3 py-2.5">
        <p className="font-data text-[8px] uppercase tracking-[0.06em] text-text-tertiary mb-1">Net Worth</p>
        <p className={`font-data text-[16px] font-extrabold tracking-[-0.03em] leading-tight ${netWorth >= 0 ? 'text-positive' : 'text-negative'}`}>
          {formatCurrency(netWorth, currency)}
        </p>
        <SysTag />
      </div>
    </div>
  )
}

export default NetWorthSection
