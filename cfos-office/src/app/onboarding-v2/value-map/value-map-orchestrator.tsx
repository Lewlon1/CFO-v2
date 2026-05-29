'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ValueMapFlow } from '@/components/value-map/value-map-flow'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import type { ValueMapTransaction } from '@/lib/value-map/types'

/**
 * Wraps <ValueMapFlow> for three entry paths:
 *
 *   1. Legacy / Marcus onboarding gate — `postReadOptIn=false`. Completion
 *      stamps step='value_map_done' and routes to /onboarding-v2/upload.
 *   2. Post-read opt-in deepening move — `postReadOptIn=true`, `valueFirst=false`.
 *      The user has already reached the first-read terminal state (or
 *      completed onboarding). Completion does NOT regress the step, and
 *      routes back to /office.
 *   3. Value-first hook resolution — `valueFirst=true`. Real flagged
 *      transactions are passed in; completion triggers a follow-up Read
 *      composition (Layer 2 now present) and stamps step='complete'.
 *
 * Skip is hidden by construction: the shared <ValueMapBeat> wrapper rendered
 * a separate skip button as a sibling. Importing <ValueMapFlow> directly
 * omits the skip control without touching the shared component.
 *
 * In-flight gating: the value-first branch's recompose is a 15–45s Bedrock
 * call. The card's terminal feedback overlay leaves "Tap to continue" live
 * during that wait, so without a guard a re-tap fires onComplete a second
 * time — observed as duplicate value_map_sessions + duplicate recomposed
 * messages on staging. The orchestrator now flips a loading screen on the
 * first onComplete and refuses re-entry via a ref so the user can't
 * double-trigger the recompose regardless of which orchestrator branch they
 * fall through.
 */
export function ValueMapOrchestrator({
  currency,
  postReadOptIn = false,
  realTransactions,
  valueFirst = false,
}: {
  currency: string
  postReadOptIn?: boolean
  realTransactions?: ValueMapTransaction[]
  valueFirst?: boolean
}) {
  const router = useRouter()
  const [isCompleting, setIsCompleting] = useState(false)
  // Re-entry guard sits in a ref rather than state so a second onComplete fire
  // racing inside the same render cycle still sees the latched value before
  // React batches the setIsCompleting update.
  const inFlight = useRef(false)

  const handleComplete = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setIsCompleting(true)

    try {
      if (valueFirst) {
        // Layer 2 just landed — recompose the Read in the same first_insight
        // conversation as a follow-up message and route the user back into
        // that thread. Stamp 'complete' so resume doesn't bounce them back
        // here.
        const res = await fetch('/api/insights/recompose-first-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        const data = await res.json().catch(() => null)
        await advanceStep('complete')
        const conversationId = data?.conversationId as string | null
        const dest = conversationId
          ? `/office?chat=open&conversationId=${conversationId}`
          : '/office?chat=open'
        router.push(dest)
        return
      }
      if (postReadOptIn) {
        router.push('/office')
        return
      }
      await advanceStep('value_map_done')
      router.push('/onboarding-v2/upload')
    } catch (err) {
      console.error('[value-map.onComplete] failed', err)
      // Last-ditch: still navigate so the user isn't stranded on the loading
      // panel. advanceStep may fail here too — swallow it; the user can
      // recover from /office.
      try {
        await advanceStep('complete')
      } catch {
        /* noop */
      }
      router.push('/office?chat=open')
    }
    // No `inFlight.current = false` — by this point we've pushed a route and
    // the orchestrator is on its way out.
  }, [valueFirst, postReadOptIn, router])

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <div className="flex-1 flex flex-col max-w-[430px] mx-auto w-full">
        {isCompleting ? (
          <CompletingPanel />
        ) : (
          <ValueMapFlow
            currency={currency}
            mode="onboarding"
            realTransactions={realTransactions}
            onComplete={handleComplete}
          />
        )}
      </div>
    </div>
  )
}

function CompletingPanel() {
  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="text-center space-y-3">
        <p className="text-foreground text-lg animate-pulse">
          Reading your answers…
        </p>
        <p className="text-muted-foreground text-sm">
          Folding what you said back into your CFO&apos;s read. A few seconds.
        </p>
      </div>
    </div>
  )
}
