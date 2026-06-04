'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { CfoThinking } from '@/components/brand/CfoThinking'

type Props = {
  entryStruggle: string | null
  /** When true (value-first onboarding), stamp `first_read_delivered` as the
   *  terminal step. Default false keeps the baseline `first_read_shown`
   *  behaviour. Both stamp onboarding_completed_at via markComplete. */
  valueFirst?: boolean
}

/**
 * Compose-and-redirect bounce. The first Read is composed by
 * /api/insights/post-upload and pre-written as an assistant message into a
 * `first_read` conversation. Rather than re-render that message as a separate
 * article page (the old behaviour), we stamp the terminal step and hand the
 * user straight into the chat sheet, which loads the conversation and shows
 * the Read inline — chat-first, one window. The value-first hook close
 * ([CTA:start_value_map_real]) renders as an inline Value Map invite in
 * MessageList, replacing the old page's bespoke chip.
 *
 * This screen is therefore a brief "thinking" state, not a destination.
 */
export function FirstReadOrchestrator({ entryStruggle, valueFirst = false }: Props) {
  const router = useRouter()
  const trackEvent = useTrackEvent()
  const [error, setError] = useState<string | null>(null)
  const requestedRef = useRef(false)

  useEffect(() => {
    if (requestedRef.current) return
    requestedRef.current = true

    let cancelled = false
    void (async () => {
      try {
        const postRes = await fetch('/api/insights/post-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        if (!postRes.ok) throw new Error(`post-upload returned ${postRes.status}`)
        const postData = await postRes.json()
        const conversationId = postData?.conversationId as string | null
        if (!conversationId) throw new Error('post-upload returned no conversationId')
        if (cancelled) return

        // Terminal stamp — markComplete fires inside advanceStep for these
        // states, so onboarding_completed_at lands before we leave the flow.
        await advanceStep(valueFirst ? 'first_read_delivered' : 'first_read_shown')
        trackEvent('onboarding_v2.first_read_delivered', {
          entry_struggle: entryStruggle ?? null,
          value_first: valueFirst,
        })
        if (cancelled) return

        router.replace(`/office?chat=open&conversationId=${conversationId}`)
      } catch (err) {
        console.error('[onboarding-v2.first-read] compose/redirect failed', err)
        if (!cancelled) setError('Something went wrong preparing your first read.')
      }
    })()

    return () => {
      cancelled = true
      requestedRef.current = false
    }
  }, [router, valueFirst, entryStruggle, trackEvent])

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center bg-background px-4">
      {error ? (
        <div className="text-center max-w-[430px] w-full">
          <p className="text-sm text-destructive mb-4">{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null)
              requestedRef.current = false
              router.refresh()
            }}
            className="min-h-12 px-6 rounded-xl bg-foreground text-background text-sm font-medium"
          >
            Try again
          </button>
        </div>
      ) : (
        <CfoThinking variant="block" />
      )}
    </main>
  )
}
