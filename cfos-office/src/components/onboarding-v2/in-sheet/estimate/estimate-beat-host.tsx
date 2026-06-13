'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import type { EstimateOnboardingContext } from '@/lib/onboarding-v2/estimate-context'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import { useChatContext } from '@/components/chat/ChatProvider'
import { CfoThinking } from '@/components/brand/CfoThinking'
import { DoorBeatBlock } from './door-beat-block'
import { ContextBeatBlock } from './context-beat-block'
import { CompositeBeatBlock } from './composite-beat-block'
import { GoalBeatBlock } from './goal-beat-block'
import { IncomeBeatBlock } from './income-beat-block'
import { SketchBeatBlock } from './sketch-beat-block'
import { VerdictsBeatBlock } from './verdicts-beat-block'

type Props = {
  step: OnboardingStep
  context: EstimateOnboardingContext
}

/**
 * Estimates-first beat host. Renders the active beat purely from the step — no
 * LLM tool calls. The terminal estimate_read_pending composes the estimate Read
 * and hands it into the sheet via the same proven mechanism the value-first
 * onboarding host uses (load into ChatProvider state + a LONE router.refresh,
 * no competing URL navigation — see onboarding-beat-host.tsx for the 3-nav race
 * this avoids).
 */
export function EstimateBeatHost({ step, context }: Props) {
  const router = useRouter()
  const { openSheet, loadConversation } = useChatContext()
  const readTriggeredRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (step !== 'estimate_read_pending' || readTriggeredRef.current) return
    readTriggeredRef.current = true

    let cancelled = false
    void (async () => {
      // The estimate-read route is idempotent (it reuses an existing estimate
      // conversation), so a 90s ceiling + retry is safe.
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 90_000)
      try {
        const res = await fetch('/api/insights/estimate-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`estimate-read returned ${res.status}`)
        const data = await res.json()
        const conversationId = data?.conversationId as string | null
        if (!conversationId) throw new Error('estimate-read returned no conversationId')
        if (cancelled) return

        // first_read_delivered is the REUSED completion terminal — advanceStep
        // stamps onboarding_completed_at via markOnboardingCompleteIfReady.
        await advanceStep('first_read_delivered')
        if (cancelled) return

        openSheet()
        loadConversation(conversationId)
        router.refresh()
      } catch (err) {
        console.error('[estimate-beat-host] read trigger failed', err)
        if (!cancelled) {
          setError('Something went wrong preparing your read.')
          readTriggeredRef.current = false
        }
      } finally {
        clearTimeout(timeout)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [step, router, openSheet, loadConversation])

  if (error) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-sm text-destructive mb-4">{error}</p>
        <button
          type="button"
          onClick={() => {
            setError(null)
            router.refresh()
          }}
          className="min-h-11 px-5 rounded-control bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 text-sm font-medium transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }

  switch (step) {
    case 'estimate_door':
      return <DoorBeatBlock context={context} />
    case 'estimate_context':
      return <ContextBeatBlock context={context} />
    case 'estimate_composite':
      return <CompositeBeatBlock context={context} />
    case 'estimate_goal':
      return <GoalBeatBlock context={context} />
    case 'estimate_income':
      return <IncomeBeatBlock context={context} />
    case 'estimate_sketch':
      return <SketchBeatBlock context={context} />
    case 'estimate_verdicts':
      return <VerdictsBeatBlock context={context} />
    case 'estimate_read_pending':
    default:
      // Read composing / handoff in flight.
      return <CfoThinking variant="block" />
  }
}
