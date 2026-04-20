'use client'

import { PERSONALITIES } from '@/lib/value-map/constants'
import { CfoThinking } from '@/components/brand/CfoThinking'
import type { OnboardingData } from '@/lib/onboarding/types'
import type { ArchetypeResult } from '@/lib/onboarding/archetype-prompt'

const ARCHETYPE_THINKING_LABELS = [
  'Looking at how you answered\u2026',
  'Sketching your archetype\u2026',
  'Finalising your reading\u2026',
] as const

interface ArchetypeBeatProps {
  data: OnboardingData
  archetypeData?: ArchetypeResult
  loading?: boolean
}

// ── Shimmer skeleton ────────────────────────────────────────────────────────

function ShimmerLine({ width, height = 'h-4' }: { width: string; height?: string }) {
  return (
    <div
      className={`${height} ${width} rounded bg-[var(--bg-inset)] animate-pulse`}
    />
  )
}

function ArchetypeSkeleton() {
  return (
    <div className="animate-fade-in space-y-2">
      <CfoThinking labels={ARCHETYPE_THINKING_LABELS} className="px-0 py-0" />
      <div className="px-4 py-2 ml-[40px]">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 max-w-sm">
          <ShimmerLine width="w-32" height="h-3" />
          <div className="mt-4">
            <ShimmerLine width="w-40" height="h-5" />
          </div>
          <div className="mt-3">
            <ShimmerLine width="w-full" height="h-4" />
          </div>
          <div className="mt-4 space-y-2.5">
            <ShimmerLine width="w-full" height="h-3" />
            <ShimmerLine width="w-[90%]" height="h-3" />
            <ShimmerLine width="w-full" height="h-3" />
            <ShimmerLine width="w-[85%]" height="h-3" />
            <ShimmerLine width="w-full" height="h-3" />
            <ShimmerLine width="w-[70%]" height="h-3" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export function ArchetypeBeat({ data, archetypeData, loading }: ArchetypeBeatProps) {
  // Loading state: show skeleton
  if (loading) {
    return <ArchetypeSkeleton />
  }

  // LLM archetype available: show full replacement
  if (archetypeData) {
    return (
      <div className="px-4 py-2 ml-[40px] animate-[fade-in_0.4s_ease-out]">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 max-w-sm">
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] mb-3">
            Your Money Personality
          </p>

          <h3 className="text-base font-semibold text-[var(--accent-gold)] mb-1.5">
            {archetypeData.archetype_name}
          </h3>

          <p className="text-sm italic text-[var(--text-secondary)] mb-4">
            {archetypeData.archetype_subtitle}
          </p>

          <div className="space-y-2.5">
            {archetypeData.traits.map((trait, i) => (
              <p
                key={i}
                className="text-xs text-[var(--text-secondary)] leading-relaxed pl-3 border-l-2 border-[var(--border-subtle)]"
              >
                {trait}
              </p>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Fallback: deterministic display (backwards compat)
  const personality = data.personalityType
    ? PERSONALITIES[data.personalityType]
    : null

  if (!personality) return null

  const breakdown = data.breakdown

  return (
    <div className="px-4 py-2 ml-[40px] animate-[fade-in_0.4s_ease-out]">
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 max-w-sm">
        <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)] mb-3">
          Your Money Personality
        </p>

        <div className="flex items-center gap-2.5 mb-2">
          <span className="text-2xl">{personality.emoji}</span>
          <h3 className="text-base font-semibold text-[var(--accent-gold)]">
            {personality.name}
          </h3>
        </div>

        <p className="text-sm italic text-[var(--text-secondary)] mb-3">
          {personality.headline}
        </p>

        <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-4">
          {personality.description}
        </p>

        {breakdown && (
          <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-[var(--bg-inset)]">
            {(['foundation', 'investment', 'burden', 'leak'] as const).map((q) => {
              const pct = breakdown[q]?.percentage ?? 0
              if (pct === 0) return null
              const colors: Record<string, string> = {
                foundation: '#22C55E',
                investment: '#3B82F6',
                burden: '#8B5CF6',
                leak: '#F43F5E',
              }
              return (
                <div
                  key={q}
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: colors[q] }}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
