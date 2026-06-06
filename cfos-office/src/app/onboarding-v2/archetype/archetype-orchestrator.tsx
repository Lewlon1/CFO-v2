'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArchetypeBeat } from '@/components/onboarding/beats/ArchetypeBeat'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import { useTrackEvent } from '@/lib/events/use-track-event'
import type { OnboardingData } from '@/lib/onboarding/types'
import type { ArchetypeResult } from '@/lib/onboarding/archetype-prompt'

type Props = {
  onboardingData: OnboardingData
  entryStruggle: string | null
}

/**
 * Marcus archetype reveal. Mirrors the modal's archetype-generation
 * fetch (POST /api/onboarding/generate-archetype) and renders the same
 * <ArchetypeBeat> presentation, with a CTA that advances onboarding_step
 * to 'complete', creates (or reuses) a first_read conversation, and
 * lands the user in chat where the CFO opens with a goal-aware wow
 * moment grounded in their actual transaction data.
 */
export function ArchetypeOrchestrator({ onboardingData, entryStruggle }: Props) {
  const router = useRouter()
  const trackEvent = useTrackEvent()
  const [archetypeData, setArchetypeData] = useState<ArchetypeResult | undefined>(
    undefined,
  )
  const [loading, setLoading] = useState(true)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const requestedRef = useRef(false)
  const stampedShownRef = useRef(false)

  useEffect(() => {
    if (requestedRef.current) return
    if (!onboardingData.personalityType) {
      // No Value Map session available — fall through to the fallback view in
      // <ArchetypeBeat> by leaving archetypeData undefined and dropping loading.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time guarded mount init: drop loading when there is no Value Map session to fetch
      setLoading(false)
      return
    }
    requestedRef.current = true

    fetch('/api/onboarding/generate-archetype', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        responses: onboardingData.valueMapResults ?? [],
        personalityType: onboardingData.personalityType,
        userName: onboardingData.name ?? 'there',
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.archetype) {
          setArchetypeData(data.archetype as ArchetypeResult)
        }
      })
      .catch((err) => {
        console.error('[onboarding-v2.archetype] fetch failed', err)
      })
      .finally(() => {
        setLoading(false)
        if (!stampedShownRef.current) {
          stampedShownRef.current = true
          // Stamp archetype_shown the moment we render the reveal — even if
          // archetype generation fell back. Resume logic still routes here
          // until 'complete' is set.
          void advanceStep('archetype_shown').catch((err) => {
            console.error('[onboarding-v2.archetype] advanceStep failed', err)
          })
        }
      })
  }, [onboardingData])

  function handleContinue() {
    if (pending) return
    setError(null)
    startTransition(async () => {
      try {
        trackEvent('onboarding_v2.marcus_journey_complete', {
          entry_struggle: entryStruggle ?? null,
        })
        await advanceStep('complete')

        // Materialise (or reuse) a first_read conversation and land the
        // user in chat where the CFO opens with a goal-aware wow moment.
        // The endpoint is idempotent — safe to call even if a prior step
        // already created one.
        let conversationId: string | null = null
        try {
          const res = await fetch('/api/insights/post-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
          if (res.ok) {
            const data = await res.json()
            conversationId = data?.conversationId ?? null
          } else {
            console.error('[onboarding-v2.archetype] post-upload returned', res.status)
          }
        } catch (insightErr) {
          // Network/server failure shouldn't strand the user — fall through
          // to a chat-without-conversation landing.
          console.error('[onboarding-v2.archetype] post-upload failed', insightErr)
        }

        const destination = conversationId
          ? `/office?chat=open&conversationId=${conversationId}`
          : '/office?chat=open'
        router.push(destination)
      } catch (err) {
        console.error('[onboarding-v2.archetype] complete failed', err)
        setError('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <main className="min-h-dvh flex flex-col bg-background">
      <div className="flex-1 flex flex-col max-w-[430px] mx-auto w-full px-4 py-6">
        <p className="eyebrow mb-6 text-center">THE CFO&apos;S OFFICE</p>

        <div className="flex-1">
          <ArchetypeBeat
            data={onboardingData}
            archetypeData={archetypeData}
            loading={loading}
          />
        </div>

        {error && (
          <p
            className="text-center mt-6 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleContinue}
          disabled={loading || pending}
          className="w-full mt-6 transition-colors min-h-12 rounded-xl font-sans text-h3 font-medium bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pending ? 'Just a moment…' : 'See what I found →'}
        </button>
      </div>
    </main>
  )
}
