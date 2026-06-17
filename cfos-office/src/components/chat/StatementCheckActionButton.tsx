'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { advanceStep } from '@/app/onboarding-v2/actions-step'

/**
 * Inline action button under the estimate Read (OB-2). Fires when the message
 * carries a `[CTA:start_statement_check]` token — the estimate Read's close. It
 * hands the (already-onboarded) user into the optional statement-check mission
 * that verifies their estimates against a real month.
 *
 * The user is already complete at this point (the estimate Read stamped
 * onboarding_completed_at), so this is pure upgrade. Advancing to
 * `check_upload_pending` + refresh re-renders the office layout, which surfaces
 * the in-sheet upload beat for the mission (hosted by the legacy beat host).
 */
export function StatementCheckActionButton() {
  const router = useRouter()
  const trackEvent = useTrackEvent()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    if (pending) return
    startTransition(async () => {
      try {
        trackEvent('onboarding_v2.estimate_read_statement_check_optin')
        await advanceStep('check_upload_pending')
        router.refresh()
      } catch (err) {
        console.error('[StatementCheckActionButton] advance failed', err)
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
        {pending ? 'Just a moment…' : 'Check my numbers against a real month →'}
      </button>
      <p className="mt-2 text-center text-caption text-text-secondary">
        One month of statements turns the sketch into the real picture.
      </p>
    </>
  )
}
