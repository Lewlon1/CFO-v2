'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { MessageRenderer } from './MessageRenderer'
import { ValueMapBeat } from './beats/ValueMapBeat'
import { UploadBeat } from './beats/UploadBeat'
import { ArchetypeBeat } from './beats/ArchetypeBeat'
import { CapabilitySelector } from './beats/CapabilitySelector'
import { TypingIndicator } from './TypingIndicator'
import { useOnboarding } from '@/hooks/useOnboarding'
import { ONBOARDING_BEATS } from '@/lib/onboarding/types'
import type { OnboardingState, ArchetypeData, FirstInsightResult } from '@/lib/onboarding/types'
import type { ValueMapResult } from '@/lib/value-map/types'
import { shouldReact, getReactionMessage, type ReactionContext } from '@/lib/onboarding/value-map-reactions'
import { CSV_POLL_INTERVAL_MS, CSV_POLL_TIMEOUT_MS } from '@/lib/onboarding/constants'
import { InsightBeat } from './beats/InsightBeat'

interface OnboardingModalProps {
  initialProgress: OnboardingState | null
  userName?: string
  currency?: string
}

// ── Dynamic reaction message ────────────────────────────────────────────────

interface DynamicMessage {
  id: string
  text: string
  revealedAt?: number
}

function ReactionBubble({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-1.5 animate-[fade-in_0.3s_ease-out]">
      <CFOAvatar size={28} className="mt-0.5" />
      <div className="text-sm text-[var(--text-primary)] leading-relaxed max-w-[85%] font-[var(--font-dm-sans)]">
        {text}
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export function OnboardingModal({ initialProgress, userName, currency }: OnboardingModalProps) {
  const {
    state,
    currentBeat,
    messageIndex,
    messages,
    isComplete,
    isSkipped,
    advanceMessage,
    completeBeat,
    setData,
    skip,
    dismiss,
  } = useOnboarding({ initialProgress, userName, currency: currency ?? 'GBP' })

  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const currentBeatIdx = ONBOARDING_BEATS.indexOf(currentBeat)
  const embedRevealed = messages.findIndex((m) => m.action && !m.buttonText && !m.text) <= messageIndex

  // ── Archetype generation state ──────────────────────────────────────────

  const [archetypeLoading, setArchetypeLoading] = useState(false)
  const archetypeRequested = useRef(false)

  // ── First insight generation (uses PR #31 pattern-detection engine) ─────

  const [insightLoading, setInsightLoading] = useState(false)
  const insightRequested = useRef(false)

  // ── Dynamic reaction messages (Value Map) ───────────────────────────────

  const [dynamicMessages, setDynamicMessages] = useState<DynamicMessage[]>([])
  const [typingReaction, setTypingReaction] = useState(false)
  const valueMapResultsRef = useRef<ValueMapResult[]>([])
  const processedIndicesRef = useRef<Set<number>>(new Set())

  // ── Auto-advance messages ───────────────────────────────────────────────

  // After the archetype card renders, hold the conversation for at least
  // MIN_ARCHETYPE_DWELL_MS before showing the "upload a statement" bridge,
  // and never advance while the personality is still loading.
  const MIN_ARCHETYPE_DWELL_MS = 20000
  const [archetypeRevealedAt, setArchetypeRevealedAt] = useState<number | null>(null)

  const handleMessageRevealed = useCallback(() => {
    const currentMsg = messages[messageIndex]
    const nextIdx = messageIndex + 1
    const nextMsg = messages[nextIdx]
    if (!nextMsg) return

    if (currentMsg?.id === 'archetype-result') {
      setArchetypeRevealedAt(Date.now())
      return
    }

    autoAdvanceTimer.current = setTimeout(() => {
      advanceMessage()
    }, 300)
  }, [messageIndex, messages, advanceMessage])

  useEffect(() => {
    if (archetypeRevealedAt === null) return
    if (archetypeLoading || !state.data.archetypeData) return

    const elapsed = Date.now() - archetypeRevealedAt
    const remaining = Math.max(0, MIN_ARCHETYPE_DWELL_MS - elapsed)

    const t = setTimeout(() => {
      setArchetypeRevealedAt(null)
      advanceMessage()
    }, remaining)

    return () => clearTimeout(t)
  }, [archetypeRevealedAt, archetypeLoading, state.data.archetypeData, advanceMessage])

  // Start first message when entering a new beat
  useEffect(() => {
    if (messageIndex === -1 && messages.length > 0) {
      const timer = setTimeout(() => advanceMessage(), 500)
      return () => clearTimeout(timer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBeat])

  // Clear dynamic messages when leaving value_map beat
  useEffect(() => {
    if (currentBeat !== 'value_map') {
      setDynamicMessages([])
      setTypingReaction(false)
      valueMapResultsRef.current = []
      processedIndicesRef.current.clear()
    }
  }, [currentBeat])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current)
    }
  }, [])

  // ── Archetype generation trigger ────────────────────────────────────────

  useEffect(() => {
    if (
      currentBeat === 'archetype' &&
      embedRevealed &&
      state.data.personalityType &&
      !state.data.archetypeData &&
      !archetypeLoading &&
      !archetypeRequested.current
    ) {
      archetypeRequested.current = true
      setArchetypeLoading(true)

      fetch('/api/onboarding/generate-archetype', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responses: state.data.valueMapResults ?? [],
          personalityType: state.data.personalityType,
          userName: state.data.name ?? userName ?? 'there',
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.archetype) {
            setData({ archetypeData: data.archetype as ArchetypeData })
          }
        })
        .catch((err) => {
          console.error('[onboarding] Archetype generation failed:', err)
        })
        .finally(() => {
          setArchetypeLoading(false)
        })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBeat, embedRevealed, state.data.personalityType])

  // ── Insight generation (PR #31 pattern engine + Claude narration) ───────

  useEffect(() => {
    if (
      currentBeat !== 'first_insight' ||
      !embedRevealed ||
      !state.data.importBatchId ||
      state.data.insightData ||
      insightLoading ||
      insightRequested.current
    ) {
      return
    }
    insightRequested.current = true
    setInsightLoading(true)

    const run = async () => {
      // Wait for CSV processing so the engine has data to pattern against.
      const startedAt = Date.now()
      let csvReady = false
      while (!csvReady && Date.now() - startedAt < CSV_POLL_TIMEOUT_MS) {
        try {
          const statusRes = await fetch(
            `/api/onboarding/csv-status?batch_id=${state.data.importBatchId}`,
          )
          const statusData = await statusRes.json()
          if (statusData.status === 'completed') {
            csvReady = true
            if (statusData.transaction_count) {
              setData({ transactionCount: statusData.transaction_count })
            }
          } else {
            await new Promise((r) => setTimeout(r, CSV_POLL_INTERVAL_MS))
          }
        } catch {
          await new Promise((r) => setTimeout(r, CSV_POLL_INTERVAL_MS))
        }
      }

      if (!csvReady) {
        console.warn('[onboarding] CSV processing timed out')
        setInsightLoading(false)
        return
      }

      try {
        const res = await fetch('/api/onboarding/generate-insight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const data = (await res.json()) as { insight?: FirstInsightResult }
        if (data.insight) {
          setData({ insightData: data.insight })
        }
      } catch (err) {
        console.error('[onboarding] Insight generation failed:', err)
      } finally {
        setInsightLoading(false)
      }
    }

    run()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBeat, embedRevealed, state.data.importBatchId])

  // ── Action handlers ─────────────────────────────────────────────────────

  const handleAction = useCallback((action: string) => {
    switch (action) {
      case 'continue':
        completeBeat(currentBeat)
        break
      case 'handoff':
        dismiss()
        break
    }
  }, [currentBeat, completeBeat, dismiss])

  const handleValueMapComplete = useCallback((
    personalityType: string,
    dominantQuadrant: string,
    breakdown: Record<string, { total: number; percentage: number; count: number }>,
    results?: ValueMapResult[]
  ) => {
    completeBeat('value_map', {
      personalityType,
      dominantQuadrant,
      breakdown,
      valueMapResults: results,
    })
  }, [completeBeat])

  const handleValueMapSkip = useCallback(() => {
    completeBeat('value_map')
  }, [completeBeat])

  // ── Per-transaction reaction handler ────────────────────────────────────

  const handleTransactionResult = useCallback((
    result: ValueMapResult,
    index: number,
    total: number
  ) => {
    // Idempotency guard — prevent duplicate reactions if onTransactionResult
    // is fired twice for the same transaction (double-tap, React 18 dev double-invoke)
    if (processedIndicesRef.current.has(index)) return
    processedIndicesRef.current.add(index)

    valueMapResultsRef.current = [...valueMapResultsRef.current, result]

    const ctx: ReactionContext = {
      transactionIndex: index,
      responses: valueMapResultsRef.current,
      currentResponse: result,
      totalTransactions: total,
    }

    if (shouldReact(ctx)) {
      const message = getReactionMessage(ctx)
      if (message) {
        // Show typing indicator briefly, then reveal
        setTypingReaction(true)
        const delay = 800 + Math.random() * 400 // 800-1200ms
        setTimeout(() => {
          setTypingReaction(false)
          setDynamicMessages((prev) => [
            ...prev,
            { id: `reaction-${index}`, text: message, revealedAt: Date.now() },
          ])
        }, delay)
      }
    }
  }, [])

  // Once the first file imports, advance to capabilities while the wizard
  // keeps running in the background (mounted but hidden) for remaining files.
  const [uploadInFlight, setUploadInFlight] = useState(false)

  const handleUploadComplete = useCallback((importBatchId: string | null, transactionCount: number) => {
    if (importBatchId) setUploadInFlight(true)
    completeBeat('csv_upload', { importBatchId, transactionCount })
  }, [completeBeat])

  const handleUploadBackgroundDone = useCallback(() => {
    setUploadInFlight(false)
  }, [])

  const handleUploadSkip = useCallback(() => {
    setUploadInFlight(false)
    completeBeat('csv_upload')
  }, [completeBeat])

  const handleCapabilityComplete = useCallback((selected: string[]) => {
    completeBeat('capabilities', { selectedCapabilities: selected })
  }, [completeBeat])

  // All hooks declared — now safe to conditionally render
  if (isComplete || isSkipped) return null

  return (
    <div className="fixed inset-0 z-50 bg-[var(--bg-base)] flex flex-col h-dvh">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] shrink-0">
        <div className="flex items-center gap-3">
          <CFOAvatar size={28} withOnlineDot />
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">The CFO&apos;s Office</p>
            <p className="text-[10px] text-[var(--text-tertiary)]">First Meeting</p>
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5">
          {ONBOARDING_BEATS.map((beat, i) => (
            <span
              key={beat}
              className="w-1.5 h-1.5 rounded-full transition-all"
              style={{
                backgroundColor: i <= currentBeatIdx ? 'var(--accent-gold)' : 'var(--text-muted)',
                opacity: i === currentBeatIdx ? 1 : i < currentBeatIdx ? 0.5 : 0.3,
              }}
            />
          ))}
        </div>

        {/* Close button */}
        <button
          onClick={skip}
          className="flex items-center justify-center rounded-lg
                     text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]
                     hover:bg-[var(--bg-card)] transition-colors min-h-[44px] min-w-[44px]"
          aria-label="Close onboarding"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {/* Scrollable message area */}
      <div className="flex-1 overflow-y-auto min-h-0 py-4">
        <MessageRenderer
          key={currentBeat}
          messages={messages}
          messageIndex={messageIndex}
          data={state.data}
          onMessageRevealed={handleMessageRevealed}
          onAction={handleAction}
          archetypeSlot={
            currentBeat === 'archetype' && state.data.personalityType ? (
              <ArchetypeBeat
                data={state.data}
                archetypeData={state.data.archetypeData}
                loading={archetypeLoading}
              />
            ) : undefined
          }
          insightSlot={
            currentBeat === 'first_insight' ? (
              <InsightBeat
                insight={state.data.insightData}
                loading={insightLoading}
              />
            ) : undefined
          }
        />

        {/* Beat-specific embedded components */}
        {currentBeat === 'value_map' && embedRevealed && (
          <ValueMapBeat
            currency={state.data.currency ?? 'GBP'}
            onComplete={handleValueMapComplete}
            onSkip={handleValueMapSkip}
          />
        )}

        {((currentBeat === 'csv_upload' && embedRevealed) || uploadInFlight) && (
          <UploadBeat
            onComplete={handleUploadComplete}
            onSkip={handleUploadSkip}
            onBackgroundDone={handleUploadBackgroundDone}
            hidden={currentBeat !== 'csv_upload'}
          />
        )}

        {currentBeat === 'capabilities' && embedRevealed && (
          <CapabilitySelector onComplete={handleCapabilityComplete} />
        )}

      </div>

      {/* Safe area bottom padding */}
      <div className="shrink-0 pb-[env(safe-area-inset-bottom)]" />
    </div>
  )
}
