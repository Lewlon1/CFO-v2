'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BarChart3, Target } from 'lucide-react'
import { useDashboardData } from '@/lib/hooks/useDashboardData'
import { useTrends } from '@/lib/hooks/useTrends'
import { MonthSelector } from './MonthSelector'
import { ViewToggle } from './ViewToggle'
import { SummaryCards } from './SummaryCards'
import { DashboardEmptyState } from '@/components/office/dashboards/DashboardEmptyState'
import { CategoryBreakdown } from './CategoryBreakdown'
import { ValueSummary } from './ValueSummary'
import { ValueCategoryCards } from './ValueCategoryCards'
import { UnsureQueue } from './UnsureQueue'
import { RecurringPanel } from './RecurringPanel'
import { ReviewBanner } from './ReviewBanner'
import { useTrackEvent } from '@/lib/events/use-track-event'

// Lazy-load Recharts-based chart components (recharts is ~200KB)
const ChartSkeleton = () => <div className="h-64 bg-muted rounded-lg animate-pulse" />

const SpendingChart = dynamic(
  () => import('./SpendingChart').then(m => ({ default: m.SpendingChart })),
  { loading: ChartSkeleton, ssr: false }
)
const TrendChart = dynamic(
  () => import('./TrendChart').then(m => ({ default: m.TrendChart })),
  { loading: ChartSkeleton, ssr: false }
)
const ValuesDonut = dynamic(
  () => import('./ValuesDonut').then(m => ({ default: m.ValuesDonut })),
  { loading: ChartSkeleton, ssr: false }
)
const ValuesTrendChart = dynamic(
  () => import('./ValuesTrendChart').then(m => ({ default: m.ValuesTrendChart })),
  { loading: ChartSkeleton, ssr: false }
)

type Props = {
  hasData: boolean
}

export function DashboardClient({ hasData }: Props) {
  const router = useRouter()
  const trackEvent = useTrackEvent()
  const viewedRef = useRef(false)
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>(undefined)
  const [activeView, setActiveView] = useState<'spending' | 'values'>('spending')

  // Track dashboard viewed on mount
  useEffect(() => {
    if (viewedRef.current) return
    viewedRef.current = true
    trackEvent('dashboard_viewed')
  }, [trackEvent])

  // Load view preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('dashboard_view')
    if (saved === 'spending' || saved === 'values') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only localStorage hydration; reading in render would break SSR/hydration
      setActiveView(saved)
    }
  }, [])

  function handleViewChange(view: 'spending' | 'values') {
    const from = activeView
    setActiveView(view)
    localStorage.setItem('dashboard_view', view)
    trackEvent('dashboard_view_toggled', { from, to: view })
  }

  const { summary, isLoading } = useDashboardData(selectedMonth)
  const { trends } = useTrends()

  if (!hasData) {
    return (
      <DashboardEmptyState
        icon={<BarChart3 className="h-5 w-5 text-text-tertiary" />}
        title="Your dashboard is waiting for data"
        body="Upload a bank statement to see your spending breakdown, track your values, and get insights."
      >
        <div className="flex flex-col items-center gap-3">
          <Link
            href="/transactions"
            className="rounded-control bg-primary text-primary-foreground px-5 py-2.5 text-body font-medium min-h-[44px] inline-flex items-center"
          >
            Upload a statement
          </Link>
          <p className="text-caption text-text-tertiary">
            Supports: CSV, XLSX, PDF, or screenshots from any bank app
          </p>
        </div>
      </DashboardEmptyState>
    )
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
            <DashboardEmptyState
              icon={<Target className="h-5 w-5 text-text-tertiary" />}
              title="Your Values View needs your input"
              body="The Values View shows how your spending aligns with what matters to you. To get started, take the Value Map or classify some transactions manually."
            >
              <div className="flex gap-3">
                <Link
                  href="/demo"
                  className="rounded-control bg-primary text-primary-foreground px-5 py-2.5 text-body font-medium min-h-[44px] inline-flex items-center"
                >
                  Take the Value Map
                </Link>
                <Link
                  href="/transactions?value_category=unsure"
                  className="rounded-control border border-border px-5 py-2.5 text-body font-medium min-h-[44px] inline-flex items-center text-foreground hover:bg-accent transition-colors"
                >
                  Classify now
                </Link>
              </div>
            </DashboardEmptyState>
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
