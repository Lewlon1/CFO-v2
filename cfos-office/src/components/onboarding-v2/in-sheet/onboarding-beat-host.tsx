'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import { CfoThinking } from '@/components/brand/CfoThinking'
import { UploadBeatBlock } from './upload-beat-block'
import { EssentialsBeatBlock } from './essentials-beat-block'
import { ConfirmBeatBlock } from './confirm-beat-block'

type Props = {
  step: OnboardingStep | null
  currency: string
}

/**
 * Deterministic onboarding beat host. Renders the active beat purely from
 * onboarding_step — no LLM tool calls. Each beat's server action advances the
 * step; we then router.refresh() so the force-dynamic office layout re-renders
 * with the next step and this host shows the next beat. The terminal Read hand
 * off reuses the proven ?chat=open&conversationId mechanism (ChatOpenerTrigger)
 * so the composed Read loads into the same sheet.
 */
export function OnboardingBeatHost({ step, currency }: Props) {
  const router = useRouter()
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
        // The replace opens + loads the Read via ChatOpenerTrigger; the refresh
        // re-runs the (office) layout so onboardingBeatActive flips to false
        // (step is now first_read_delivered) and the sheet shows the loaded
        // conversation instead of this host's CfoThinking. A same-layout
        // navigation alone does NOT re-run the layout.
        router.replace(`/office?chat=open&conversationId=${conversationId}`)
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
  }, [step, router])

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
          className="min-h-11 px-5 rounded-control bg-text-primary text-bg-base text-sm font-medium"
        >
          Try again
        </button>
      </div>
    )
  }

  if (step === 'upload_pending' || step === 'essentials_done') {
    return (
      <UploadBeatBlock
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

  // details_confirmed — Read composing/handoff in flight.
  return <CfoThinking variant="block" />
}
