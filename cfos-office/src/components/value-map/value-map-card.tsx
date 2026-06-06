'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Undo2, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { QUADRANTS, QUADRANT_ORDER } from '@/lib/value-map/constants'
import { VALUE_MAP_INTRO_UNSURE_BUCKET } from '@/lib/value-map/copy'
import { formatAmount, formatDateWithDay } from '@/lib/value-map/format'
import { createClient } from '@/lib/supabase/client'
import { getFeedback, getMilestoneFeedback } from '@/lib/value-map/feedback'
import type { ValueMapTransaction, ValueMapResult, ValueQuadrant } from '@/lib/value-map/types'
import { cn } from '@/lib/utils'
import { useTrackEvent } from '@/lib/events/use-track-event'

// ── Constants ────────────────────────────────────────────────────────────────

const FEEDBACK_DURATION = 5000 // ms
const CARD_TRANSITION = 250 // ms
const GATE_DURATION = 1500 // ms — buttons inert for this long

// ── Types ────────────────────────────────────────────────────────────────────

interface ValueMapCardProps {
  transactions: ValueMapTransaction[]
  currency: string
  onComplete: (results: ValueMapResult[]) => void
  onTransactionResult?: (result: ValueMapResult, index: number, total: number) => void
}

type CardState = 'visible' | 'exiting' | 'feedback' | 'entering'

// ── Confidence dots ─────────────────────────────────────────────────────────

