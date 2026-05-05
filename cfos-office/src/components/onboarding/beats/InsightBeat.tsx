'use client'

import ReactMarkdown from 'react-markdown'
import { StatCardBlock } from '@/components/chat/StatCardBlock'
import { CfoThinking } from '@/components/brand/CfoThinking'
import { ExperimentCard } from './ExperimentCard'
import type { Experiment } from '@/lib/analytics/insight-types'
import type { FirstInsightResult } from '@/lib/onboarding/types'

const INSIGHT_THINKING_LABELS = [
  'Reading your statements\u2026',
  'Spotting patterns\u2026',
  'Pulling this together\u2026',
] as const

interface InsightBeatProps {
  insight?: FirstInsightResult
  loading?: boolean
  onRate?: (rating: number) => void
  onAcceptExperiment?: (experiment: Experiment) => void
  // Fallback/continue CTA — always wired so the flow can advance even when
  // no experiment is surfaced. When an experiment exists, renders as a
  // secondary link under the experiment card; when none, renders as the
  // primary action.
  onContinue?: () => void
}


// ── Skeleton (shown while engine + Claude are still computing) ───────────────

function InsightSkeleton() {
  return (
    <div className="animate-fade-in space-y-2">
      <CfoThinking
        labels={INSIGHT_THINKING_LABELS}
        className="px-0 py-0"
      />
      <div className="px-4 py-2 ml-[40px] space-y-3">
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
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export function InsightBeat({
  insight,
  loading,
  onAcceptExperiment,
  onContinue,
}: InsightBeatProps) {
  if (loading || !insight) return <InsightSkeleton />

  const { narrative, statCards, experiment } = insight
  const hasExperiment = Boolean(experiment && onAcceptExperiment)

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

      {experiment && onAcceptExperiment && (
        <ExperimentCard experiment={experiment} onAccept={onAcceptExperiment} />
      )}

      {onContinue && (
        hasExperiment ? (
          <button
            onClick={onContinue}
            className="w-full min-h-[44px] text-sm text-[var(--text-tertiary)]
                       hover:text-[var(--text-secondary)] transition-colors
                       font-[var(--font-dm-sans)] pt-1"
          >
            Not right now — show me around
          </button>
        ) : (
          <button
            onClick={onContinue}
            className="w-full min-h-[44px] rounded-xl bg-[var(--accent-gold)]
                       text-[var(--bg-base)] text-sm font-semibold
                       transition-all duration-200
                       hover:brightness-110 active:scale-[0.98]"
          >
            Let&apos;s keep going
          </button>
        )
      )}
    </div>
  )
}
