'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface DashboardEmptyStateProps {
  icon?: ReactNode
  /** Optional heading above the body copy. */
  title?: string
  body: string
  /** Accent colour for the text-link CTA (href mode only). */
  accent?: string
  actionLabel?: string
  /** Link CTA — renders a text-link. */
  actionHref?: string
  /** Button CTA — renders the Button primitive. Use for chat-context / callback actions. */
  onAction?: () => void
  /** Optional secondary (outline) Button CTA, paired with onAction. */
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
  /** Escape hatch for custom action content (e.g. an embedded upload zone). */
  children?: ReactNode
}

/**
 * The single office empty-state primitive (Visual Phase 2c — the 6→1 collapse).
 * Absorbs: balance-sheet/EmptyState (title + two Button CTAs), bills/EmptyBillsState
 * (embedded UploadZone via `children`), and the office dashboards' inline empties.
 *
 * Fenced for a post-session-32 follow-up (session-32/staging-user-hygiene edits them):
 * dashboard/EmptyState (no_data/no_values variants) + office/sections/GoalsEmptyState
 * and its dependency GoalsEmptyStateCTA. Add the no_data/no_values presets here then.
 *
 * CTA modes, first match wins: children → onAction (Button) → actionHref (text-link).
 */
export function DashboardEmptyState({
  icon,
  title,
  body,
  accent,
  actionLabel,
  actionHref,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  children,
}: DashboardEmptyStateProps) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-10">
      {icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-pill bg-bg-deep">
          {icon}
        </div>
      )}
      {title && <h2 className="text-h1 font-semibold text-text-primary">{title}</h2>}
      <p className="max-w-sm text-body text-text-secondary">{body}</p>

      {children ? (
        <div className="w-full pt-1">{children}</div>
      ) : onAction ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button onClick={onAction}>{actionLabel}</Button>
          {secondaryActionLabel && onSecondaryAction && (
            <Button variant="outline" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          )}
        </div>
      ) : actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="text-body font-medium"
          style={accent ? { color: accent } : undefined}
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  )
}
