'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useBalanceSheet } from '@/lib/hooks/useBalanceSheet'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { UploadWizard } from '@/components/upload/UploadWizard'
import { NetWorthCards } from './NetWorthCards'
import { AssetGroupCard } from './AssetGroupCard'
import { LiabilityGroupCard } from './LiabilityGroupCard'
import { DataGaps } from './DataGaps'
import { EmptyState } from './EmptyState'
import type { Category } from '@/lib/parsers/types'

const ChartSkeleton = () => <div className="h-64 bg-muted rounded-lg animate-pulse" />

const AllocationDonut = dynamic(
  () => import('./AllocationDonut').then((m) => ({ default: m.AllocationDonut })),
  { loading: ChartSkeleton, ssr: false }
)

const NetWorthTrendChart = dynamic(
  () => import('./NetWorthTrendChart').then((m) => ({ default: m.NetWorthTrendChart })),
  { loading: ChartSkeleton, ssr: false }
)

type Props = {
  categories: Category[]
}

export function BalanceSheetClient({ categories }: Props) {
  const { balanceSheet, isLoading, mutate } = useBalanceSheet()
  const trackEvent = useTrackEvent()
  const viewedRef = useRef(false)
  const uploadRef = useRef<HTMLDivElement | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  useEffect(() => {
    if (viewedRef.current) return
    viewedRef.current = true
    trackEvent('balance_sheet_viewed')
  }, [trackEvent])

  function scrollToUpload() {
    setShowUpload(true)
    requestAnimationFrame(() => {
      uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  if (isLoading || !balanceSheet) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        <div className="h-10 bg-muted rounded-lg animate-pulse w-64" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-muted rounded-lg animate-pulse" />
      </div>
    )
  }

  const currency = balanceSheet.currency

  if (!balanceSheet.has_data) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <h1 className="text-xl font-semibold text-foreground">Balance Sheet</h1>
        <EmptyState onUploadClick={scrollToUpload} />
        {showUpload && (
          <div ref={uploadRef} className="rounded-xl border border-border bg-card p-4 md:p-6">
            <h2 className="text-sm font-medium text-foreground mb-3">Upload a statement</h2>
            <UploadWizard
              categories={categories}
              context="balance_sheet"
              onImported={() => {
                mutate()
                trackEvent('balance_sheet_upload_completed')
              }}
              onDone={() => setShowUpload(false)}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Balance Sheet</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            What you own and what you owe
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <NetWorthCards
        netWorth={balanceSheet.net_worth}
        totalAssets={balanceSheet.total_assets}
        totalLiabilities={balanceSheet.total_liabilities}
        accessibleAssets={balanceSheet.accessible_assets}
        netWorthChange={balanceSheet.net_worth_change}
        netWorthChangePct={balanceSheet.net_worth_change_pct}
        currency={currency}
      />

      {/* Allocation + Data gaps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AllocationDonut
          allocation={balanceSheet.allocation}
          totalAssets={balanceSheet.total_assets}
          currency={currency}
        />
        <DataGaps gaps={balanceSheet.data_gaps} />
      </div>

      {/* Assets */}
      {balanceSheet.asset_groups.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Assets</h2>
          <div className="space-y-3">
            {balanceSheet.asset_groups.map((group) => (
              <AssetGroupCard key={group.type} group={group} currency={currency} />
            ))}
          </div>
        </section>
      )}

      {/* Liabilities */}
      {balanceSheet.liability_groups.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Liabilities
          </h2>
          <div className="space-y-3">
            {balanceSheet.liability_groups.map((group) => (
              <LiabilityGroupCard key={group.type} group={group} currency={currency} />
            ))}
          </div>
        </section>
      )}

      {/* Trend */}
      <NetWorthTrendChart trend={balanceSheet.trend} currency={currency} />

      {/* Upload zone */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Add more data
          </h2>
          {!showUpload && (
            <button
              type="button"
              onClick={() => {
                setShowUpload(true)
                trackEvent('balance_sheet_upload_started')
              }}
              className="text-xs text-primary hover:underline min-h-[44px] px-2"
            >
              + Upload statement
            </button>
          )}
        </div>
        {showUpload && (
          <div ref={uploadRef} className="rounded-xl border border-border bg-card p-4 md:p-6">
            <UploadWizard
              categories={categories}
              context="balance_sheet"
              onImported={() => {
                mutate()
                trackEvent('balance_sheet_upload_completed')
              }}
              onDone={() => setShowUpload(false)}
            />
          </div>
        )}
      </section>
    </div>
  )
}
