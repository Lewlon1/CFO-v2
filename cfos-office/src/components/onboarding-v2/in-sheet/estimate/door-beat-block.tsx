'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTrackEvent } from '@/lib/events/use-track-event'
import {
  submitDoorFreeText,
  submitDoorChip,
} from '@/app/onboarding-v2/estimate-actions'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import {
  DOOR_CONFIG,
  DOOR_FAMILIES,
  type DoorFamily,
} from '@/lib/onboarding-v2/door/door-config'
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

/**
 * Door beat — name + "what brought you in?". Free text is LLM-classified into an
 * internal family (never shown); a situation chip skips the LLM. Low confidence
 * degrades to the same chips ("closest fit?"). The classified/chip reflection is
 * shown once, then the user continues into the context beat.
 *
 * Family names, confidence, and any internal taxonomy are NEVER rendered.
 */
export function DoorBeatBlock({ context }: { context: EstimateOnboardingContext }) {
  const router = useRouter()
  const trackEvent = useTrackEvent()
  const [pending, startTransition] = useTransition()

  const [phase, setPhase] = useState<'input' | 'reflection'>(
    context.doorReflection ? 'reflection' : 'input',
  )
  const [reflection, setReflection] = useState(context.doorReflection ?? '')
  const [name, setName] = useState(context.displayName ?? '')
  const [freeText, setFreeText] = useState('')
  const [selectedChip, setSelectedChip] = useState<DoorFamily | null>(null)
  const [needsChip, setNeedsChip] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasInput = selectedChip !== null || freeText.trim().length > 0
  const canContinue = hasInput && !pending

  function handlePickChip(family: DoorFamily) {
    setSelectedChip(family)
    setFreeText('')
  }

  function handleFreeText(v: string) {
    setFreeText(v)
    if (v.trim().length > 0) setSelectedChip(null)
  }

  function commitChip(family: DoorFamily) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await submitDoorChip({ displayName: name || null, family })
        trackEvent('onboarding_v2.door_chip', { source: needsChip ? 'fallback' : 'direct' })
        setReflection(res.reflection)
        setPhase('reflection')
      } catch (err) {
        console.error('[door-beat] chip submit failed', err)
        setError('Something went wrong. Please try again.')
      }
    })
  }

  function handleContinue() {
    if (!canContinue) return
    if (selectedChip) {
      commitChip(selectedChip)
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const res = await submitDoorFreeText({
          displayName: name || null,
          freeText: freeText.trim(),
        })
        if (res.status === 'classified') {
          trackEvent('onboarding_v2.door_freetext', { outcome: 'classified' })
          setReflection(res.reflection)
          setPhase('reflection')
        } else {
          trackEvent('onboarding_v2.door_freetext', { outcome: 'needs_chip' })
          setNeedsChip(true)
        }
      } catch (err) {
        console.error('[door-beat] free-text submit failed', err)
        setError('Something went wrong. Please try again.')
      }
    })
  }

  function handleAdvance() {
    setError(null)
    startTransition(async () => {
      try {
        await advanceStep('estimate_context')
        router.refresh()
      } catch (err) {
        console.error('[door-beat] advance failed', err)
        setError('Something went wrong. Please try again.')
      }
    })
  }

  if (phase === 'reflection') {
    return (
      <BeatShell>
        <BeatHeader />
        <p className="mb-6 font-serif text-[20px] leading-snug text-text-primary">
          {reflection}
        </p>
        <BeatPrimaryButton onClick={handleAdvance} pending={pending} testId="door-reflection-continue">
          Keep going
        </BeatPrimaryButton>
        <DeleteEverythingFooter />
      </BeatShell>
    )
  }

  return (
    <BeatShell>
      <BeatHeader subtitle="Welcome to the office — pull up a chair. Nothing you say here leaves it." />

      <label className="block mb-1.5 text-xs font-medium text-text-muted" htmlFor="door-name">
        First, what should I call you?
      </label>
      <input
        id="door-name"
        data-testid="door-name-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        className="w-full px-4 py-3 mb-5 outline-none focus:ring-2 focus:ring-text-primary/30 rounded-control border border-[var(--border-subtle)] bg-bg-elevated text-text-primary text-[16px] placeholder:text-text-muted"
      />

      {needsChip ? (
        <>
          <BeatHeading>Which of these is closest?</BeatHeading>
          <BeatHint>Pick whichever lands nearest — we can refine later.</BeatHint>
        </>
      ) : (
        <>
          <BeatHeading>What brought you in?</BeatHeading>
          <BeatHint>Tell me in your own words, or pick whichever sounds closest.</BeatHint>
        </>
      )}

      {!needsChip && (
        <textarea
          data-testid="door-freetext"
          value={freeText}
          onChange={(e) => handleFreeText(e.target.value)}
          rows={2}
          placeholder="What's been on your mind about money?"
          className="w-full px-4 py-3 mb-4 outline-none focus:ring-2 focus:ring-text-primary/30 rounded-control border border-[var(--border-subtle)] bg-bg-elevated text-text-primary font-serif italic text-[16px] resize-none placeholder:text-text-muted"
        />
      )}

      <div className="space-y-2.5 mb-5">
        {DOOR_FAMILIES.map((family) => (
          <ChipButton
            key={family}
            testId={`door-chip-${family}`}
            selected={selectedChip === family}
            onClick={() => (needsChip ? commitChip(family) : handlePickChip(family))}
          >
            {DOOR_CONFIG[family].situation}
          </ChipButton>
        ))}
      </div>

      <BeatError message={error} />

      {!needsChip && (
        <BeatPrimaryButton
          onClick={handleContinue}
          disabled={!canContinue}
          pending={pending}
          testId="door-continue"
        >
          Continue
        </BeatPrimaryButton>
      )}

      <DeleteEverythingFooter />
    </BeatShell>
  )
}
