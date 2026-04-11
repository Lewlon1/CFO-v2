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
    <div className="space-y-1.5">
      {/* What If card */}
      <Link
        href="/office/scenarios"
        className="flex items-center gap-3 rounded-[8px] bg-bg-deep px-3 py-3 hover:bg-tap-highlight transition-colors"
      >
        <div className="w-8 h-8 rounded-[6px] bg-accent-purple/15 flex items-center justify-center shrink-0">
          <Sparkles size={16} className="text-accent-purple" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-text-primary">What If</p>
          <p className="font-data text-[9px] text-text-tertiary">Model salary, property, career changes</p>
        </div>
      </Link>

      {/* Next trip or CTA */}
      {nextTrip ? (
        <div className="flex items-center gap-3 rounded-[8px] bg-bg-deep px-3 py-3">
          <div className="w-8 h-8 rounded-[6px] bg-accent-cyan/15 flex items-center justify-center shrink-0">
            <Plane size={16} className="text-accent-cyan" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-text-primary truncate">{nextTrip.name}</p>
            <p className="font-data text-[9px] text-text-tertiary">
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
          className="flex items-center gap-3 rounded-[8px] bg-bg-deep px-3 py-3 hover:bg-tap-highlight transition-colors"
        >
          <div className="w-8 h-8 rounded-[6px] bg-accent-cyan/15 flex items-center justify-center shrink-0">
            <Plane size={16} className="text-accent-cyan" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-text-tertiary">No trips planned</p>
            <span className="text-[11px] font-semibold text-accent-cyan">Plan a trip &rarr;</span>
          </div>
        </Link>
      )}
    </div>
  )
}

export default ScenariosSection
