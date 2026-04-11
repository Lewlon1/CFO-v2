'use client'

import Link from 'next/link'
import { ConfidenceFlag } from '@/components/trust/ConfidenceFlag'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import type { DashboardSummary } from '@/app/api/dashboard/summary/route'

const VALUE_COLORS: Record<string, string> = {
  foundation: 'var(--positive)',
  investment: 'var(--info)',
  leak: 'var(--negative)',
  burden: 'var(--accent-purple)',
}

const VALUE_LABELS: Record<string, string> = {
  foundation: 'Foundation',
  investment: 'Investment',
  leak: 'Leak',
  burden: 'Burden',
}

interface GapItem {
  trait_key: string
  trait_value: string
}

interface ArchetypeData {
  archetype_name: string | null
  archetype_subtitle: string | null
}

interface ValuesSectionProps {
  summary: DashboardSummary | undefined
  isLoading: boolean
  gaps: GapItem[]
  archetype: ArchetypeData | null
  profileCompleteness?: number
}

export function ValuesSection({ summary, isLoading, gaps, archetype, profileCompleteness = 0 }: ValuesSectionProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-10 rounded-[8px] bg-bg-deep animate-pulse" />
        <div className="h-12 rounded-[8px] bg-bg-deep animate-pulse" />
      </div>
    )
  }

  const pct = Math.max(0, Math.min(100, Math.round(profileCompleteness)))

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
    <div className="space-y-4">
      {/* Profile completeness */}
      <Link
        href="/office/values/portrait"
        className="block rounded-[8px] bg-bg-deep px-3 py-2.5 hover:bg-tap-highlight transition-colors"
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-data text-[8px] uppercase tracking-[0.06em] text-text-tertiary">
            Profile
          </span>
          <span className="font-data text-[8px] text-text-tertiary">
            {pct}%
          </span>
        </div>
        <div className="h-[3px] rounded-full bg-border-subtle overflow-hidden">
          <div
            className="h-full rounded-full bg-accent-gold transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-[9px] text-text-muted mt-1.5 leading-snug">
          The more I know, the sharper my guidance.
        </p>
      </Link>

      {/* Archetype card */}
      {archetype?.archetype_name ? (
        <div className="flex items-center gap-2.5 rounded-[8px] bg-bg-deep px-3 py-2.5">
          <CFOAvatar size={22} />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text-primary truncate">
              {archetype.archetype_name}
            </p>
            {archetype.archetype_subtitle && (
              <p className="font-data text-[9px] text-text-tertiary truncate">
                {archetype.archetype_subtitle}
              </p>
            )}
          </div>
        </div>
      ) : (
        <Link
          href="/demo"
          className="flex items-center gap-2.5 rounded-[8px] bg-bg-deep px-3 py-3 hover:bg-tap-highlight transition-colors"
        >
          <CFOAvatar size={22} />
          <div className="min-w-0">
            <p className="text-[11px] text-text-secondary">
              Discover your financial personality
            </p>
            <span className="text-[11px] font-semibold text-accent-gold">Take the Value Map &rarr;</span>
          </div>
        </Link>
      )}

      {/* Gap analysis insights */}
      {gaps.length > 0 && (
        <Link
          href="/office/values/the-gap"
          className="block rounded-[8px] bg-bg-deep px-3 py-2.5 hover:bg-tap-highlight transition-colors space-y-1.5"
        >
          <span className="font-data text-[8px] uppercase tracking-[0.06em] text-text-tertiary">
            The Gap
          </span>
          {gaps.slice(0, 2).map((gap, i) => (
            <p key={i} className="text-[10px] text-text-secondary leading-snug line-clamp-2">
              {gap.trait_value}
            </p>
          ))}
        </Link>
      )}

      {/* Value split bar (if data exists) */}
      {segments.length > 0 && (
        <div className="space-y-2">
          <div className="flex h-[7px] rounded-[4px] overflow-hidden">
            {segments.map(seg => (
              <div
                key={seg.key}
                className="h-full"
                style={{
                  width: `${seg.pct}%`,
                  backgroundColor: VALUE_COLORS[seg.key],
                  opacity: 0.65,
                }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {segments.map(seg => (
              <div key={seg.key} className="flex items-center gap-1.5">
                <span
                  className="w-[5px] h-[5px] rounded-[1.5px]"
                  style={{ backgroundColor: VALUE_COLORS[seg.key], opacity: 0.7 }}
                />
                <span className="font-data text-[9px] text-text-secondary">
                  {VALUE_LABELS[seg.key]}
                </span>
              </div>
            ))}
          </div>
          <ConfidenceFlag />
        </div>
      )}
    </div>
  )
}

export default ValuesSection
