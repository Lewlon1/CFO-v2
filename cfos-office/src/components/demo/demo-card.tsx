'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CfoAvatar } from '@/components/chat/cfo-avatar'
import { QUADRANTS, QUADRANT_ORDER } from '@/lib/value-map/constants'
import { getDemoFeedback, getDemoMilestoneFeedback } from '@/lib/demo/feedback'
import type { ValueMapResult, ValueQuadrant } from '@/lib/value-map/types'
import type { DemoTransaction } from '@/lib/demo/transactions'
import { demoAnalytics } from '@/lib/demo/analytics'
import { cn } from '@/lib/utils'

// ── Constants ────────────────────────────────────────────────────────────────

const FEEDBACK_DURATION = 5000
const CARD_TRANSITION = 250
const GATE_DURATION = 1500
const HARD_TO_DECIDE_DELAY = 3000

// ── Currency formatting ──────────────────────────────────────────────────────

function currencySymbol(currency: string): string {
  return { GBP: '\u00A3', USD: '$', EUR: '\u20AC' }[currency] ?? currency + ' '
}

function formatAmount(amount: number, currency: string): string {
  const sym = currencySymbol(currency)
  return `${sym}${amount.toLocaleString('en', { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`
}

// ── Confidence dots ─────────────────────────────────────────────────────────

function ConfidenceDots({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-xs text-muted-foreground">How sure are you?</span>
      <div className="flex items-center gap-2.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={cn(
              'h-10 w-10 rounded-full border-2 transition-all duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              n <= value
                ? 'border-[#E8A84C] bg-[#E8A84C]'
                : 'border-border bg-transparent',
            )}
            aria-label={`Confidence ${n} of 5`}
          />
        ))}
      </div>
      <div className="flex justify-between w-full max-w-[200px]">
        <span className="text-xs text-muted-foreground">Not sure</span>
        <span className="text-xs text-muted-foreground">Certain</span>
      </div>
    </div>
  )
}

// ── Types ────────────────────────────────────────────────────────────────────

interface DemoCardProps {
  transactions: DemoTransaction[]
  onComplete: (results: ValueMapResult[], elapsedSeconds: number) => void
  onFirstTap?: () => void
  onCardResult?: (result: ValueMapResult, questionText: string, cardIndex: number) => void
}

type CardState = 'visible' | 'exiting' | 'feedback' | 'entering'

// ── Component ────────────────────────────────────────────────────────────────

