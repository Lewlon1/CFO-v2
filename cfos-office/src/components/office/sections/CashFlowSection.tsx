'use client'

import { Upload } from 'lucide-react'
import Link from 'next/link'
import { SysTag } from '@/components/trust/SysTag'
import { ProvenanceLine } from '@/components/trust/ProvenanceLine'
import { ConfidenceFlag } from '@/components/trust/ConfidenceFlag'
import type { DashboardSummary } from '@/app/api/dashboard/summary/route'

function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

interface CashFlowSectionProps {
  summary: DashboardSummary | undefined
  isLoading: boolean
  currency?: string
  provenance?: {
    source: string | null
    uploadDate: string | null
  }
}

export function CashFlowSection({ summary, isLoading, currency = 'EUR', provenance }: CashFlowSectionProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-16 rounded-lg bg-office-bg-tertiary animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!summary) {
    return (
      <Link
        href="/chat?prefill=I%27d+like+to+upload+my+first+bank+statement"
        className="flex flex-col items-center gap-3 py-6 text-center"
      >
        <div className="w-10 h-10 rounded-full bg-office-bg-tertiary flex items-center justify-center">
          <Upload size={18} className="text-office-text-muted" />
        </div>
        <p className="text-sm text-office-text-secondary">
          Upload your first CSV to see your cash flow
        </p>
        <span className="text-sm font-medium text-office-gold">Upload &rarr;</span>
      </Link>
    )
  }

  const { total_income, total_spending, surplus_deficit, spending_by_category, recurring, transaction_count } = summary

  // Top 3 categories by amount
  const topCategories = Object.entries(spending_by_category)
    .sort(([, a], [, b]) => b.amount - a.amount)
    .slice(0, 3)

  const maxCatAmount = topCategories[0]?.[1]?.amount ?? 1

  return (
    <div className="space-y-4">
      {/* Metric cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-office-bg-tertiary px-3 py-2.5">
          <p className="text-[11px] text-office-text-muted mb-1">Income</p>
          <p className="font-data text-lg text-office-green leading-tight">
            {formatCurrency(total_income, currency)}
          </p>
          <SysTag />
        </div>
        <div className="rounded-lg bg-office-bg-tertiary px-3 py-2.5">
          <p className="text-[11px] text-office-text-muted mb-1">Spending</p>
          <p className="font-data text-lg text-office-red leading-tight">
            {formatCurrency(total_spending, currency)}
          </p>
          <SysTag />
        </div>
        <div className="rounded-lg bg-office-bg-tertiary px-3 py-2.5">
          <p className="text-[11px] text-office-text-muted mb-1">
            {surplus_deficit >= 0 ? 'Surplus' : 'Deficit'}
          </p>
          <p className={`font-data text-lg leading-tight ${surplus_deficit >= 0 ? 'text-office-green' : 'text-office-red'}`}>
            {formatCurrency(surplus_deficit, currency)}
          </p>
          <SysTag />
        </div>
      </div>

      {/* Provenance */}
      <ProvenanceLine
        transactionCount={transaction_count}
        source={provenance?.source}
        uploadDate={provenance?.uploadDate}
      />

      {/* Confidence flag */}
      <ConfidenceFlag />

      {/* Top 3 categories */}
      {topCategories.length > 0 && (
        <div className="space-y-2">
          {topCategories.map(([slug, cat]) => (
            <div key={slug} className="flex items-center gap-3">
              <span className="w-20 text-xs text-office-text-secondary truncate">{cat.name}</span>
              <div className="flex-1 h-2 rounded-full bg-office-bg-tertiary overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(cat.amount / maxCatAmount) * 100}%`,
                    backgroundColor: cat.color || 'var(--office-gold)',
                  }}
                />
              </div>
              <span className="font-data text-xs text-office-text-secondary w-16 text-right">
                {formatCurrency(cat.amount, currency)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Recurring total */}
      {recurring && recurring.monthly_total > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <span className="font-data text-sm text-office-text">
            {formatCurrency(recurring.monthly_total, currency)}/mo recurring
          </span>
          <SysTag />
        </div>
      )}
    </div>
  )
}

export default CashFlowSection
