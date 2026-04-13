'use client'

import { PLACEHOLDER_INSIGHTS } from '@/lib/onboarding/constants'
import type { OnboardingData } from '@/lib/onboarding/types'

interface InsightBeatProps {
  data: OnboardingData
  narrative?: string
  loading?: boolean
}

// ── Shimmer skeleton ────────────────────────────────────────────────────────

function InsightSkeleton() {
  return (
    <div className="px-4 py-2 ml-[40px] animate-[fade-in_0.3s_ease-out]">
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 max-w-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-[#F43F5E] animate-pulse" />
          <div className="h-3 w-16 rounded bg-[var(--bg-inset)] animate-pulse" />
        </div>
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-[var(--bg-inset)] animate-pulse" />
          <div className="h-3 w-[95%] rounded bg-[var(--bg-inset)] animate-pulse" />
          <div className="h-3 w-[88%] rounded bg-[var(--bg-inset)] animate-pulse" />
          <div className="h-3 w-full rounded bg-[var(--bg-inset)] animate-pulse" />
          <div className="h-3 w-[75%] rounded bg-[var(--bg-inset)] animate-pulse" />
        </div>
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export function InsightBeat({ data, narrative, loading }: InsightBeatProps) {
  // Loading state
  if (loading) {
    return <InsightSkeleton />
  }

  // LLM-generated narrative available
  if (narrative) {
    return (
      <div className="px-4 py-2 ml-[40px] animate-[fade-in_0.4s_ease-out]">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 max-w-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-[#F43F5E]" />
            <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
              The Gap
            </p>
          </div>
          <div
            className="text-sm text-[var(--text-primary)] leading-relaxed [&>p]:mb-2 [&>p:last-child]:mb-0"
            dangerouslySetInnerHTML={{ __html: narrative }}
          />
        </div>
      </div>
    )
  }

  // Fallback: static placeholder
  const insight = data.personalityType
    ? PLACEHOLDER_INSIGHTS[data.personalityType]
    : PLACEHOLDER_INSIGHTS.truth_teller

  return (
    <div className="px-4 py-2 ml-[40px] animate-[fade-in_0.4s_ease-out]">
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 max-w-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-[#F43F5E]" />
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
            The Gap
          </p>
        </div>
        <p className="text-sm text-[var(--text-primary)] leading-relaxed">
          {insight}
        </p>
      </div>
    </div>
  )
}
