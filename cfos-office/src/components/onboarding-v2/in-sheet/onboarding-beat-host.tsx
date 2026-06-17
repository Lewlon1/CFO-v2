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
import { CheckProcessingBeatBlock } from './check-processing-beat-block'

type Props = {
  step: OnboardingStep | null
  currency: string
  goal: OnboardingGoalSummary | null
}

/**
 * Deterministic onboarding beat host. Renders the active beat purely from
 * onboarding_step — no LLM tool calls. Each beat's server action advances the
 * step; we then router.refresh() so the force-dynamic office layout re-renders
 * with the next step and this host shows the next beat. The terminal Read hand
 * off reuses the proven ?chat=open&conversationId mechanism (ChatOpenerTrigger)
 * so the composed Read loads into the same sheet.
 */
export function OnboardingBeatHost({ step, currency, goal }: Props) {
  const router = useRouter()
  const { openSheet, loadConversation } = useChatContext()
  const readTriggeredRef = useRef(false)
  const realityCheckTriggeredRef = useRef(false)
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

  // OB-3 statement-check terminal: the confirm beat committed the real fixed
  // costs and advanced to check_confirm_done (NOT details_confirmed). Compose the
  // reality-check Read and hand it into the sheet. Mirrors the details_confirmed
  // effect above exactly: POST → advanceStep → load into ChatProvider + a LONE
  // router.refresh (no competing navigation). reality_check_delivered just records
  // the mission outcome — the user is ALREADY onboarded, it is not a gate. Because
  // it runs on a step (not a callback), a refresh mid-compose re-fires it; the
  // route is idempotent, and the confirm beat is already behind us.
  useEffect(() => {
    if (step !== 'check_confirm_done' || realityCheckTriggeredRef.current) return
    realityCheckTriggeredRef.current = true

    let cancelled = false
    void (async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 90_000)
      try {
        const res = await fetch('/api/insights/reality-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`reality-check returned ${res.status}`)
        const data = await res.json()
        const conversationId = data?.conversationId as string | null
        if (!conversationId) throw new Error('reality-check returned no conversationId')
        if (cancelled) return

        await advanceStep('reality_check_delivered')
        if (cancelled) return
        openSheet()
        loadConversation(conversationId)
        router.refresh()
      } catch (err) {
        console.error('[onboarding-beat-host] reality-check trigger failed', err)
        if (!cancelled) {
          setError('Something went wrong checking your numbers.')
          realityCheckTriggeredRef.current = false
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
            // Both terminal effects (details_confirmed, check_confirm_done) reset
            // their trigger ref on failure, so a lone refresh re-fires the right
            // one — the underlying routes are idempotent.
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

  // OB-3 statement-check mission (the user is ALREADY onboarded — the estimate
  // Read stamped completion; this is the optional accuracy pass).
  if (step === 'check_upload_pending') {
    return (
      <UploadBeatBlock
        goal={goal}
        mode="check"
        onImported={() => {}}
        onDone={() => {
          void advanceStep('check_processing')
            .then(() => router.refresh())
            .catch((err) =>
              console.error('[onboarding-beat-host] check upload advance failed', err),
            )
        }}
      />
    )
  }

  if (step === 'check_processing') {
    return (
      <CheckProcessingBeatBlock
        onDone={() => {
          void advanceStep('check_confirm_pending')
            .then(() => router.refresh())
            .catch((err) =>
              console.error('[onboarding-beat-host] check processing advance failed', err),
            )
        }}
      />
    )
  }

  if (step === 'check_confirm_pending') {
    // confirmFixedCosts in 'check' mode reconciles and advances to
    // check_confirm_done; the refresh lets the effect above fire the
    // reality-check Read.
    return <ConfirmBeatBlock mode="check" onConfirmed={() => router.refresh()} />
  }

  // details_confirmed or check_confirm_done — a Read is composing/handing off.
  return <CfoThinking variant="block" />
}
