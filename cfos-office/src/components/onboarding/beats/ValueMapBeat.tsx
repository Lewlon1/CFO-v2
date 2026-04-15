'use client'

import { useCallback } from 'react'
import { ValueMapFlow } from '@/components/value-map/value-map-flow'
import type { ValueMapResult } from '@/lib/value-map/types'

interface ValueMapBeatProps {
  currency: string
  onComplete: (
    personalityType: string,
    dominantQuadrant: string,
    breakdown: Record<string, { total: number; percentage: number; count: number }>,
    results?: ValueMapResult[]
  ) => void
  onSkip: () => void
  onTransactionResult?: (result: ValueMapResult, index: number, total: number) => void
}

export function ValueMapBeat({ currency, onComplete, onSkip, onTransactionResult }: ValueMapBeatProps) {
  const handleComplete = useCallback((
    personalityType: string,
    dominantQuadrant: string,
    breakdown: Record<string, { total: number; percentage: number; count: number }>,
    results?: ValueMapResult[]
  ) => {
    onComplete(personalityType, dominantQuadrant, breakdown, results)
  }, [onComplete])

  return (
    <div className="px-4 py-2 animate-[fade-in_0.3s_ease-out] flex flex-col gap-2">
      <div className="relative rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden flex-1">
        <ValueMapFlow
          currency={currency}
          mode="onboarding"
          onComplete={handleComplete}
          onTransactionResult={onTransactionResult}
        />
      </div>
      <div className="flex justify-end px-2">
        <button
          onClick={onSkip}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors min-h-[44px] px-2"
        >
          Skip for now
        </button>
      </div>
    </div>
  )
}