function ConfidenceDots({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs text-text-secondary">How sure are you?</span>
      <div className="flex items-center gap-3">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={cn(
              'h-11 w-11 rounded-full border-2 transition-all duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              n <= value
                ? 'border-accent-gold bg-accent-gold'
                : 'border-[var(--border-subtle)] bg-transparent',
            )}
            aria-label={`Confidence ${n} of 5`}
          />
        ))}
      </div>
      <div className="flex justify-between w-full max-w-[200px]">
        <span className="text-xs text-text-secondary">Not sure</span>
        <span className="text-xs text-text-secondary">Certain</span>
      </div>
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export function ValueMapCard({ transactions, currency, onComplete, onTransactionResult }: ValueMapCardProps) {
  const trackEvent = useTrackEvent()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [results, setResults] = useState<ValueMapResult[]>([])
  const [cardState, setCardState] = useState<CardState>('visible')
  const [feedbackText, setFeedbackText] = useState('')

  // Select-then-confirm state
  const [selectedQuadrant, setSelectedQuadrant] = useState<ValueQuadrant | null>(null)
  const [confidence, setConfidence] = useState(3)

  // Engagement gate state
  const [canTap, setCanTap] = useState(false)

  // Traditional-category correction: list fetched once, edits tracked per txn.
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, string>>({})

  // Timing refs
  const cardShownAt = useRef<number>(0)
  const firstTapAt = useRef<number | null>(null)

  // Timer refs
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const total = transactions.length
  const tx = transactions[currentIndex]

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
    // Reset gate
    // eslint-disable-next-line react-hooks/set-state-in-effect -- per-card reset keyed on currentIndex; entangled with timing refs + the gate timer below
    setCanTap(false)
    setSelectedQuadrant(null)
    setConfidence(3)

    // Reset timing
    cardShownAt.current = Date.now()
    firstTapAt.current = null

    // Start gate timer
    gateTimerRef.current = setTimeout(() => setCanTap(true), GATE_DURATION)

    return () => {
      if (gateTimerRef.current) clearTimeout(gateTimerRef.current)
    }
  }, [currentIndex])

  // Cleanup feedback timer on unmount
  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [])

  // ── Navigation ─────────────────────────────────────────────────────────────

  const advanceToNext = useCallback(() => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = null

    if (currentIndex + 1 >= total) {
      return
    }

    setCardState('entering')
    setCurrentIndex((i) => i + 1)
    setFeedbackText('')

    setTimeout(() => {
      setCardState('visible')
    }, CARD_TRANSITION)
  }, [currentIndex, total])

  // ── Quadrant selection (not submission) ────────────────────────────────────

  const handleQuadrantSelect = useCallback(
    (quadrant: ValueQuadrant) => {
      if (cardState !== 'visible' || !canTap) return

      // Record first tap timing
      if (!firstTapAt.current) {
        firstTapAt.current = Date.now()
      }

      setSelectedQuadrant(quadrant)
    },
    [cardState, canTap],
  )

  // ── Confirm selection (submit card) ────────────────────────────────────────

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- compiler can't preserve this useCallback; it mutates timing refs, schedules a feedback timer, and fires onComplete/onTransactionResult with closure-captured values — keep explicit memoization
  const handleConfirm = useCallback(() => {
    if (!selectedQuadrant || cardState !== 'visible') return

    const now = Date.now()
    const result: ValueMapResult = {
      transaction_id: tx.id,
      quadrant: selectedQuadrant,
      merchant: tx.merchant ?? tx.description ?? 'Unknown',
      amount: tx.amount,
      confidence,
      first_tap_ms: (firstTapAt.current ?? now) - cardShownAt.current,
      card_time_ms: now - cardShownAt.current,
      deliberation_ms: now - (firstTapAt.current ?? now),
      hard_to_decide: false,
    }

    trackEvent('value_map_tap', 'behavioural', {
      merchant: result.merchant,
      quadrant: result.quadrant,
      deliberation_ms: result.deliberation_ms,
      card_time_ms: result.card_time_ms,
      amount: result.amount,
    })

    const newResults = [...results, result]
    setResults(newResults)

    // Fire per-transaction callback for reactive comments
    onTransactionResult?.(result, currentIndex, total)

    // Get feedback
    const feedback = getFeedback({
      merchant: tx.merchant,
      amount: tx.amount,
      quadrant: selectedQuadrant,
      currency,
      isRecurring: tx.is_recurring,
      description: tx.description,
      categoryName: tx.category_name ?? null,
    })

    const milestone = getMilestoneFeedback({
      cardNumber: currentIndex + 1,
      totalCards: total,
      resultsSoFar: newResults,
      transactions,
    })
    setFeedbackText(milestone ? `${feedback} ${milestone}` : feedback)

    // Animate card out
    setCardState('exiting')

    setTimeout(() => {
      setCardState('feedback')

      if (currentIndex + 1 >= total) {
        feedbackTimerRef.current = setTimeout(() => {
          onComplete(newResults)
        }, FEEDBACK_DURATION)
        return
      }

      feedbackTimerRef.current = setTimeout(() => {
        advanceToNext()
      }, FEEDBACK_DURATION)
    }, CARD_TRANSITION)
  }, [selectedQuadrant, cardState, tx, results, currency, confidence, currentIndex, total, onComplete, onTransactionResult, advanceToNext])

  // ── Hard to decide (escape hatch) ──────────────────────────────────────────

  const handleHardToDecide = useCallback(() => {
    if (cardState !== 'visible') return

    const now = Date.now()
    const result: ValueMapResult = {
      transaction_id: tx.id,
      quadrant: null,
      merchant: tx.merchant ?? tx.description ?? 'Unknown',
      amount: tx.amount,
      confidence: 0,
      first_tap_ms: firstTapAt.current ? firstTapAt.current - cardShownAt.current : null,
      card_time_ms: now - cardShownAt.current,
      deliberation_ms: firstTapAt.current ? now - firstTapAt.current : 0,
      hard_to_decide: true,
    }

    const newResults = [...results, result]
    setResults(newResults)

    // Fire per-transaction callback for reactive comments
    onTransactionResult?.(result, currentIndex, total)

    // Skip feedback — advance directly
    if (currentIndex + 1 >= total) {
      onComplete(newResults)
      return
    }

    setCardState('entering')
    setCurrentIndex((i) => i + 1)
    setFeedbackText('')

    setTimeout(() => {
      setCardState('visible')
    }, CARD_TRANSITION)
  }, [cardState, tx, results, currentIndex, total, onComplete, onTransactionResult])

  // Tap-to-skip: clicking anywhere during feedback advances immediately
  const handleFeedbackTap = useCallback(() => {
    if (cardState === 'feedback') {
      if (currentIndex + 1 >= total) {
        if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
        onComplete([...results])
      } else {
        advanceToNext()
      }
    }
  }, [cardState, currentIndex, total, results, onComplete, advanceToNext])

  const handleUndo = useCallback(() => {
    if (results.length === 0 || cardState !== 'visible') return

    setResults((prev) => prev.slice(0, -1))
    setCurrentIndex((i) => Math.max(0, i - 1))
    setFeedbackText('')
    setSelectedQuadrant(null)
    setConfidence(3)
    setCardState('visible')

    // Timing refs will be reset by the currentIndex effect
  }, [results.length, cardState])

  // Load the traditional-category list once (global; names for the dropdown).
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const supabase = createClient()
        const { data } = await supabase
          .from('categories')
          .select('id, name')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
        if (!cancelled && data) setCategories(data as { id: string; name: string }[])
      } catch (err) {
        console.error('[value-map] categories load failed', err)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Correct a transaction's traditional category — optimistic; persists and
  // teaches a merchant rule server-side, reverting the UI on failure.
  const handleCategoryChange = useCallback(
    async (txId: string, newCategoryId: string) => {
      const prev =
        categoryOverrides[txId] ?? transactions.find((t) => t.id === txId)?.category_id ?? ''
      if (!newCategoryId || newCategoryId === prev) return
      setCategoryOverrides((o) => ({ ...o, [txId]: newCategoryId }))
      try {
        const res = await fetch('/api/transactions/recategorise', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transaction_id: txId, category_id: newCategoryId }),
        })
        if (!res.ok) throw new Error(`recategorise ${res.status}`)
      } catch (err) {
        console.error('[value-map] category change failed', err)
        setCategoryOverrides((o) => ({ ...o, [txId]: prev }))
      }
    },
    [categoryOverrides, transactions],
  )

  if (!tx) return null

  // When the card is in feedback state, the user has already decided this card,
  // so show it as "done" by displaying the next card's number (capped at total).
  // This avoids the counter appearing stuck during the feedback reflection moment.
  const displayIndex =
    cardState === 'feedback' ? Math.min(currentIndex + 2, total) : currentIndex + 1
  const progressPercent = (displayIndex / total) * 100

  // Sample cards (ids like "vm-…") have no DB row to correct — read-only.
  const isRealTxn = !/^(vm-|sample-|csv-|ocr-)/.test(tx.id)
  const currentCategoryId = categoryOverrides[tx.id] ?? tx.category_id ?? ''
  const currentCategoryName =
    categories.find((c) => c.id === currentCategoryId)?.name ?? 'Uncategorised'
  const frequency = tx.context ?? (tx.is_recurring ? 'Recurring monthly' : null)

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      {/* Progress bar */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between text-xs text-text-secondary mb-1.5">
          <span>{displayIndex} of {total}</span>
        </div>
        <div className="h-1 w-full rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full bg-accent-gold transition-all duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Running totals strip */}
      {grandTotal > 0 && (
        <div className="px-4 pb-2">
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
      <div className="flex flex-col items-center px-4 py-2 shrink-0">
        {/* Feedback overlay */}
        {cardState === 'feedback' && feedbackText && (
          <div
            className="flex flex-col items-center gap-3 text-center px-6 animate-value-feedback cursor-pointer"
            onClick={handleFeedbackTap}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleFeedbackTap() }}
          >
            <CFOAvatar size={24} />
            <p className="text-sm text-text-primary leading-relaxed max-w-xs">
              {feedbackText}
            </p>
            <p className="text-xs text-text-secondary">Tap to continue</p>
          </div>
        )}

        {/* Transaction card */}
        {(cardState === 'visible' || cardState === 'exiting' || cardState === 'entering') && (
          <div
            className={cn(
              'w-full max-w-sm rounded-card border border-[var(--border-subtle)] bg-bg-elevated px-6 py-4 text-center space-y-1 relative overflow-hidden',
              cardState === 'exiting' && 'animate-value-card-exit',
              cardState === 'entering' && 'animate-value-card-enter',
            )}
          >
            {/* Engagement gate progress bar */}
            {!canTap && cardState === 'visible' && (
              <div className="absolute top-0 left-0 h-0.5 bg-accent-gold animate-value-gate" />
            )}

            <p className="text-lg font-semibold text-text-primary">
              {tx.description ?? tx.merchant ?? 'Transaction'}
            </p>
            <p className="font-data text-2xl font-bold text-text-primary">
              {formatAmount(tx.amount, currency)}
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-text-secondary">
              <span>{formatDateWithDay(tx.transaction_date)}</span>
              {frequency && (
                <>
                  <span className="text-border">&middot;</span>
                  <span>{frequency}</span>
                </>
              )}
            </div>
            {/* Traditional category — last in the card. Editable select for real
                transactions (office select idiom: rounded-lg + native arrow);
                persists + teaches a merchant rule. Read-only label for samples. */}
            {categories.length > 0 && (isRealTxn || currentCategoryId) && (
              <div className="pt-1.5">
                {isRealTxn ? (
                  <select
                    value={currentCategoryId}
                    onChange={(e) => handleCategoryChange(tx.id, e.target.value)}
                    aria-label="Transaction category"
                    className="w-full min-h-[44px] rounded-lg border border-[var(--border-subtle)] bg-bg-elevated px-2 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-text-primary/40"
                  >
                    {!currentCategoryId && <option value="">Uncategorised</option>}
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="flex w-full items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-bg-elevated px-2 py-2 text-sm text-text-secondary">
                    {currentCategoryName}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quadrant question */}
      {cardState === 'visible' && (
        <div className="px-4 pb-2">
          <p className="text-xs font-medium text-text-secondary text-center uppercase tracking-wide mb-3">
            How do you feel about this spend?
          </p>
        </div>
      )}

      {/* Quadrant buttons (2x2 grid) */}
      {cardState === 'visible' && (
        <div
          className={cn(
            'grid grid-cols-2 gap-2 px-4 pb-2 transition-opacity duration-300',
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
                  'flex flex-col items-center justify-center gap-1 rounded-card border-2 p-4 transition-all duration-150',
                  'active:scale-[0.97]',
                  'min-h-[80px]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  isSelected
                    ? 'ring-2 ring-offset-2 ring-offset-background'
                    : selectedQuadrant
                      ? 'opacity-50'
                      : 'hover:bg-bg-elevated/80',
                )}
                style={{
                  borderColor: isSelected
                    ? q.colour
                    : `color-mix(in oklab, ${q.colour} 25%, transparent)`,
                  backgroundColor: isSelected
                    ? `color-mix(in oklab, ${q.colour} 9%, transparent)`
                    : `color-mix(in oklab, ${q.colour} 3%, transparent)`,
                  ...(isSelected ? { '--tw-ring-color': q.colour } as React.CSSProperties : {}),
                }}
              >
                <span className="text-xl" role="img" aria-hidden>{q.emoji}</span>
                <span className="text-sm font-semibold" style={{ color: q.colour }}>
                  {q.name}
                </span>
                <span className="text-xs text-text-secondary leading-tight">
                  {q.tagline}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Confidence slider + Confirm button (visible after quadrant selection) */}
      {cardState === 'visible' && selectedQuadrant && (
        <div className="px-4 pb-2 flex flex-col items-center gap-4 animate-value-feedback">
          <ConfidenceDots value={confidence} onChange={setConfidence} />
          <Button
            onClick={handleConfirm}
            className="w-full max-w-xs bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-5 text-base"
          >
            Next
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Hard to decide button */}
      {cardState === 'visible' && !selectedQuadrant && (
        <div
          className={cn(
            'px-4 pb-3 transition-opacity duration-300',
            !canTap && 'opacity-40 pointer-events-none',
          )}
        >
          <Button
            variant="outline"
            onClick={handleHardToDecide}
            className="w-full min-h-[56px] rounded-card text-sm font-medium text-text-secondary border-[var(--border-subtle)]/60 hover:text-text-primary hover:border-[var(--border-subtle)]"
          >
            <span className="text-base" role="img" aria-hidden>
              {VALUE_MAP_INTRO_UNSURE_BUCKET.emoji}
            </span>
            Unsure
          </Button>
        </div>
      )}

      {/* Undo button */}
      {cardState === 'visible' && results.length > 0 && !selectedQuadrant && (
        <div className="px-4 pb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleUndo}
            className="text-xs text-text-secondary"
          >
            <Undo2 className="h-3.5 w-3.5 mr-1" />
            Undo last
          </Button>
        </div>
      )}

      {/* Bottom safe area spacer */}
      <div className="pb-4 shrink-0" />
    </div>
  )
}
