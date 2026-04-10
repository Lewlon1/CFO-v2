'use client'

import Link from 'next/link'
import { Sparkles, Plane } from 'lucide-react'

interface Trip {
  name: string
  start_date: string
  end_date: string
  total_estimated: number | null
  currency: string
}

interface ScenariosSectionProps {
  nextTrip: Trip | null
  currency?: string
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
}

function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function ScenariosSection({ nextTrip, currency = 'EUR' }: ScenariosSectionProps) {
  return (
    <div className="space-y-2">
      {/* What If card */}
      <Link
        href="/office/scenarios"
        className="flex items-center gap-3 rounded-lg bg-office-bg-tertiary px-3 py-3 hover:bg-office-bg-tertiary/80 transition-colors"
      >
        <div className="w-8 h-8 rounded-lg bg-office-purple/15 flex items-center justify-center shrink-0">
          <Sparkles size={16} className="text-office-purple" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-office-text">What If</p>
          <p className="text-xs text-office-text-secondary">Model salary, property, career changes</p>
        </div>
      </Link>

      {/* Next trip or CTA */}
      {nextTrip ? (
        <div className="flex items-center gap-3 rounded-lg bg-office-bg-tertiary px-3 py-3">
          <div className="w-8 h-8 rounded-lg bg-office-cyan/15 flex items-center justify-center shrink-0">
            <Plane size={16} className="text-office-cyan" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-office-text truncate">{nextTrip.name}</p>
            <p className="text-xs text-office-text-secondary">
              {formatDate(nextTrip.start_date)} – {formatDate(nextTrip.end_date)}
              {nextTrip.total_estimated != null && (
                <> &middot; {formatCurrency(nextTrip.total_estimated, nextTrip.currency || currency)} budget</>
              )}
            </p>
          </div>
        </div>
      ) : (
        <Link
          href="/chat?prefill=I%27d+like+to+plan+a+trip"
          className="flex items-center gap-3 rounded-lg bg-office-bg-tertiary px-3 py-3 hover:bg-office-bg-tertiary/80 transition-colors"
        >
          <div className="w-8 h-8 rounded-lg bg-office-cyan/15 flex items-center justify-center shrink-0">
            <Plane size={16} className="text-office-cyan" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-office-text-secondary">No trips planned</p>
            <span className="text-sm font-medium text-office-cyan">Plan a trip &rarr;</span>
          </div>
        </Link>
      )}
    </div>
  )
}

export default ScenariosSection
