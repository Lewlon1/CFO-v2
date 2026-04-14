'use client'

import Link from 'next/link'

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

function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function ScenariosSection({ nextTrip, currency = 'EUR' }: ScenariosSectionProps) {
  if (!nextTrip) {
    return (
      <Link
        href="/office/scenarios/what-if"
        className="block text-left w-full text-[11px] text-text-secondary py-2 hover:text-text-primary transition-colors"
      >
        No active scenarios yet. Plan a trip or model a change &rarr;
      </Link>
    )
  }

  return (
    <div className="pt-1">
      <div className="flex items-baseline gap-1.5">
        <span className="font-data text-[16px] font-extrabold tracking-[-0.03em] text-[#F43F5E]">
          {formatCurrency(nextTrip.total_estimated ?? 0, nextTrip.currency || currency)}
        </span>
        <span className="text-[11px] text-[rgba(245,245,240,0.3)]">{nextTrip.name} target</span>
      </div>
    </div>
  )
}

export default ScenariosSection
