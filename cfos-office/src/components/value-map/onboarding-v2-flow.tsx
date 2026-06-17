'use client'

// VM-3 — the post-Read Value Map card session on the user's own transactions.
//
// Slim, fully deterministic flow (zero LLM calls anywhere on this path):
//
//   intro → exercise → saving → reveal → payback → CTA (/office/goals)
//
// VM-4: the archetype reveal occupies its documented slot between 'saving'
// and 'payback'. The save response carries the computed reveal payload
// (name, receipt, tension); if classification failed or is absent the flow
// falls straight through to payback exactly as before.
//
// Skippable at session start and on every card ("Later"): skipping writes no
// rules and triggers no re-score — it stamps the terminal onboarding step and
// arms the chat-offer columns via skipValueMapV2. Exit-and-resume is safe by
// construction: all writes happen once, at completion, so an abandoned
// session leaves no partial state and re-entry reselects the same cards
// deterministically.

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { CfoThinking } from '@/components/brand/CfoThinking'
import { ValueMapCard } from './value-map-card'
import { PaybackScreen } from './payback-screen'
import { ArchetypeReveal } from './archetype-reveal'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { skipValueMapV2 } from '@/app/onboarding-v2/value-map/v2-actions'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import {
  VM3_INTRO_HEADING,
  VM3_INTRO_BODY,
  VM3_INTRO_CTA,
  VM3_SKIP_LABEL,
  VM3_SAVING_LABELS,
} from '@/lib/value-map/copy'
import type { ValueMapTransaction, ValueMapResult } from '@/lib/value-map/types'
import type { PaybackSummary } from '@/lib/value-map/payback'
import type { RevealPayload } from '@/lib/value-map/reveal'

type FlowStep = 'intro' | 'exercise' | 'saving' | 'reveal' | 'payback'

interface OnboardingValueMapV2Props {
  cards: ValueMapTransaction[]
  currency: string
}

export function OnboardingValueMapV2({ cards, currency }: OnboardingValueMapV2Props) {
  const router = useRouter()
  const trackEvent = useTrackEvent()
  const [step, setStep] = useState<FlowStep>('intro')
  const [payback, setPayback] = useState<PaybackSummary | null>(null)
  const [reveal, setReveal] = useState<RevealPayload | null>(null)
  // Re-entry guards (refs, not state — a second fire racing in the same
  // render cycle must see the latched value).
  const saveInFlight = useRef(false)
  const skipInFlight = useRef(false)

  const handleSkip = useCallback(async () => {
    if (skipInFlight.current || saveInFlight.current) return
    skipInFlight.current = true
    trackEvent('value_map_v2_skipped', { at_step: step })
    try {
      await skipValueMapV2()
    } catch (err) {
      console.error('[value-map-v2] skip failed', err)
    }
    router.push('/office')
  }, [router, step, trackEvent])

  const handleStart = useCallback(() => {
    trackEvent('value_map_v2_started', { card_count: cards.length })
    setStep('exercise')
  }, [cards.length, trackEvent])

  const handleComplete = useCallback(
    async (results: ValueMapResult[]) => {
      if (saveInFlight.current) return
      saveInFlight.current = true
      setStep('saving')
      try {
        const res = await fetch('/api/value-map/onboarding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            results: results.map((r) => ({
              transaction_id: r.transaction_id,
              quadrant: r.quadrant,
              confidence: r.confidence,
              hard_to_decide: r.hard_to_decide,
              cut_intent: r.cut_intent ?? null,
              first_tap_ms: r.first_tap_ms,
              card_time_ms: r.card_time_ms,
              deliberation_ms: r.deliberation_ms,
            })),
          }),
        })
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(`save failed: ${res.status}`)
        trackEvent('value_map_v2_completed', {
          classified: body?.classified ?? 0,
          rescore_updated: body?.rescore?.updated ?? 0,
        })
        // Terminal stamp — resume never bounces back here.
        await advanceStep('complete').catch((err) => {
          console.error('[value-map-v2] advanceStep failed', err)
        })
        setPayback((body?.payback as PaybackSummary | null) ?? null)
        const revealPayload = (body?.reveal as RevealPayload | null) ?? null
        setReveal(revealPayload)
        setStep(revealPayload ? 'reveal' : 'payback')
      } catch (err) {
        console.error('[value-map-v2] save failed', err)
        // Don't strand the user: stamp terminal and show the no-numbers
        // payback fallback.
        await advanceStep('complete').catch(() => undefined)
        setPayback(null)
        setStep('payback')
      }
    },
    [trackEvent],
  )

  const handleContinue = useCallback(() => {
    router.push('/office/goals')
  }, [router])

  if (step === 'intro') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6 text-center">
        <CFOAvatar size={48} />
        <div className="space-y-3 max-w-sm">
          <h1 className="text-[28px] leading-[1.15] text-text-primary">{VM3_INTRO_HEADING}</h1>
          <p className="text-sm text-text-secondary leading-relaxed">{VM3_INTRO_BODY}</p>
          <p className="text-xs text-text-secondary">
            {cards.length} transactions, one tap each.
          </p>
        </div>
        <Button
          onClick={handleStart}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-8 py-5 text-base min-h-11"
        >
          {VM3_INTRO_CTA}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
        <SkipLink onSkip={handleSkip} />
      </div>
    )
  }

  if (step === 'exercise') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          <ValueMapCard
            transactions={cards}
            currency={currency}
            askCutIntent
            onComplete={handleComplete}
          />
        </div>
        <div className="flex justify-center pb-6 pt-2">
          <SkipLink onSkip={handleSkip} />
        </div>
      </div>
    )
  }

  if (step === 'saving') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <CfoThinking variant="block" labels={[...VM3_SAVING_LABELS]} />
      </div>
    )
  }

  if (step === 'reveal' && reveal) {
    return <ArchetypeReveal reveal={reveal} onContinue={() => setStep('payback')} />
  }

  // step === 'payback'
  return (
    <PaybackScreen
      payback={payback}
      currency={currency}
      family={reveal?.family ?? null}
      onContinue={handleContinue}
    />
  )
}

function SkipLink({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      onClick={onSkip}
      className="text-sm text-text-secondary underline min-h-[44px] px-4"
    >
      {VM3_SKIP_LABEL}
    </button>
  )
}
