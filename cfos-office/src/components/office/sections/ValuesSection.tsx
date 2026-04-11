'use client'

import Link from 'next/link'
import { SysTag } from '@/components/trust/SysTag'
import { ConfidenceFlag } from '@/components/trust/ConfidenceFlag'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import type { DashboardSummary } from '@/app/api/dashboard/summary/route'

const VALUE_COLORS: Record<string, string> = {
  foundation: 'var(--office-green)',
  investment: 'var(--office-cyan)',
  leak: 'var(--office-gold)',
  burden: 'var(--office-red)',
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
}

function humanizeTraitKey(key: string): string {
  // Handle keys like "gap_merchant:Amazon" → "Amazon"
  const raw = key.includes(':') ? key.split(':').pop()!.trim() : key.replace(/_/g, ' ')
  return raw.replace(/\b\w/g, c => c.toUpperCase())
}

export function ValuesSection({ summary, isLoading, gaps, archetype }: ValuesSectionProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-6 rounded-full bg-office-bg-tertiary animate-pulse" />
        <div className="h-12 rounded-lg bg-office-bg-tertiary animate-pulse" />
      </div>
    )
  }

  const hasValueData = summary && Object.keys(summary.spending_by_value_category).length > 0
  const hasAnyData = hasValueData || archetype?.archetype_name

  if (!hasAnyData) {
    return (
      <Link
        href="/demo"
        className="flex flex-col items-center gap-3 py-6 text-center"
      >
        <p className="text-sm text-office-text-secondary">
          Start with the Value Map to discover your financial personality
        </p>
        <span className="text-sm font-medium text-office-cyan">Take the Value Map &rarr;</span>
      </Link>
    )
  }

  // Build value bar segments
  const valueOrder = ['foundation', 'investment', 'leak', 'burden'] as const
  const segments = valueOrder
    .map(vc => {
      const data = summary?.spending_by_value_category[vc]
      return { key: vc, pct: data?.pct ?? 0 }
    })
    .filter(s => s.pct > 0)

  return (
    <div className="space-y-4">
      {/* Value bar */}
      {segments.length > 0 && (
        <div className="space-y-2">
          <div className="flex h-5 rounded-full overflow-hidden bg-office-bg-tertiary">
            {segments.map(seg => (
              <div
                key={seg.key}
                className="h-full flex items-center justify-center"
                style={{
                  width: `${seg.pct}%`,
                  backgroundColor: VALUE_COLORS[seg.key],
                  minWidth: seg.pct > 0 ? '24px' : '0',
                }}
              >
                {seg.pct >= 10 && (
                  <span className="font-data text-[10px] text-white/90">
                    {Math.round(seg.pct)}%
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {segments.map(seg => (
              <div key={seg.key} className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: VALUE_COLORS[seg.key] }}
                />
                <span className="text-[11px] text-office-text-secondary">
                  {VALUE_LABELS[seg.key]}
                </span>
                <SysTag />
              </div>
            ))}
          </div>
          <ConfidenceFlag />
        </div>
      )}

      {/* Top 2 gaps */}
      {gaps.length > 0 && (
        <div className="space-y-2">
          {gaps.map(gap => (
            <div key={gap.trait_key} className="rounded-lg bg-office-bg-tertiary px-3 py-2.5">
              <p className="text-xs font-medium text-office-text mb-0.5">
                {humanizeTraitKey(gap.trait_key)}
              </p>
              <p className="text-xs text-office-text-secondary line-clamp-2">
                {gap.trait_value}
              </p>
            </div>
          ))}
        </div>
      )}

      {gaps.length === 0 && hasValueData && (
        <p className="text-xs text-office-text-muted">
          Complete a Value Map and upload data to discover your gaps
        </p>
      )}

      {/* Archetype card */}
      {archetype?.archetype_name && (
        <div className="flex items-center gap-2.5 rounded-lg bg-office-bg-tertiary px-3 py-2.5">
          <CFOAvatar size={22} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-office-text truncate">
              {archetype.archetype_name}
            </p>
            {archetype.archetype_subtitle && (
              <p className="text-xs text-office-text-secondary truncate">
                {archetype.archetype_subtitle}
              </p>
            )}
          </div>
        </div>
      )}

      {!archetype?.archetype_name && (
        <Link href="/demo" className="text-sm text-office-cyan hover:underline">
          Take the Value Map &rarr;
        </Link>
      )}
    </div>
  )
}

export default ValuesSection
