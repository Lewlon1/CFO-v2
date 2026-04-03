'use client'

import { useState, useCallback, useEffect } from 'react'
import { Scissors, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CfoAvatar } from '@/components/chat/cfo-avatar'
import { QUADRANTS } from '@/lib/value-map/constants'
import type { ValueMapResult } from '@/lib/value-map/types'

function currencySymbol(currency: string): string {
  return { GBP: '\u00A3', USD: '$', EUR: '\u20AC' }[currency] ?? currency + ' '
}

function formatAmount(amount: number, currency: string): string {
  const sym = currencySymbol(currency)
  return `${sym}${amount.toLocaleString('en', { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`
}

interface CutDecision {
  transaction_id: string
  cut: boolean
}

interface CutOrKeepProps {
  results: ValueMapResult[]
  currency: string
  onComplete: (decisions: CutDecision[]) => void
}

type CardState = 'visible' | 'exiting' | 'entering'

export function CutOrKeep({ results, currency, onComplete }: CutOrKeepProps) {
  const leakBurdenItems = results.filter(
    (r) => r.quadrant === 'leak' || r.quadrant === 'burden',
  )

  const [currentIndex, setCurrentIndex] = useState(0)
  const [decisions, setDecisions] = useState<CutDecision[]>([])
  const [cardState, setCardState] = useState<CardState>('visible')
  const [showSummary, setShowSummary] = useState(false)

  // Auto-skip if no qualifying items
  useEffect(() => {
    if (leakBurdenItems.length === 0) {
      onComplete([])
    }
  }, [leakBurdenItems.length, onComplete])

  const handleDecision = useCallback((cut: boolean) => {
    if (cardState !== 'visible') return

    const item = leakBurdenItems[currentIndex]
    const newDecision: CutDecision = { transaction_id: item.transaction_id, cut }

    setCardState('exiting')

    setTimeout(() => {
      const updated = [...decisions, newDecision]
      setDecisions(updated)

      if (currentIndex + 1 >= leakBurdenItems.length) {
        setShowSummary(true)
      } else {
        setCurrentIndex((i) => i + 1)
        setCardState('entering')
        setTimeout(() => setCardState('visible'), 250)
      }
    }, 200)
  }, [cardState, currentIndex, decisions, leakBurdenItems])

  if (leakBurdenItems.length === 0) return null

  // ── Summary screen ──────────────────────────────────────────────────────────
  if (showSummary) {
    const cutItems = decisions
      .filter((d) => d.cut)
      .map((d) => leakBurdenItems.find((r) => r.transaction_id === d.transaction_id)!)
      .filter(Boolean)

    const monthlyTotal = cutItems.reduce((sum, item) => sum + item.amount, 0)
    const annualTotal = monthlyTotal * 12

    return (
      <div className="flex flex-col items-center h-full px-4 py-4 gap-5 overflow-y-auto">
        <CfoAvatar size="sm" />

        {cutItems.length > 0 ? (
          <>
            <div className="rounded-xl border border-[#E8A84C]/30 bg-[#E8A84C]/5 p-4 max-w-sm text-center animate-cut-savings-reveal">
              <p className="text-sm text-muted-foreground mb-2">You&apos;d cut</p>
              <p className="text-3xl font-mono font-bold text-foreground">
                {formatAmount(monthlyTotal, currency)}
                <span className="text-base font-normal text-muted-foreground">/month</span>
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                That&apos;s {formatAmount(annualTotal, currency)} a year
              </p>
            </div>

            <div className="w-full max-w-sm space-y-1.5">
              {cutItems.map((item) => (
                <div
                  key={item.transaction_id}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#E53E3E]/10"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Scissors className="h-3.5 w-3.5 text-[#E53E3E] shrink-0" />
                    <span className="text-sm text-foreground truncate">{item.merchant}</span>
                  </div>
                  <span className="font-mono text-sm text-[#E53E3E] shrink-0">
                    {formatAmount(item.amount, currency)}
                  </span>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-[#E8A84C]/30 bg-[#E8A84C]/5 p-4 max-w-sm">
              <p className="text-sm text-foreground leading-relaxed">
                Upload your real statement and I&apos;ll find the actual numbers behind these.
                The gap between what you think and what you spend is where the savings hide.
              </p>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-[#E8A84C]/30 bg-[#E8A84C]/5 p-4 max-w-sm text-center">
            <p className="text-sm text-foreground leading-relaxed">
              You&apos;re keeping everything on the list. That&apos;s a clear signal
              &mdash; your spending feels intentional. Let&apos;s see if the real numbers back that up.
            </p>
          </div>
        )}

        <Button
          onClick={() => onComplete(decisions)}
          className="w-full max-w-sm bg-[#E8A84C] hover:bg-[#d4963f] text-black font-semibold py-5 text-base"
        >
          Continue
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    )
  }

  // ── Card view ───────────────────────────────────────────────────────────────
  const item = leakBurdenItems[currentIndex]
  const total = leakBurdenItems.length
  const progressPercent = ((currentIndex + 1) / total) * 100
  const quadrant = item.quadrant as 'leak' | 'burden'
  const quadrantDef = QUADRANTS[quadrant]

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Progress bar */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
          <span>{currentIndex + 1} of {total}</span>
          <span className="text-[#E8A84C]">Would you cut it?</span>
        </div>
        <div className="h-1 w-full rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full bg-[#E8A84C] transition-all duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Card */}
      <div className="flex flex-col items-center justify-center flex-1 px-4">
        <div
          className={
            cardState === 'exiting'
              ? 'animate-value-card-exit'
              : cardState === 'entering'
                ? 'animate-value-card-enter'
                : ''
          }
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 space-y-4 text-center">
            {/* Quadrant badge */}
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
              style={{
                backgroundColor: `${quadrantDef.colour}20`,
                color: quadrantDef.colour,
              }}
            >
              {quadrantDef.emoji} {quadrantDef.name}
            </span>

            {/* Merchant + amount */}
            <div>
              <p className="text-lg font-semibold text-foreground">{item.merchant}</p>
              <p className="text-2xl font-mono font-bold text-foreground mt-1">
                {formatAmount(item.amount, currency)}
                <span className="text-sm font-normal text-muted-foreground">/month</span>
              </p>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
              <Button
                onClick={() => handleDecision(true)}
                className="flex-1 bg-[#E53E3E] hover:bg-red-600 text-white font-semibold py-5 text-sm"
              >
                <Scissors className="mr-1.5 h-4 w-4" />
                I&apos;d cut this
              </Button>
              <Button
                variant="outline"
                onClick={() => handleDecision(false)}
                className="flex-1 text-muted-foreground border-border py-5 text-sm"
              >
                I&apos;d keep it
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
