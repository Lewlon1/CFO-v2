'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { advanceStep } from '@/app/onboarding-v2/actions-step'

/**
 * Inline action button rendered under an assistant message whose
 * `actions_created` metadata includes `{ type: 'start_value_map' }`.
 *
 * On click: stamps `onboarding_step = 'intro_shown'` so the chat-route user
 * passes through the same Marcus intro page (with their route-specific
 * headline), then navigates to /onboarding-v2/intro.
 */
export function ValueMapActionButton() {
  const router = useRouter()
  const trackEvent = useTrackEvent()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    if (pending) return
    startTransition(async () => {
      try {
        trackEvent('onboarding_v2.value_map_accepted')
        await advanceStep('intro_shown')
        router.push('/onboarding-v2/intro')
      } catch (err) {
        console.error('[ValueMapActionButton] navigation failed', err)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="w-full mt-3 px-4 py-3 rounded-xl min-h-[44px] bg-[#E8A84C] text-black text-sm font-semibold hover:bg-[#dc9a3c] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
    >
      {pending ? 'Just a moment…' : 'Start the Value Map →'}
    </button>
  )
}
