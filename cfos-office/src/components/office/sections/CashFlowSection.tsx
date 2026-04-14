'use client'

import { Upload } from 'lucide-react'
import { useChatContext } from '@/components/chat/ChatProvider'
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

export function CashFlowSection({ summary, isLoading, currency = 'EUR' }: CashFlowSectionProps) {
  const { setInput, openSheet } = useChatContext()

  if (isLoading) {
    return (
      <div className="space-y-2 py-1">
        <div className="h-6 w-32 rounded bg-bg-deep animate-pulse" />
        <div className="h-6 w-24 rounded bg-bg-deep animate-pulse" />
      </div>
    )
  }

  if (!summary) {
    return (
      <button
        type="button"
        onClick={() => {
          setInput("I'd like to upload my first bank statement")
          openSheet()
        }}
        className="flex flex-col items-center gap-3 py-6 text-center w-full"
      >
        <div className="w-10 h-10 rounded-full bg-bg-deep flex items-center justify-center">
          <Upload size={18} className="text-text-muted" />
        </div>
        <p className="text-sm text-text-secondary">
          Upload your first CSV to see your cash flow
        </p>
        <span className="text-sm font-medium text-[#22C55E]">Upload &rarr;</span>
      </button>
    )
  }

  const { total_income, total_spending } = summary

  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-baseline gap-1.5">
        <span className="font-data text-[16px] font-extrabold tracking-[-0.03em] text-[#22C55E]">
          {formatCurrency(total_income, currency)}
        </span>
        <span className="text-[11px] text-[rgba(245,245,240,0.3)]">income</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-data text-[16px] font-extrabold tracking-[-0.03em] text-text-primary">
          {formatCurrency(total_spending, currency)}
        </span>
        <span className="text-[11px] text-[rgba(245,245,240,0.3)]">spent</span>
      </div>
    </div>
  )
}

export default CashFlowSection
