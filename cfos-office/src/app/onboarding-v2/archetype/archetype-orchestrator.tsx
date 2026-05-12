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
 * <ArchetypeBeat> presentation, with a "Show me the gap" CTA that
 * advances onboarding_step to 'complete' and lands the user in /office.
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
        // Land on the Gap page so "Show me the gap" actually does — the page
        // server-fetches analyseGap() and renders the result. The user can
        // navigate to /office from there via the existing nav.
        router.push('/office/values/the-gap')
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
          className={
            'w-full mt-6 transition-opacity min-h-12 rounded-xl font-sans text-[15px] font-medium ' +
            (loading || pending
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-foreground text-background cursor-pointer')
          }
        >
          {pending ? 'Just a moment…' : 'Show me the gap →'}
        </button>
      </div>
    </main>
  )
}
