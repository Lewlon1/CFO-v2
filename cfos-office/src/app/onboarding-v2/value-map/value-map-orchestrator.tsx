'use client'

import { useRouter } from 'next/navigation'
import { ValueMapFlow } from '@/components/value-map/value-map-flow'
import { advanceStep } from '@/app/onboarding-v2/actions-step'

/**
 * Wraps <ValueMapFlow> for two entry paths:
 *
 *   1. Legacy / Marcus onboarding gate — `postReadOptIn=false`. Completion
 *      stamps step='value_map_done' and routes to /onboarding-v2/upload.
 *   2. Post-read opt-in deepening move — `postReadOptIn=true`. The user has
 *      already reached the first-read terminal state (or completed
 *      onboarding). Completion does NOT regress the step, and routes back
 *      to /office.
 *
 * Skip is hidden by construction: the shared <ValueMapBeat> wrapper rendered
 * a separate skip button as a sibling. Importing <ValueMapFlow> directly
 * omits the skip control without touching the shared component.
 */
export function ValueMapOrchestrator({
  currency,
  postReadOptIn = false,
}: {
  currency: string
  postReadOptIn?: boolean
}) {
  const router = useRouter()

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <div className="flex-1 flex flex-col max-w-[430px] mx-auto w-full">
        <ValueMapFlow
          currency={currency}
          mode="onboarding"
          onComplete={async () => {
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
