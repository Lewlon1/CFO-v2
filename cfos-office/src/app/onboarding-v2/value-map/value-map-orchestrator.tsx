'use client'

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

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <div className="flex-1 flex flex-col max-w-[430px] mx-auto w-full">
        <ValueMapFlow
          currency={currency}
          mode="onboarding"
          realTransactions={realTransactions}
          onComplete={async () => {
            if (valueFirst) {
              // Layer 2 just landed — recompose the Read in the same
              // first_insight conversation as a follow-up message and
              // route the user back into that thread. Stamp 'complete'
              // so resume doesn't bounce them back here.
              try {
                const res = await fetch('/api/insights/recompose-first-read', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                })
                const data = await res.json().catch(() => null)
                await advanceStep('complete')
                const conversationId = data?.conversationId as
                  | string
                  | null
                const dest = conversationId
                  ? `/office?chat=open&conversationId=${conversationId}`
                  : '/office?chat=open'
                router.push(dest)
              } catch (err) {
                console.error('[value-map.onComplete] recompose failed', err)
                await advanceStep('complete')
                router.push('/office?chat=open')
              }
              return
            }
            if (postReadOptIn) {
              router.push('/office')
              return
            }
            await advanceStep('value_map_done')
            router.push('/onboarding-v2/upload')
          }}
        />
      </div>
    </div>
  )
}
