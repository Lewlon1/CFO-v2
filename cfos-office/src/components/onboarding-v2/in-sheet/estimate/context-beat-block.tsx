'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveContextAndAdvance } from '@/app/onboarding-v2/estimate-actions'
import type { CompositeCountry } from '@/lib/onboarding-v2/composite/composite-config'
import type { EstimateOnboardingContext } from '@/lib/onboarding-v2/estimate-context'
import {
  BeatShell,
  BeatHeader,
  BeatHeading,
  BeatHint,
  ChipButton,
  BeatPrimaryButton,
  BeatError,
  DeleteEverythingFooter,
} from './beat-chrome'

const COUNTRIES: { id: CompositeCountry; label: string }[] = [
  { id: 'GB', label: 'United Kingdom' },
  { id: 'ES', label: 'Spain' },
]

const AGE_BANDS = ['18–29', '30–39', '40–49', '50 or over'] as const

/** Context beat — country + age band. Sets the currency and the composite
 *  persona skin; otherwise "changes nothing except the introduction". */
export function ContextBeatBlock({ context }: { context: EstimateOnboardingContext }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [country, setCountry] = useState<CompositeCountry | null>(context.country ?? null)
  const [ageRange, setAgeRange] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canContinue = country != null && ageRange != null && !pending

  function handleContinue() {
    if (!canContinue || country == null || ageRange == null) return
    setError(null)
    startTransition(async () => {
      try {
        await saveContextAndAdvance({ country, ageRange })
        router.refresh()
      } catch (err) {
        console.error('[context-beat] save failed', err)
        setError('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <BeatShell>
      <BeatHeader subtitle="This changes nothing except the introduction — so the example I show you fits." />
      <BeatHeading>A couple of quick basics</BeatHeading>
      <BeatHint>Where are you, and roughly what life stage?</BeatHint>

      <p className="mb-2 text-xs font-medium text-text-muted">Country</p>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {COUNTRIES.map((c) => (
          <ChipButton
            key={c.id}
            testId={`context-country-${c.id}`}
            selected={country === c.id}
            onClick={() => setCountry(c.id)}
          >
            {c.label}
          </ChipButton>
        ))}
      </div>

      <p className="mb-2 text-xs font-medium text-text-muted">Age</p>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {AGE_BANDS.map((band) => (
          <ChipButton
            key={band}
            testId={`context-age-${band}`}
            selected={ageRange === band}
            onClick={() => setAgeRange(band)}
          >
            {band}
          </ChipButton>
        ))}
      </div>

      <BeatError message={error} />

      <BeatPrimaryButton
        onClick={handleContinue}
        disabled={!canContinue}
        pending={pending}
        testId="context-continue"
      >
        Continue
      </BeatPrimaryButton>

      <DeleteEverythingFooter />
    </BeatShell>
  )
}
