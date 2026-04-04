'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useDashboardData } from '@/lib/hooks/useDashboardData'
import { useTrends } from '@/lib/hooks/useTrends'
import { MonthSelector } from './MonthSelector'
import { ViewToggle } from './ViewToggle'
import { SummaryCards } from './SummaryCards'
import { EmptyState } from './EmptyState'
import { SpendingChart } from './SpendingChart'
import { CategoryBreakdown } from './CategoryBreakdown'
import { TrendChart } from './TrendChart'
import { ValuesDonut } from './ValuesDonut'
import { ValueSummary } from './ValueSummary'
import { ValueCategoryCards } from './ValueCategoryCards'
import { UnsureQueue } from './UnsureQueue'
import { ValuesTrendChart } from './ValuesTrendChart'
import { RecurringPanel } from './RecurringPanel'
import { ReviewBanner } from './ReviewBanner'

type Props = {
  hasData: boolean
}

export function DashboardClient({ hasData }: Props) {
  const router = useRouter()
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>(undefined)
  const [activeView, setActiveView] = useState<'spending' | 'values'>('spending')

  // Load view preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('dashboard_view')
    if (saved === 'spending' || saved === 'values') {
      setActiveView(saved)
    }
  }, [])

  function handleViewChange(view: 'spending' | 'values') {
    setActiveView(view)
    localStorage.setItem('dashboard_view', view)
  }

  const { summary, isLoading } = useDashboardData(selectedMonth)
  const { trends } = useTrends()

  if (!hasData) {
    return <EmptyState variant="no_data" />
  }

  if (isLoading || !summary) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        {/* Loading skeleton */}
        <div className="h-10 bg-muted rounded-lg animate-pulse w-64 mx-auto" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-muted rounded-lg animate-pulse" />
      </div>
    )
  }

  function handleCategoryClick(slug: string) {
    const month = summary!.month.slice(0, 7) // YYYY-MM
    router.push(`/transactions?category=${slug}&month=${month}`)
  }

  function handleValueClick(vc: string) {
    const month = summary!.month.slice(0, 7)
    router.push(`/transactions?value_category=${vc}&month=${month}`)
  }

  const unsureCount = summary.spending_by_value_category?.unsure?.count ?? 0

  // Check if values view has meaningful data
  const hasValues = Object.entries(summary.spending_by_value_category)
    .some(([key, val]) => key !== 'unsure' && val.amount > 0)

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Month Selector */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <MonthSelector
          availableMonths={summary.available_months}
          selected={summary.month}
          onChange={(month) => setSelectedMonth(month.slice(0, 7))}
        />
        <ViewToggle active={activeView} onChange={handleViewChange} />
      </div>

      {/* Review Banner */}
      {summary.review_status && (
        <ReviewBanner reviewStatus={summary.review_status} month={summary.month} />
      )}

      {/* Summary Cards */}
      <SummaryCards
        totalIncome={summary.total_income}
        totalSpending={summary.total_spending}
        surplusDeficit={summary.surplus_deficit}
        vsPreviousMonthPct={summary.vs_previous_month_pct}
      />

      {/* Spending View */}
      {activeView === 'spending' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <SpendingChart
                categories={summary.spending_by_category}
                onCategoryClick={handleCategoryClick}
              />
            </div>
            <div>
              <RecurringPanel
                items={summary.recurring.items}
                monthlyTotal={summary.recurring.monthly_total}
              />
            </div>
          </div>

          <CategoryBreakdown
            categories={summary.spending_by_category}
            month={summary.month}
            onCategoryClick={handleCategoryClick}
          />

          {trends && (
            <TrendChart months={trends.months} />
          )}
        </div>
      )}

      {/* Values View */}
      {activeView === 'values' && (
        <div className="space-y-6">
          {!hasValues ? (
            <EmptyState variant="no_values" />
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  <ValuesDonut
                    breakdown={summary.spending_by_value_category}
                    totalSpending={summary.total_spending}
                  />
                </div>
                <div className="flex flex-col gap-4">
                  <div className="rounded-lg border border-border bg-card p-4">
                    <h3 className="text-sm font-medium text-muted-foreground mb-2">Your money is...</h3>
                    <ValueSummary breakdown={summary.spending_by_value_category} />
                  </div>
                  {unsureCount > 0 && <UnsureQueue count={unsureCount} />}
                </div>
              </div>

              <ValueCategoryCards
                breakdown={summary.spending_by_value_category}
                month={summary.month}
                onCardClick={handleValueClick}
              />

              {trends && (
                <ValuesTrendChart months={trends.months} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
