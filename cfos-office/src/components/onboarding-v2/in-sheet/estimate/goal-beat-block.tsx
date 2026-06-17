'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createEstimateGoalAndAdvance } from '@/app/onboarding-v2/estimate-actions'
import {
  GOAL_CONFIG,
  DEADLINE_OPTIONS,
  ALT_GOALS,
  type DeadlineOption,
} from '@/lib/onboarding-v2/goal-config'
import type { DoorFamily } from '@/lib/onboarding-v2/door/door-config'
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

/** Goal beat — the family-inferred goal, a deadline, and an escape hatch to a
 *  different goal. The goal is a starting point, never a commitment made for
 *  the user. */
export function GoalBeatBlock({ context }: { context: EstimateOnboardingContext }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const family: DoorFamily = context.doorFamily ?? 'growth'
  const [deadlineId, setDeadlineId] = useState<DeadlineOption['id'] | null>(null)
  const [altFamily, setAltFamily] = useState<DoorFamily | null>(null)
  const [showAlts, setShowAlts] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const goalLabel = altFamily
    ? (ALT_GOALS.find((a) => a.family === altFamily)?.label ?? GOAL_CONFIG[family].inferredGoalLabel)
    : GOAL_CONFIG[family].inferredGoalLabel

  const canContinue = deadlineId != null && !pending

  function handleContinue() {
    if (!canContinue || deadlineId == null) return
    setError(null)
    startTransition(async () => {
      try {
        await createEstimateGoalAndAdvance({ deadlineId, altFamily })
        router.refresh()
      } catch (err) {
        console.error('[goal-beat] create failed', err)
        setError('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <BeatShell>
      <BeatHeader subtitle="Most people in your situation are working on something like this. Sound about right?" />
      <BeatHeading>{capitalise(goalLabel)}</BeatHeading>
      <BeatHint>Pick a timeframe — you can change the target later in Goals.</BeatHint>

      <div className="space-y-2.5 mb-4">
        {DEADLINE_OPTIONS.map((d) => (
          <ChipButton
            key={d.id}
            testId={`goal-deadline-${d.id}`}
            selected={deadlineId === d.id}
            onClick={() => setDeadlineId(d.id)}
          >
            {d.label}
          </ChipButton>
        ))}
      </div>

      {!showAlts ? (
        <button
          type="button"
          data-testid="goal-show-alts"
          onClick={() => setShowAlts(true)}
          className="mb-5 text-[13px] text-text-secondary underline underline-offset-2 hover:text-text-primary min-h-11"
        >
          Actually — a different goal
        </button>
      ) : (
        <div className="mb-5">
          <p className="mb-2 text-xs font-medium text-text-muted">What are you really working on?</p>
          <div className="space-y-2.5">
            {ALT_GOALS.map((alt) => (
              <ChipButton
                key={alt.family}
                testId={`goal-alt-${alt.family}`}
                selected={altFamily === alt.family}
                onClick={() => setAltFamily(alt.family)}
              >
                {alt.label}
              </ChipButton>
            ))}
          </div>
        </div>
      )}

      <BeatError message={error} />

      <BeatPrimaryButton
        onClick={handleContinue}
        disabled={!canContinue}
        pending={pending}
        testId="goal-continue"
      >
        {deadlineId ? "That's the goal" : 'Pick a timeframe'}
      </BeatPrimaryButton>

      <DeleteEverythingFooter />
    </BeatShell>
  )
}

function capitalise(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s
}
