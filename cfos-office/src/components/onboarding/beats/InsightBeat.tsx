'use client'

import ReactMarkdown from 'react-markdown'
import { CfoThinking } from '@/components/brand/CfoThinking'
import type { FirstInsightResult } from '@/lib/onboarding/types'

const INSIGHT_THINKING_LABELS = [
  'Reading your statements…',
  'Spotting patterns…',
  'Pulling this together…',
] as const

interface InsightBeatProps {
  insight?: FirstInsightResult
  loading?: boolean
  onRate?: (rating: number) => void
  onAcceptExperiment?: (candidateToken: string) => void
  // Always wired so the flow can advance even when no experiment is
  // surfaced — fallback narrative or detector miss.
  onContinue?: () => void
}

function InsightSkeleton() {
  return (
    <div className="animate-fade-in space-y-2">
      <CfoThinking labels={INSIGHT_THINKING_LABELS} className="px-0 py-0" />
      <div className="px-4 py-2 ml-[40px] space-y-3">
        <div className="space-y-2">
          <div className="h-3 w-[90%] rounded bg-[var(--bg-inset)] animate-pulse" />
          <div className="h-3 w-[75%] rounded bg-[var(--bg-inset)] animate-pulse" />
          <div className="h-3 w-[82%] rounded bg-[var(--bg-inset)] animate-pulse" />
        </div>
        <div className="h-12 rounded-xl bg-[var(--bg-inset)] animate-pulse" />
      </div>
    </div>
  )
}

export function InsightBeat({
  insight,
  loading,
  onAcceptExperiment,
  onContinue,
}: InsightBeatProps) {
  if (loading || !insight) return <InsightSkeleton />

  const hasFourBeats = Boolean(insight.observed && insight.named && insight.asked && insight.proposed)
  const canAccept = Boolean(hasFourBeats && insight.candidate_token && onAcceptExperiment)

  // Fallback path — no candidate or generator failed. Render narrative only
  // with a single continue CTA.
  if (!hasFourBeats) {
    return (
      <div className="px-4 py-2 ml-[40px] animate-[fade-in_0.4s_ease-out] space-y-3 max-w-[min(calc(100%-40px),420px)]">
        {insight.narrative && (
          <div className="text-sm text-[var(--text-primary)] leading-relaxed font-[var(--font-dm-sans)]">
            <ReactMarkdown>{insight.narrative}</ReactMarkdown>
          </div>
        )}
        {onContinue && (
          <button
            onClick={onContinue}
            className="w-full min-h-[44px] rounded-xl bg-[var(--accent-gold)]
                       text-[var(--bg-base)] text-sm font-semibold
                       transition-all duration-200
                       hover:brightness-110 active:scale-[0.98]"
          >
            Let&apos;s keep going
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="px-4 py-2 ml-[40px] animate-[fade-in_0.4s_ease-out] space-y-4 max-w-[min(calc(100%-40px),420px)]">
      {/* 01 OBSERVED — Claude's prose */}
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          Observed
        </div>
        <div className="text-sm text-[var(--text-primary)] leading-relaxed font-[var(--font-dm-sans)]">
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
            {insight.observed!}
          </ReactMarkdown>
        </div>
      </div>

      {/* 02 NAMED — locked italic tagline */}
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          Named
        </div>
        <div className="text-base italic text-[var(--text-primary)] font-[var(--font-dm-sans)]">
          {insight.named}
        </div>
      </div>

      {/* 03 ASKED — locked open question, quote-styled */}
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          Asked
        </div>
        <div className="border-l-2 border-[var(--accent-gold)] pl-3 text-sm text-[var(--text-primary)] leading-relaxed font-[var(--font-dm-sans)]">
          {insight.asked}
        </div>
      </div>

      {/* 04 PROPOSED — locked noticing experiment + CTA */}
      <div className="pt-3 border-t border-[var(--border-subtle)] space-y-3">
        <div className="space-y-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            Proposed
          </div>
          <div className="text-sm text-[var(--text-primary)] leading-relaxed font-[var(--font-dm-sans)]">
            {insight.proposed}
          </div>
        </div>

        {canAccept && (
          <button
            onClick={() => onAcceptExperiment!(insight.candidate_token!)}
            className="w-full min-h-[44px] rounded-xl bg-[var(--accent-gold)]
                       text-[var(--bg-base)] text-sm font-semibold
                       transition-all duration-200
                       hover:brightness-110 active:scale-[0.98]"
          >
            Try this for a week
          </button>
        )}

        {onContinue && (
          <button
            onClick={onContinue}
            className="w-full min-h-[44px] text-sm text-[var(--text-tertiary)]
                       hover:text-[var(--text-secondary)] transition-colors
                       font-[var(--font-dm-sans)]"
          >
            Not right now — show me around
          </button>
        )}
      </div>
    </div>
  )
}
