'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveCompositeAndAdvance } from '@/app/onboarding-v2/estimate-actions'
import {
  COMPOSITE_PERSONAS,
  COMPOSITE_CARD_HEADING,
  compositeCardLabel,
  RELATE_OPTIONS,
  COMPOSITE_TRUER_PROMPT,
  COMPOSITE_TRUER_PLACEHOLDER,
  type RelateOptionId,
} from '@/lib/onboarding-v2/composite/composite-config'
import { DOOR_CONFIG, DOOR_FAMILIES, type DoorFamily } from '@/lib/onboarding-v2/door/door-config'
import type { EstimateOnboardingContext } from '@/lib/onboarding-v2/estimate-context'
import {
  BeatShell,
  BeatHeader,
  ChipButton,
  BeatPrimaryButton,
  BeatError,
  DeleteEverythingFooter,
} from './beat-chrome'

/**
 * Composite beat — an honestly-labelled illustrative composite ("a sketch, not
 * a client"). The user says how close it lands; "not really me" offers ONE
 * re-pick across the other situations; "close enough" / "not me" can add a line
 * on what would be truer.
 */
export function CompositeBeatBlock({ context }: { context: EstimateOnboardingContext }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const family: DoorFamily = context.doorFamily ?? 'growth'
  const [shownFamily, setShownFamily] = useState<DoorFamily>(family)
  const [relate, setRelate] = useState<RelateOptionId | null>(null)
  const [repickFamily, setRepickFamily] = useState<DoorFamily | null>(null)
  const [truerLine, setTruerLine] = useState('')
  const [error, setError] = useState<string | null>(null)

  const persona = COMPOSITE_PERSONAS[shownFamily][context.country]
  const showTruer = relate === 'close' || relate === 'not_me'
  const showRepick = relate === 'not_me'
  const repickComplete = relate !== 'not_me' || repickFamily != null
  const canContinue = relate != null && repickComplete && !pending

  function handleRelate(id: RelateOptionId) {
    setRelate(id)
    if (id !== 'not_me') {
      setRepickFamily(null)
      setShownFamily(family)
    }
  }

  function handleRepick(next: DoorFamily) {
    setRepickFamily(next)
    setShownFamily(next)
  }

  function handleContinue() {
    if (!canContinue || relate == null) return
    setError(null)
    startTransition(async () => {
      try {
        await saveCompositeAndAdvance({
          relate,
          personaFamily: shownFamily,
          repickFamily,
          truerLine: truerLine.trim() || null,
        })
        router.refresh()
      } catch (err) {
        console.error('[composite-beat] save failed', err)
        setError('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <BeatShell>
      <BeatHeader />
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-office-gold">
        {COMPOSITE_CARD_HEADING}
      </p>

      <div className="mb-4 p-4 rounded-card border border-border-medium bg-bg-elevated">
        <p className="font-serif text-[19px] text-text-primary leading-tight">
          {persona.name}, {persona.age}
        </p>
        <p className="mb-3 text-xs text-text-muted">{persona.city}</p>
        <ul className="space-y-2">
          {persona.bullets.map((bullet, i) => (
            <li key={i} className="text-[13.5px] text-text-secondary leading-snug">
              {bullet}
            </li>
          ))}
        </ul>
      </div>

      <p className="mb-4 text-[11px] italic text-text-muted leading-snug">
        {compositeCardLabel(persona.name)}
      </p>

      <p className="mb-2 text-sm font-medium text-text-primary">Does this land?</p>
      <div className="space-y-2.5 mb-4">
        {RELATE_OPTIONS.map((opt) => (
          <ChipButton
            key={opt.id}
            testId={`composite-relate-${opt.id}`}
            selected={relate === opt.id}
            onClick={() => handleRelate(opt.id)}
          >
            {opt.label}
          </ChipButton>
        ))}
      </div>

      {showRepick && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-text-muted">Which of these is more you?</p>
          <div className="space-y-2.5">
            {DOOR_FAMILIES.filter((f) => f !== family).map((f) => (
              <ChipButton
                key={f}
                testId={`composite-repick-${f}`}
                selected={repickFamily === f}
                onClick={() => handleRepick(f)}
              >
                {DOOR_CONFIG[f].situation}
              </ChipButton>
            ))}
          </div>
        </div>
      )}

      {showTruer && (
        <div className="mb-4">
          <label className="block mb-1.5 text-xs font-medium text-text-muted" htmlFor="composite-truer">
            {COMPOSITE_TRUER_PROMPT}
          </label>
          <input
            id="composite-truer"
            data-testid="composite-truer-line"
            value={truerLine}
            onChange={(e) => setTruerLine(e.target.value)}
            placeholder={COMPOSITE_TRUER_PLACEHOLDER}
            className="w-full px-4 py-3 outline-none focus:ring-2 focus:ring-text-primary/30 rounded-control border border-[var(--border-subtle)] bg-bg-elevated text-text-primary font-serif italic text-[16px] placeholder:text-text-muted"
          />
        </div>
      )}

      <BeatError message={error} />

      <BeatPrimaryButton
        onClick={handleContinue}
        disabled={!canContinue}
        pending={pending}
        testId="composite-continue"
      >
        Continue
      </BeatPrimaryButton>

      <DeleteEverythingFooter />
    </BeatShell>
  )
}
