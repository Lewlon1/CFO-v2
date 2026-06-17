'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CFOAvatar } from '@/components/brand/CFOAvatar'

/**
 * Shared chrome for the estimates-first beats (OB-2). Keeps every beat on the
 * same tokens + primitives (no raw hex), 44px touch targets, and the CFO-voiced
 * framing. Each beat composes these; none re-implements them.
 */

/** CFO avatar + "Your CFO", framing the beat as the CFO's own message. */
export function BeatHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <CFOAvatar size={28} withOnlineDot />
        <span className="text-xs font-medium text-text-muted">Your CFO</span>
      </div>
      {subtitle && (
        <p className="mt-2 text-sm text-text-secondary leading-snug">{subtitle}</p>
      )}
    </div>
  )
}

export function BeatHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 font-serif text-[22px] leading-[1.15] text-text-primary">
      {children}
    </h2>
  )
}

export function BeatHint({ children }: { children: React.ReactNode }) {
  return <p className="mb-5 text-sm text-text-secondary leading-snug">{children}</p>
}

/** A selectable option chip. `selected` lifts it into the primary accent. */
export function ChipButton({
  selected,
  onClick,
  children,
  testId,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  testId?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={
        'w-full text-left px-4 py-3 transition-colors min-h-11 rounded-control text-[14.5px] border ' +
        (selected
          ? 'bg-primary/10 text-text-primary border-primary'
          : 'bg-bg-elevated text-text-secondary border-[var(--border-subtle)]')
      }
    >
      {children}
    </button>
  )
}

/** Full-width primary action. */
export function BeatPrimaryButton({
  onClick,
  disabled,
  pending,
  children,
  testId,
}: {
  onClick: () => void
  disabled?: boolean
  pending?: boolean
  children: React.ReactNode
  testId?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled || pending}
      className="w-full transition-colors min-h-12 rounded-control text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {pending ? 'Just a moment…' : children}
    </button>
  )
}

export function BeatError({ message }: { message: string | null }) {
  if (!message) return null
  return <p className="mb-4 text-sm text-destructive">{message}</p>
}

/** "Delete everything" escape hatch — confirm, then the existing GDPR
 *  full-deletion endpoint. Footer of the estimate beats. */
export function DeleteEverythingFooter() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleDelete() {
    if (pending) return
    if (!window.confirm('Delete everything and start over? This cannot be undone.')) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/profile/delete-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: 'everything', confirmation: 'DELETE_EVERYTHING' }),
        })
        if (!res.ok) throw new Error(`delete-data returned ${res.status}`)
        const data = await res.json()
        router.push(typeof data?.redirect === 'string' ? data.redirect : '/')
      } catch (err) {
        console.error('[estimate-beat] delete everything failed', err)
        setError('Could not delete right now. Please try again.')
      }
    })
  }

  return (
    <div className="mt-6 pt-4 border-t border-border-medium text-center">
      <button
        type="button"
        data-testid="estimate-delete-everything"
        onClick={handleDelete}
        disabled={pending}
        className="text-[11px] text-text-muted underline underline-offset-2 hover:text-text-secondary min-h-11"
      >
        {pending ? 'Deleting…' : 'Delete everything'}
      </button>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}

/** Standard outer padding for a beat's content column. */
export function BeatShell({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-5">{children}</div>
}
