'use client'

import { useEffect, useState } from 'react'
import { CFOAvatar } from './CFOAvatar'
import { cn } from '@/lib/utils'

// Shared "your CFO is working on this" indicator used wherever a response
// is being generated or fetched. Signals active work, not just "loading".
//
// Use `label` for a single status line, or `labels` to rotate through several
// so longer waits still feel alive. Always prefer concrete verbs over the
// generic default (e.g. "Reading your statements" beats "Thinking").

interface CfoThinkingProps {
  label?: string
  labels?: readonly string[]
  variant?: 'inline' | 'block'
  size?: number
  showAvatar?: boolean
  className?: string
}

const DEFAULT_LABEL = 'Your CFO is working on this\u2026'
const ROTATION_MS = 2400

export function CfoThinking({
  label,
  labels,
  variant = 'inline',
  size,
  showAvatar = true,
  className,
}: CfoThinkingProps) {
  const list: readonly string[] =
    labels && labels.length > 0 ? labels : [label ?? DEFAULT_LABEL]
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (list.length < 2) return
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % list.length)
    }, ROTATION_MS)
    return () => clearInterval(id)
  }, [list.length])

  const currentLabel = list[index]
  const resolvedSize = size ?? (variant === 'block' ? 48 : 28)

  if (variant === 'block') {
    return (
      <div
        className={cn('flex flex-col items-center justify-center gap-3 py-6', className)}
        role="status"
        aria-live="polite"
      >
        {showAvatar && (
          <span className="animate-pulse">
            <CFOAvatar size={resolvedSize} />
          </span>
        )}
        <div className="flex items-center gap-2">
          <span
            key={currentLabel}
            className="text-sm text-[var(--text-secondary)] font-[var(--font-dm-sans)] animate-fade-in"
          >
            {currentLabel}
          </span>
          <ThinkingDots />
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn('flex items-start gap-3 px-4 py-2 animate-fade-in', className)}
      role="status"
      aria-live="polite"
    >
      {showAvatar && (
        <span className="animate-pulse mt-0.5">
          <CFOAvatar size={resolvedSize} />
        </span>
      )}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
        <span
          key={currentLabel}
          className="text-xs text-[var(--text-secondary)] font-[var(--font-dm-sans)] animate-fade-in"
        >
          {currentLabel}
        </span>
        <ThinkingDots />
      </div>
    </div>
  )
}

function ThinkingDots() {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      <span className="w-1 h-1 rounded-full bg-[var(--accent-gold)] animate-[typing-dot_1.4s_ease-in-out_infinite]" />
      <span className="w-1 h-1 rounded-full bg-[var(--accent-gold)] animate-[typing-dot_1.4s_ease-in-out_0.2s_infinite]" />
      <span className="w-1 h-1 rounded-full bg-[var(--accent-gold)] animate-[typing-dot_1.4s_ease-in-out_0.4s_infinite]" />
    </span>
  )
}
