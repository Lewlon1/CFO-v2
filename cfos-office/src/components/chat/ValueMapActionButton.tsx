'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { advanceStep } from '@/app/onboarding-v2/actions-step'

type Props = {
  /**
   * 'sample' (default) — the pre-Read invite. Stamps `value_map_started` and
   * runs the Value Map on sample transactions.
   * 'real' — the post-Read hook close (`[CTA:start_value_map_real]`). Runs the
   * Value Map on the user's real flagged transactions (`?hook=1`); the
   * value-map page stamps `value_map_offered` server-side on entry.
   */
  variant?: 'sample' | 'real'
}

/**
 * Inline action button rendered under an assistant message. The 'sample'
 * variant fires when `actions_created` metadata includes
 * `{ type: 'start_value_map' }`; the 'real' variant fires when the message
 * carries a `[CTA:start_value_map_real]` token (the value-first first Read's
 * hook close, now delivered inline in chat rather than on a dedicated page).
 */
export function ValueMapActionButton({ variant = 'sample' }: Props) {
  const router = useRouter()
  const trackEvent = useTrackEvent()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    if (pending) return
    startTransition(async () => {
      try {
        if (variant === 'real') {
          trackEvent('onboarding_v2.first_read_value_map_optin', { value_first: true })
          router.push('/onboarding-v2/value-map?hook=1')
          return
        }
        trackEvent('onboarding_v2.value_map_accepted')
        await advanceStep('value_map_started')
        router.push('/onboarding-v2/value-map')
      } catch (err) {
        console.error('[ValueMapActionButton] navigation failed', err)
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="w-full mt-3 px-4 py-3 rounded-xl min-h-11 bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {pending
          ? 'Just a moment…'
          : variant === 'real'
            ? 'Value-map these so I learn what your spending really means →'
            : 'Start the Value Map →'}
      </button>
      {variant === 'real' && (
        <p className="mt-2 text-center text-caption text-text-secondary">
          Something no other budgeting app can do.
        </p>
      )}
    </>
  )
}
