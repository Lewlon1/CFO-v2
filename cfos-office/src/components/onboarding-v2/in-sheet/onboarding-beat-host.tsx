'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OnboardingStep, OnboardingGoalSummary } from '@/lib/onboarding-v2/types'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import { useChatContext } from '@/components/chat/ChatProvider'
import { CfoThinking } from '@/components/brand/CfoThinking'
import { UploadBeatBlock } from './upload-beat-block'
import { EssentialsBeatBlock } from './essentials-beat-block'
import { ConfirmBeatBlock } from './confirm-beat-block'

type Props = {
  step: OnboardingStep | null
  currency: string
  goal: OnboardingGoalSummary | null
  /** True on the skip-upload path (no imported transactions). Consumed by the
   *  essentials beat to skip the parse-wait. */
  noImport?: boolean
}

/**
 * Deterministic onboarding beat host. Renders the active beat purely from
 * onboarding_step — no LLM tool calls. Each beat's server action advances the
 * step; we then router.refresh() so the force-dynamic office layout re-renders
 * with the next step and this host shows the next beat. The terminal Read hand
 * off reuses the proven ?chat=open&conversationId mechanism (ChatOpenerTrigger)
 * so the composed Read loads into the same sheet.
 */
export function OnboardingBeatHost({ step, currency, goal, noImport }: Props) {
  const router = useRouter()
  const { openSheet, loadConversation } = useChatContext()
  const readTriggeredRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  // Terminal beat: details confirmed → compose the Read and hand it into the
  // sheet. Idempotent (post-upload reuses an existing layered conversation),
  // so a refresh at this step re-enters safely.
  useEffect(() => {
    if (step !== 'details_confirmed' || readTriggeredRef.current) return
    readTriggeredRef.current = true

    let cancelled = false
    void (async () => {
      // Bound the compose so a hung request surfaces the retry UI instead of
      // stranding the user on the rotating loader forever. post-upload is
      // idempotent (it reuses an existing layered conversation), so retrying
      // is safe. 90s is generous for the LLM compose without being infinite.
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 90_000)
      try {
        const res = await fetch('/api/insights/post-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`post-upload returned ${res.status}`)
        const data = await res.json()
        const conversationId = data?.conversationId as string | null
        if (!conversationId) throw new Error('post-upload returned no conversationId')
        if (cancelled) return

        await advanceStep('first_read_delivered')
        if (cancelled) return
        // Hand the composed Read into the sheet WITHOUT a URL navigation.
        //
        // The old approach — router.replace('?chat=open&conversationId=…') then
        // router.refresh() — raced THREE navigations in one tick: this replace,
        // the refresh, and ChatOpenerTrigger's param-strip replace('/office').
        // The refresh got coalesced away, so the force-dynamic (office) layout
        // never re-rendered on the client; onboardingStep stayed
        // 'details_confirmed', onboardingBeatActive stayed true, and this host's
        // loader showed forever over a Read that was already composed + waiting.
        //
        // Instead: load the conversation straight into ChatProvider state (which
        // lives above this host, so it survives the host's unmount) and fire a
        // LONE router.refresh() — no competing navigation. The refresh re-runs
        // the layout so onboardingStep flips to 'first_read_delivered', this
        // host unmounts, and ChatSheet's message branch shows the loaded Read. A
        // bare refresh is the same mechanism the upload/essentials/confirm beats
        // above already use reliably.
        openSheet()
        loadConversation(conversationId)
        router.refresh()
      } catch (err) {
        console.error('[onboarding-beat-host] read trigger failed', err)
        if (!cancelled) {
          setError('Something went wrong preparing your first read.')
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

  if (step === 'upload_pending' || step === 'essentials_done') {
    return (
      <UploadBeatBlock
        goal={goal}
        onImported={() => {}}
        onDone={() => {
          void advanceStep('upload_processing')
            .then(() => router.refresh())
            .catch((err) => console.error('[onboarding-beat-host] upload advance failed', err))
        }}
      />
    )
  }

  if (step === 'upload_processing') {
    return (
      <EssentialsBeatBlock
        currency={currency}
        initialIncome={null}
        initialRent={null}
        noImport={noImport}
        // ProcessingForm runs advanceToConfirm itself (→ details_pending); we
        // just refresh so the host advances to the confirm beat.
        onAdvance={() => router.refresh()}
      />
    )
  }

  if (step === 'details_pending') {
    // confirmFixedCosts advances to details_confirmed; refresh lets the
    // details_confirmed branch above trigger the Read.
    return <ConfirmBeatBlock onConfirmed={() => router.refresh()} />
  }

  // details_confirmed — Read composing/handoff in flight.
  return <CfoThinking variant="block" />
}
