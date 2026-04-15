'use client'

import ReactMarkdown from 'react-markdown'
import { StatCardBlock } from '@/components/chat/StatCardBlock'
import type { FirstInsightResult } from '@/lib/onboarding/types'

interface InsightBeatProps {
  insight?: FirstInsightResult
  loading?: boolean
}

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

// ── Main component ──────────────────────────────────────────────────────────

export function InsightBeat({ insight, loading }: InsightBeatProps) {
  if (loading || !insight) return <InsightSkeleton />

  const { narrative, statCards, suggestedResponses } = insight

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

      {suggestedResponses.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {suggestedResponses.map((s, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
