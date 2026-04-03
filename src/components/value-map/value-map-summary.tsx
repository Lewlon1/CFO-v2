'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CfoAvatar } from '@/components/chat/cfo-avatar'
import { QUADRANTS, QUADRANT_ORDER, PERSONALITIES } from '@/lib/value-map/constants'
import { calculatePersonality } from '@/lib/value-map/personalities'
import { generateObservations } from '@/lib/value-map/observations'
import type { ValueMapResult, ValueMapTransaction, ValueQuadrant, Observation } from '@/lib/value-map/types'
import { cn } from '@/lib/utils'

type PreviousIntelligence = {
  personality_type: string
  dominant_quadrant: string
  breakdown: Record<string, { percentage: number; count: number; total: number }>
  completedAt: string | null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function currencySymbol(currency: string): string {
  return { GBP: '\u00A3', USD: '$', EUR: '\u20AC' }[currency] ?? currency + ' '
}

function formatAmount(amount: number, currency: string): string {
  const sym = currencySymbol(currency)
  return `${sym}${amount.toLocaleString('en', { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ValueMapSummaryProps {
  results: ValueMapResult[]
  transactions: ValueMapTransaction[]
  currency: string
  isRealData: boolean
  onContinue: () => void
  mode?: 'onboarding' | 'retake'
  previousIntelligence?: PreviousIntelligence | null
}

// ── Component ────────────────────────────────────────────────────────────────

export function ValueMapSummary({ results, transactions, currency, isRealData, onContinue, mode = 'onboarding', previousIntelligence = null }: ValueMapSummaryProps) {
  const personalityResult = useMemo(() => calculatePersonality(results), [results])
  const { breakdown } = personalityResult

  // Filter out hard-to-decide (null quadrant) for display totals
  const decidedResults = useMemo(() => results.filter((r) => r.quadrant !== null), [results])

  // ── Deterministic observations (instant) ────────────────────────────────
  const deterministicObs = useMemo<Observation[]>(
    () => generateObservations(results, transactions),
    [results, transactions],
  )

  // ── Opus upgrade (background) ───────────────────────────────────────────
  const [opusText, setOpusText] = useState<string | null>(null)
  const opusFiredRef = useRef(false)

  useEffect(() => {
    if (opusFiredRef.current) return
    opusFiredRef.current = true

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    fetch('/api/value-map/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        results: decidedResults.map((r) => ({
          merchant: r.merchant,
          amount: r.amount,
          quadrant: r.quadrant,
          confidence: r.confidence,
          first_tap_ms: r.first_tap_ms,
          deliberation_ms: r.deliberation_ms,
        })),
        currency,
        userName: 'there', // Profile name not available here; CFO uses neutral address
      }),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (data.observations) setOpusText(data.observations)
      })
      .catch(() => {
        // Deterministic observations stand — no error shown
      })
      .finally(() => clearTimeout(timeout))

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────────

  const hasObservations = deterministicObs.length > 0 || opusText

  return (
    <div className="flex flex-col gap-6 px-4 py-6 overflow-y-auto">
      {/* Hero: CFO Observations (instant) */}
      {hasObservations && (
        <div className="rounded-xl border border-[#E8A84C]/30 bg-[#E8A84C]/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CfoAvatar size="sm" />
            <span className="text-sm font-semibold text-[#E8A84C]">Your CFO</span>
          </div>

          {/* Opus text replaces deterministic bullets when available */}
          <div className="relative min-h-[60px]">
            {/* Deterministic observations */}
            <div
              className={cn(
                'space-y-2 transition-opacity duration-500',
                opusText ? 'opacity-0 absolute inset-0' : 'opacity-100',
              )}
            >
              {deterministicObs.map((obs, i) => (
                <p key={obs.rule + i} className="text-sm text-foreground leading-relaxed">
                  {obs.text}
                </p>
              ))}
            </div>

            {/* Opus narrative (crossfade in) */}
            {opusText && (
              <div className="text-sm text-foreground leading-relaxed whitespace-pre-line animate-in fade-in duration-500">
                {opusText}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Personality badge (secondary) */}
      <div className="text-center space-y-2 py-2">
        <div className="text-4xl">{personalityResult.emoji}</div>
        <h2 className="text-xl font-bold text-[#E8A84C]">
          {personalityResult.name}
        </h2>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
          {personalityResult.description}
        </p>
      </div>

      {/* Retake comparison */}
      {mode === 'retake' && previousIntelligence && (() => {
        const prevBreakdown = previousIntelligence.breakdown
        const prevPersonality = PERSONALITIES[previousIntelligence.personality_type]
        const personalityChanged = previousIntelligence.personality_type !== personalityResult.personality
        const lastDate = previousIntelligence.completedAt
          ? new Date(previousIntelligence.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
          : null

        return (
          <div className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">
              {personalityChanged
                ? `You were ${prevPersonality?.name ?? previousIntelligence.personality_type.replace(/_/g, ' ')} \u2014 now you\u2019re ${personalityResult.name}`
                : `Still ${personalityResult.name} \u2014 here\u2019s what shifted`}
            </h3>
            {lastDate && (
              <p className="text-xs text-muted-foreground">
                Compared to your last Value Map on {lastDate}
              </p>
            )}

            {/* Quadrant shift bars */}
            <div className="space-y-2">
              {QUADRANT_ORDER.map((qId) => {
                const newPct = breakdown[qId as ValueQuadrant].percentage
                const prevPct = prevBreakdown[qId]?.percentage ?? 0
                const delta = newPct - prevPct

                return (
                  <div key={qId} className="flex items-center gap-3">
                    <span className="text-xs w-20 shrink-0" style={{ color: QUADRANTS[qId].colour }}>
                      {QUADRANTS[qId].name}
                    </span>
                    <div className="flex-1 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-mono w-8 text-right">{prevPct}%</span>
                      <span className="text-xs text-muted-foreground">&rarr;</span>
                      <span className="text-xs font-mono font-semibold text-foreground w-8">{newPct}%</span>
                      {delta !== 0 && (
                        <span className={cn(
                          'text-xs font-mono font-semibold',
                          delta > 0 ? 'text-green-400' : 'text-red-400',
                        )}>
                          {delta > 0 ? '+' : ''}{delta}%
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Allocation bar */}
      <div className="space-y-2">
        <div className="flex h-8 w-full rounded-lg overflow-hidden">
          {QUADRANT_ORDER.map((qId) => {
            const pct = breakdown[qId as ValueQuadrant].percentage
            if (pct === 0) return null
            return (
              <div
                key={qId}
                className="h-full flex items-center justify-center text-xs font-semibold text-white transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  backgroundColor: QUADRANTS[qId].colour,
                  minWidth: pct > 8 ? undefined : '0',
                }}
              >
                {pct >= 12 && `${pct}%`}
              </div>
            )
          })}
        </div>
      </div>

      {/* Quadrant summary cards (2x2) */}
      <div className="grid grid-cols-2 gap-2">
        {QUADRANT_ORDER.map((qId) => {
          const q = QUADRANTS[qId]
          const data = breakdown[qId as ValueQuadrant]
          const items = decidedResults.filter((r) => r.quadrant === qId)

          return (
            <div
              key={qId}
              className="rounded-xl border-2 p-3 space-y-1.5"
              style={{
                borderColor: q.colour + '30',
                backgroundColor: q.colour + '08',
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-sm" role="img" aria-hidden>{q.emoji}</span>
                <span className="text-xs font-semibold" style={{ color: q.colour }}>
                  {q.name}
                </span>
              </div>
              <p className="font-mono text-lg font-bold text-foreground">
                {formatAmount(data.total, currency)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {data.count} transaction{data.count !== 1 ? 's' : ''} &middot; {data.percentage}%
              </p>
              {items.length > 0 && (
                <div className="space-y-0.5 pt-1 border-t border-border/50">
                  {items.map((item) => (
                    <div key={item.transaction_id} className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground truncate mr-2">{item.merchant}</span>
                      <span className="font-mono text-foreground shrink-0">
                        {formatAmount(item.amount, currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Sample data notice */}
      {!isRealData && (
        <p className="text-xs text-muted-foreground text-center">
          This was based on example data. Upload your own transactions for real insights.
        </p>
      )}

      {/* CTA */}
      <Button
        onClick={onContinue}
        className="w-full bg-[#E8A84C] hover:bg-[#d4963f] text-black font-semibold py-6 text-base"
      >
        Continue
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  )
}
