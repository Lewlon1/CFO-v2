'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { currencySymbol } from '@/lib/format/money'
import { saveSketchBand, type SketchBandKey } from '@/app/onboarding-v2/estimate-actions'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
import {
  HOUSING_BANDS,
  SUBS_BANDS,
  BILLS_BANDS,
  FOOD_OUT_BANDS,
  SAVE_REACH_BANDS,
  type BandOption,
} from '@/lib/onboarding-v2/estimates/bands'
import type { EstimateOnboardingContext } from '@/lib/onboarding-v2/estimate-context'
import {
  BeatShell,
  BeatHeader,
  BeatHeading,
  BeatHint,
  BeatPrimaryButton,
  BeatError,
  DeleteEverythingFooter,
} from './beat-chrome'

type Question = {
  key: SketchBandKey
  q: string
  bands: Record<string, BandOption>
  /** money bands get a currency symbol prefix; count bands (subs) do not. */
  money: boolean
  provenance: string
}

const QUESTIONS: Question[] = [
  {
    key: 'housing',
    q: 'Roughly, what goes on housing a month?',
    bands: HOUSING_BANDS,
    money: true,
    provenance: 'Rent or mortgage — your biggest fixed line. We use the middle of the band you pick.',
  },
  {
    key: 'subs',
    q: 'How many subscriptions are you paying for?',
    bands: SUBS_BANDS,
    money: false,
    provenance: 'Streaming, apps, memberships. We price each at a typical monthly cost.',
  },
  {
    key: 'bills',
    q: 'Roughly, what do the bills come to?',
    bands: BILLS_BANDS,
    money: true,
    provenance: 'Energy, water, phone, broadband — the recurring essentials after housing.',
  },
  {
    key: 'foodOut',
    q: 'How much eating and drinking out, in a week?',
    bands: FOOD_OUT_BANDS,
    money: true,
    provenance: 'Restaurants, takeaways, coffees, drinks. We turn the weekly figure into a monthly one.',
  },
  {
    key: 'saveReach',
    q: 'How much could you comfortably put away a month?',
    bands: SAVE_REACH_BANDS,
    money: true,
    provenance: "Not what you do save — what you reckon you could, on a normal month.",
  },
]

const BAND_KEYS: SketchBandKey[] = ['housing', 'subs', 'bills', 'foodOut', 'saveReach']

/** Prefix the first digit run with the currency symbol so "800–1,200" reads
 *  "£800–1,200" and "<800" reads "<£800". Count bands pass through unchanged. */
function bandLabel(label: string, money: boolean, symbol: string): string {
  if (!money) return label
  return label.replace(/(\d)/, `${symbol}$1`)
}

export function SketchBeatBlock({ context }: { context: EstimateOnboardingContext }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const symbol = currencySymbol(context.currency).trim() || context.currency

  const [selected, setSelected] = useState<Record<SketchBandKey, string | null>>({
    housing: context.bands.housing,
    subs: context.bands.subs,
    bills: context.bands.bills,
    foodOut: context.bands.foodOut,
    saveReach: context.bands.saveReach,
  })
  // Tracks which bands are CONFIRMED persisted. Continue gates on this, never on
  // optimistic `selected` — a save that fails server-side must not let the user
  // advance with an unpersisted band (which would 500 the estimate Read).
  const [saved, setSaved] = useState<Record<SketchBandKey, boolean>>({
    housing: context.bands.housing != null,
    subs: context.bands.subs != null,
    bills: context.bands.bills != null,
    foodOut: context.bands.foodOut != null,
    saveReach: context.bands.saveReach != null,
  })
  const [openProvenance, setOpenProvenance] = useState<SketchBandKey | null>(null)
  const [error, setError] = useState<string | null>(null)

  const allSaved = BAND_KEYS.every((k) => saved[k])
  const savedCount = BAND_KEYS.filter((k) => saved[k]).length

  function tap(band: SketchBandKey, value: string) {
    const prev = selected[band]
    setSelected((p) => ({ ...p, [band]: value }))
    setSaved((p) => ({ ...p, [band]: false }))
    setError(null)
    // Progressive save (CLAUDE.md pitfall #3) — persist each band as it lands.
    // On failure revert the optimistic selection so the band reads as untapped
    // and the user must re-tap; Continue stays gated until the save confirms.
    void saveSketchBand({ band, value })
      .then(() => setSaved((p) => ({ ...p, [band]: true })))
      .catch((err) => {
        console.error('[sketch-beat] saveSketchBand failed', err)
        setSelected((p) => ({ ...p, [band]: prev }))
        setError('That one did not save — tap it again.')
      })
  }

  function handleContinue() {
    if (!allSaved || pending) return
    setError(null)
    startTransition(async () => {
      try {
        await advanceStep('estimate_verdicts')
        router.refresh()
      } catch (err) {
        console.error('[sketch-beat] advance failed', err)
        setError('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <BeatShell>
      <BeatHeader subtitle="No statements yet — just your best guess. Tap the band that feels closest." />
      <BeatHeading>Sketch your month</BeatHeading>
      <BeatHint>Rough is fine. We turn each band into a working figure — and check it later.</BeatHint>

      <div className="space-y-5 mb-5">
        {QUESTIONS.map((question) => (
          <div key={question.key}>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <p className="text-[14px] font-medium text-text-primary">{question.q}</p>
              <button
                type="button"
                data-testid={`sketch-provenance-${question.key}`}
                onClick={() =>
                  setOpenProvenance((cur) => (cur === question.key ? null : question.key))
                }
                className="shrink-0 text-[10px] text-text-muted underline underline-offset-2 min-h-11 flex items-center"
              >
                where this comes from
              </button>
            </div>
            {openProvenance === question.key && (
              <p className="mb-2 px-3 py-2 rounded-control bg-tap-highlight border border-border-medium text-[12px] text-text-secondary leading-snug">
                {question.provenance}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(question.bands).map(([id, band]) => {
                const isSel = selected[question.key] === id
                return (
                  <button
                    key={id}
                    type="button"
                    data-testid={`sketch-${question.key}-${id}`}
                    onClick={() => tap(question.key, id)}
                    className={
                      'px-3 py-3 transition-colors min-h-11 rounded-control text-[13.5px] border text-center ' +
                      (isSel
                        ? 'bg-primary/10 text-text-primary border-primary'
                        : 'bg-bg-elevated text-text-secondary border-[var(--border-subtle)]')
                    }
                  >
                    {question.money ? '≈' : ''}
                    {bandLabel(band.label, question.money, symbol)}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <BeatError message={error} />

      <BeatPrimaryButton
        onClick={handleContinue}
        disabled={!allSaved}
        pending={pending}
        testId="sketch-continue"
      >
        {allSaved ? 'That looks about right' : `Tap all five (${savedCount}/5)`}
      </BeatPrimaryButton>

      <DeleteEverythingFooter />
    </BeatShell>
  )
}