export function DemoCard({ transactions, onComplete, onFirstTap, onCardResult }: DemoCardProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [results, setResults] = useState<ValueMapResult[]>([])
  const [cardState, setCardState] = useState<CardState>('visible')
  const [feedbackText, setFeedbackText] = useState('')

  const [selectedQuadrant, setSelectedQuadrant] = useState<ValueQuadrant | null>(null)
  const [confidence, setConfidence] = useState(3)

  const [canTap, setCanTap] = useState(false)
  const [showHardToDecide, setShowHardToDecide] = useState(false)

  // Timing refs
  const cardShownAt = useRef<number>(0)
  const firstTapAt = useRef<number | null>(null)
  const exerciseStartedAt = useRef<number>(Date.now())

  // Scroll ref for confirm area
  const confirmRef = useRef<HTMLDivElement>(null)

  // Timer refs
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const total = transactions.length
  const tx = transactions[currentIndex]
  const currency = tx.currency

  // No longer need feedbackTransactions — demo uses its own feedback engine

  // Running totals for the allocation strip
  const totals = results.reduce(
    (acc, r) => {
      if (r.quadrant) acc[r.quadrant] += r.amount
      return acc
    },
    { foundation: 0, investment: 0, burden: 0, leak: 0 } as Record<ValueQuadrant, number>,
  )
  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0)

  // ── Gate + timing reset on each new card ───────────────────────────────────

  useEffect(() => {
    setCanTap(false)
    setShowHardToDecide(false)
    setSelectedQuadrant(null)
    setConfidence(3)

    cardShownAt.current = Date.now()
    firstTapAt.current = null

    gateTimerRef.current = setTimeout(() => setCanTap(true), GATE_DURATION)
    hardTimerRef.current = setTimeout(() => setShowHardToDecide(true), HARD_TO_DECIDE_DELAY)

    return () => {
      if (gateTimerRef.current) clearTimeout(gateTimerRef.current)
      if (hardTimerRef.current) clearTimeout(hardTimerRef.current)
    }
  }, [currentIndex])

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [])

  // ── Navigation ─────────────────────────────────────────────────────────────

  const finishExercise = useCallback((finalResults: ValueMapResult[]) => {
    const elapsed = (Date.now() - exerciseStartedAt.current) / 1000
    onComplete(finalResults, elapsed)
  }, [onComplete])

  const advanceToNext = useCallback(() => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = null

    if (currentIndex + 1 >= total) return

    setCardState('entering')
    setCurrentIndex((i) => i + 1)
    setFeedbackText('')

    setTimeout(() => {
      setCardState('visible')
    }, CARD_TRANSITION)
  }, [currentIndex, total])

  // ── Quadrant selection ────────────────────────────────────────────────────

  const handleQuadrantSelect = useCallback(
    (quadrant: ValueQuadrant) => {
      if (cardState !== 'visible' || !canTap) return
      if (!firstTapAt.current) {
        firstTapAt.current = Date.now()
        onFirstTap?.()
      }
      setSelectedQuadrant(quadrant)
      // Scroll confirm area into view on mobile
      setTimeout(() => {
        confirmRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
    },
    [cardState, canTap, onFirstTap],
  )

  // ── Confirm selection ────────────────────────────────────────────────────

  const handleConfirm = useCallback(() => {
    if (!selectedQuadrant || cardState !== 'visible') return

    const now = Date.now()
    const result: ValueMapResult = {
      transaction_id: tx.id,
      quadrant: selectedQuadrant,
      merchant: tx.merchant,
      amount: tx.amount,
      confidence,
      first_tap_ms: (firstTapAt.current ?? now) - cardShownAt.current,
      card_time_ms: now - cardShownAt.current,
      deliberation_ms: now - (firstTapAt.current ?? now),
      hard_to_decide: false,
    }

    const newResults = [...results, result]
    setResults(newResults)
    onCardResult?.(result, tx.context, currentIndex)
    demoAnalytics('demo_card_completed', { card: currentIndex + 1, merchant: tx.merchant, quadrant: selectedQuadrant })

    const feedback = getDemoFeedback({
      merchant: tx.merchant,
      amount: tx.amount,
      currency,
      quadrant: selectedQuadrant,
      cardNumber: currentIndex + 1,
      totalCards: total,
    })

    const milestone = getDemoMilestoneFeedback(
      currentIndex + 1,
      total,
      newResults,
    )
    setFeedbackText(milestone ? `${feedback} ${milestone}` : feedback)

    setCardState('exiting')

    setTimeout(() => {
      setCardState('feedback')

      if (currentIndex + 1 >= total) {
        feedbackTimerRef.current = setTimeout(() => {
          finishExercise(newResults)
        }, FEEDBACK_DURATION)
        return
      }

      feedbackTimerRef.current = setTimeout(() => {
        advanceToNext()
      }, FEEDBACK_DURATION)
    }, CARD_TRANSITION)
  }, [selectedQuadrant, cardState, tx, results, currency, confidence, currentIndex, total, finishExercise, advanceToNext, onCardResult])

  // ── Hard to decide ────────────────────────────────────────────────────────

  const handleHardToDecide = useCallback(() => {
    if (cardState !== 'visible') return

    const now = Date.now()
    const result: ValueMapResult = {
      transaction_id: tx.id,
      quadrant: null,
      merchant: tx.merchant,
      amount: tx.amount,
      confidence: 0,
      first_tap_ms: firstTapAt.current ? firstTapAt.current - cardShownAt.current : null,
      card_time_ms: now - cardShownAt.current,
      deliberation_ms: firstTapAt.current ? now - firstTapAt.current : 0,
      hard_to_decide: true,
    }

    const newResults = [...results, result]
    setResults(newResults)
    onCardResult?.(result, tx.context, currentIndex)

    if (currentIndex + 1 >= total) {
      finishExercise(newResults)
      return
    }

    setCardState('entering')
    setCurrentIndex((i) => i + 1)
    setFeedbackText('')

    setTimeout(() => {
      setCardState('visible')
    }, CARD_TRANSITION)
  }, [cardState, tx, results, currentIndex, total, finishExercise, onCardResult])

  const handleFeedbackTap = useCallback(() => {
    if (cardState === 'feedback') {
      if (currentIndex + 1 >= total) {
        if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
        finishExercise([...results])
      } else {
        advanceToNext()
      }
    }
  }, [cardState, currentIndex, total, results, finishExercise, advanceToNext])

  if (!tx) return null

  const progressPercent = ((currentIndex + 1) / total) * 100

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      {/* Progress bar */}
      <div className="px-4 pt-3 pb-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>{currentIndex + 1} of {total}</span>
        </div>
        <div className="h-1 w-full rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full bg-[#E8A84C] transition-all duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Running totals strip */}
      {grandTotal > 0 && (
        <div className="px-4 pb-1.5">
          <div className="flex h-2 w-full rounded-full overflow-hidden bg-border">
            {QUADRANT_ORDER.map((qId) => {
              const pct = (totals[qId as ValueQuadrant] / grandTotal) * 100
              if (pct === 0) return null
              return (
                <div
                  key={qId}
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: QUADRANTS[qId].colour,
                  }}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Card area */}
      <div className="flex flex-col items-center px-4 py-1.5 shrink-0">
        {/* Feedback overlay */}
        {cardState === 'feedback' && feedbackText && (
          <div
            className="flex flex-col items-center gap-3 text-center px-6 animate-value-feedback cursor-pointer"
            onClick={handleFeedbackTap}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleFeedbackTap() }}
          >
            <CfoAvatar size="sm" />
            <p className="text-sm text-foreground leading-relaxed max-w-xs">
              {feedbackText}
            </p>
            <p className="text-xs text-muted-foreground">Tap to continue</p>
          </div>
        )}

        {/* Transaction card */}
        {(cardState === 'visible' || cardState === 'exiting' || cardState === 'entering') && (
          <div
            className={cn(
              'w-full max-w-sm rounded-xl border border-border bg-card px-5 py-4 text-center space-y-1.5 relative overflow-hidden',
              cardState === 'exiting' && 'animate-value-card-exit',
              cardState === 'entering' && 'animate-value-card-enter',
            )}
          >
            {/* Engagement gate progress bar */}
            {!canTap && cardState === 'visible' && (
              <div className="absolute top-0 left-0 h-0.5 bg-[#E8A84C] animate-value-gate" />
            )}

            <p className="text-lg font-semibold text-foreground">
              {tx.merchant}
            </p>
            <p className="font-mono text-2xl font-bold text-foreground">
              {formatAmount(tx.amount, currency)}
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {tx.context}
            </p>
          </div>
        )}
      </div>

      {/* Quadrant question */}
      {cardState === 'visible' && (
        <div className="px-4 pb-1.5">
          <p className="text-xs font-medium text-muted-foreground text-center uppercase tracking-wide mb-2">
            How do you feel about this spend?
          </p>
        </div>
      )}

      {/* Quadrant buttons (2x2 grid) */}
      {cardState === 'visible' && (
        <div
          className={cn(
            'grid grid-cols-2 gap-2 px-4 pb-1.5 transition-opacity duration-300',
            !canTap && 'opacity-40 pointer-events-none',
          )}
        >
          {QUADRANT_ORDER.map((qId) => {
            const q = QUADRANTS[qId]
            const isSelected = selectedQuadrant === qId
            return (
              <button
                key={qId}
                onClick={() => handleQuadrantSelect(qId as ValueQuadrant)}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 rounded-xl border-2 p-3 transition-all duration-150',
                  'active:scale-[0.97]',
                  'min-h-[68px]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  isSelected
                    ? 'ring-2 ring-offset-2 ring-offset-background'
                    : selectedQuadrant
                      ? 'opacity-50'
                      : 'hover:bg-card/80',
                )}
                style={{
                  borderColor: isSelected ? q.colour : q.colour + '40',
                  backgroundColor: isSelected ? q.colour + '18' : q.colour + '08',
                  ...(isSelected ? { '--tw-ring-color': q.colour } as React.CSSProperties : {}),
                }}
              >
                <span className="text-xl" role="img" aria-hidden>{q.emoji}</span>
                <span className="text-sm font-semibold" style={{ color: q.colour }}>
                  {q.name}
                </span>
                <span className="text-xs text-muted-foreground leading-tight">
                  {q.tagline}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Confidence slider + Confirm button */}
      {cardState === 'visible' && selectedQuadrant && (
        <div ref={confirmRef} className="px-4 pb-2 flex flex-col items-center gap-3 animate-value-feedback">
          <ConfidenceDots value={confidence} onChange={setConfidence} />
          <Button
            onClick={handleConfirm}
            className="w-full max-w-xs bg-[#E8A84C] hover:bg-[#d4963f] text-black font-semibold py-4 text-base"
          >
            Next
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Hard to decide button — stays visible even after a quadrant is selected */}
      {cardState === 'visible' && showHardToDecide && (
        <div className="px-4 pb-3 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handleHardToDecide}
            className="text-sm text-muted-foreground border-border/60 hover:text-foreground hover:border-border"
          >
            Hard to decide? Skip this one
          </Button>
        </div>
      )}

      {/* Bottom safe area spacer */}
      <div className="pb-4 shrink-0" />
    </div>
  )
}
