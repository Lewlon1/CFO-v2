'use client'

import Link from 'next/link'
import type { DashboardSummary } from '@/app/api/dashboard/summary/route'

const VALUE_COLORS: Record<string, string> = {
  foundation: '#22C55E',
  investment: '#3B82F6',
  leak: '#F43F5E',
  burden: '#8B5CF6',
}

interface ValuesSectionProps {
  summary: DashboardSummary | undefined
  isLoading: boolean
  gaps: { trait_key: string; trait_value: string }[]
  archetype: { archetype_name: string | null; archetype_subtitle: string | null } | null
  profileCompleteness?: number
}

export function ValuesSection({ summary, isLoading, archetype, profileCompleteness = 0 }: ValuesSectionProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-6 rounded bg-bg-deep animate-pulse" />
      </div>
    )
  }

  // Build value bar segments
  const valueOrder = ['foundation', 'investment', 'leak', 'burden'] as const
  const hasValueData = summary && Object.keys(summary.spending_by_value_category).length > 0
  const segments = hasValueData
    ? valueOrder
        .map(vc => {
          const data = summary?.spending_by_value_category[vc]
          return { key: vc, pct: data?.pct ?? 0 }
        })
        .filter(s => s.pct > 0)
    : []

  return (
    <div className="pt-1">
      {/* Value split bar */}
      {segments.length > 0 ? (
        <div
          className="flex h-[6px] rounded-[3px] overflow-hidden gap-[3px]"
          style={{ marginTop: 6 }}
        >
          {segments.map(seg => (
            <div
              key={seg.key}
              className="h-full rounded-[3px]"
              style={{
                flex: seg.pct,
                backgroundColor: VALUE_COLORS[seg.key],
              }}
            />
          ))}
        </div>
      ) : !archetype?.archetype_name ? (
        <Link
          href="/office/values/archetype"
          className="block text-[11px] text-text-secondary hover:text-text-primary transition-colors"
        >
          Discover your financial personality &rarr;
        </Link>
      ) : null}
    </div>
  )
}

export default ValuesSection
