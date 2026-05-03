import Link from 'next/link'
import type { ReactNode } from 'react'

interface DashboardEmptyStateProps {
  icon?: ReactNode
  body: string
  actionLabel: string
  actionHref: string
  accent: string
}

/**
 * Lightweight empty state for office dashboards.
 *
 * Used when a folder has no underlying data yet (no transactions uploaded,
 * no assets/liabilities recorded, etc.). Distinct from the heavier
 * dashboard/EmptyState and balance-sheet/EmptyState, which carry chat-context
 * hooks and multi-CTA variants.
 *
 * Refs: docs/audits/2026-05-01-component-consolidation.md §3 Extraction B
 */
export function DashboardEmptyState({
  icon,
  body,
  actionLabel,
  actionHref,
  accent,
}: DashboardEmptyStateProps) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-10">
      {icon && (
        <div className="w-10 h-10 rounded-full bg-bg-deep flex items-center justify-center">
          {icon}
        </div>
      )}
      <p className="text-sm text-text-secondary max-w-[280px]">{body}</p>
      <Link
        href={actionHref}
        className="text-[13px] font-medium"
        style={{ color: accent }}
      >
        {actionLabel}
      </Link>
    </div>
  )
}
