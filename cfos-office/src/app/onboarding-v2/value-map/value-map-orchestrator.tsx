'use client'

import { useRouter } from 'next/navigation'
import { ValueMapFlow } from '@/components/value-map/value-map-flow'
import { advanceStep } from '@/app/onboarding-v2/actions-step'

/**
 * Wraps <ValueMapFlow> for the Marcus journey + chat-route bridge accept.
 *
 * Skip is hidden by construction: the existing <ValueMapBeat> wrapper
 * rendered a separate "Skip for now" button as a sibling element. Importing
 * <ValueMapFlow> directly omits the skip control without touching the
 * shared component (no extraction, no flag).
 */
export function ValueMapOrchestrator({ currency }: { currency: string }) {
  const router = useRouter()

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <div className="flex-1 flex flex-col max-w-[430px] mx-auto w-full">
        <ValueMapFlow
          currency={currency}
          mode="onboarding"
          onComplete={async () => {
            await advanceStep('value_map_done')
            router.push('/onboarding-v2/upload')
          }}
        />
      </div>
    </div>
  )
}
