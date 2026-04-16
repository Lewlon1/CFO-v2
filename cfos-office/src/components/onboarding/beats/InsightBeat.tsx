'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { StatCardBlock } from '@/components/chat/StatCardBlock'
import type { FirstInsightResult } from '@/lib/onboarding/types'

interface InsightBeatProps {
  insight?: FirstInsightResult
  loading?: boolean
  onRate?: (rating: number) => void
}

const EMOJI_SCALE = [
  { emoji: '\uD83D\uDE12', label: 'Not close' },
  { emoji: '\uD83D\uDE10', label: 'Meh' },
  { emoji: '\uD83E\uDD14', label: 'Somewhat' },
  { emoji: '\uD83D\uDE2E', label: 'Impressive' },
  { emoji: '\uD83C\uDFAF', label: 'Spot on' },
]

// ── Skeleton (shown while engine + Claude are still computing) ───────────────

function InsightSkeleton() {
  return (
    <div className="px-4 py-2 ml-[40px] animate-[fade-in_0.3s_ease-out] space-y-3">
      <div className="space-y-2">
        <div className="h-3 w-[90%] rounded bg-[var(--bg-inset)] animate-pulse" />
        <div className="h-3 w-[75%] rounded bg-[var(--bg-inset)] animate-pulse" />
        <div className="h-3 w-[82%] rounded bg-[var(--bg-inset)] animate-pulse" />
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-2"
          >
            <div className="h-2 w-[70%] rounded bg-[var(--bg-inset)] animate-pulse" />
            <div className="h-4 w-[60%] rounded bg-[var(--bg-inset)] animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Emoji reaction scale ────────────────────────────────────────────────────

function EmojiScale({ onRate }: { onRate?: (rating: number) => void }) {
  const [selected, setSelected] = useState<number | null>(null)

  const handleTap = (index: number) => {
    if (selected !== null) return
    setSelected(index)
    onRate?.(index + 1)
  }

  return (
    <div className="pt-2 space-y-1.5">
      <p className="text-[11px] text-[var(--text-tertiary)] font-[var(--font-dm-sans)]">
        Does it resonate?
      </p>
      <div className="flex gap-3">
        {EMOJI_SCALE.map((item, i) => (
          <button
            key={i}
            onClick={() => handleTap(i)}
            aria-label={item.label}
            className={`text-2xl min-h-[44px] min-w-[44px] flex items-center justify-center
              rounded-xl transition-all duration-300
              ${selected === null
                ? 'hover:scale-125 hover:bg-[var(--bg-elevated)] active:scale-95'
                : selected === i
                  ? 'scale-125'
                  : 'opacity-0 scale-75'
              }`}
          >
            {item.emoji}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export function InsightBeat({ insight, loading, onRate }: InsightBeatProps) {
  if (loading || !insight) return <InsightSkeleton />

  const { narrative, statCards } = insight

  return (
    <div className="px-4 py-2 ml-[40px] animate-[fade-in_0.4s_ease-out] space-y-3 max-w-[min(calc(100%-40px),420px)]">
      {narrative && (
        <div className="text-sm text-[var(--text-primary)] leading-relaxed font-[var(--font-dm-sans)] prose prose-invert prose-sm max-w-none">
          <ReactMarkdown
            components={{
              p: ({ children }) => (
                <p className="mb-2 last:mb-0 text-sm text-[var(--text-primary)] leading-relaxed">
                  {children}
                </p>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>
              ),
              em: ({ children }) => (
                <em className="italic text-[var(--text-secondary)]">{children}</em>
              ),
            }}
          >
            {narrative}
          </ReactMarkdown>
        </div>
      )}

      {statCards.length > 0 && (
        <StatCardBlock cards={statCards.map((c) => ({ label: c.label, value: c.value }))} />
      )}

      <EmojiScale onRate={onRate} />
    </div>
  )
}
