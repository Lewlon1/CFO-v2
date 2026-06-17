'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatMoney } from '@/lib/format/money'
import {
  saveVerdictsAndAdvance,
  type EstimateVerdictValue,
} from '@/app/onboarding-v2/estimate-actions'
import { deriveEstimates } from '@/lib/onboarding-v2/estimates/derive'
import type {
  EstimateBands,
  HousingBandId,
  SubsBandId,
  BillsBandId,
  FoodOutBandId,
  SaveReachBandId,
} from '@/lib/onboarding-v2/estimates/bands'
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

const TOP_VALUES = ['Freedom', 'Security', 'Family', 'Experiences', 'Growth'] as const

const VERDICT_OPTIONS: { id: EstimateVerdictValue; label: string }[] = [
  { id: 'worth_it', label: 'Worth it' },
  { id: 'leak', label: 'A leak' },
  { id: 'unsure', label: 'Not sure' },
]

type RowKey = 'subscriptions' | 'foodOut' | 'drift'

/** Verdicts beat — what matters most, then the user's own call on three of their
 *  estimated clusters, each shown with its own ≈ figure (derived locally from
 *  the same pure engine the Read uses, so the numbers always agree). */
export function VerdictsBeatBlock({ context }: { context: EstimateOnboardingContext }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const derived = useMemo(() => {
    const bands = toBands(context.bands)
    if (!bands || context.income == null) return null
    return deriveEstimates({ income: context.income, bands, goal: null })
  }, [context.bands, context.income])

  const [topValue, setTopValue] = useState<string | null>(null)
  const [verdicts, setVerdicts] = useState<Record<RowKey, EstimateVerdictValue | null>>({
    subscriptions: null,
    foodOut: null,
    drift: null,
  })
  const [error, setError] = useState<string | null>(null)

  const rows: { key: RowKey; label: string; figure: number | null }[] = [
    { key: 'subscriptions', label: 'Your subscriptions', figure: derived?.subsMonthly ?? null },
    { key: 'foodOut', label: 'Eating & drinking out', figure: derived?.foodOutMonthly ?? null },
    { key: 'drift', label: "What you can't account for", figure: derived?.drift ?? null },
  ]

  const allVerdicts = verdicts.subscriptions && verdicts.foodOut && verdicts.drift
  const canContinue = topValue != null && allVerdicts != null && !pending

  function handleContinue() {
    if (!canContinue || topValue == null) return
    if (!verdicts.subscriptions || !verdicts.foodOut || !verdicts.drift) return
    setError(null)
    startTransition(async () => {
      try {
        await saveVerdictsAndAdvance({
          topValue,
          verdicts: {
            subscriptions: verdicts.subscriptions!,
            foodOut: verdicts.foodOut!,
            drift: verdicts.drift!,
          },
        })
        router.refresh()
      } catch (err) {
        console.error('[verdicts-beat] save failed', err)
        setError('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <BeatShell>
      <BeatHeader subtitle="Last thing — your own read on a few of these. There are no wrong answers." />
      <BeatHeading>What matters, and what doesn&apos;t</BeatHeading>

      <p className="mb-2 text-xs font-medium text-text-muted">What matters most to you with money?</p>
      <div className="grid grid-cols-2 gap-2 mb-6">
        {TOP_VALUES.map((value) => (
          <ChipButton
            key={value}
            testId={`verdict-value-${value}`}
            selected={topValue === value}
            onClick={() => setTopValue(value)}
          >
            {value}
          </ChipButton>
        ))}
      </div>

      <BeatHint>For each of these — worth it, a leak, or you&apos;re not sure yet?</BeatHint>

      <div className="space-y-4 mb-5">
        {rows.map((row) => (
          <div key={row.key}>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <p className="text-[14px] font-medium text-text-primary">{row.label}</p>
              {row.figure != null && (
                <p className="text-[13px] text-text-muted tabular-nums">
                  ≈{formatMoney(Math.round(row.figure), context.currency)}/mo
                </p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {VERDICT_OPTIONS.map((opt) => {
                const isSel = verdicts[row.key] === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`verdict-${row.key}-${opt.id}`}
                    onClick={() => setVerdicts((prev) => ({ ...prev, [row.key]: opt.id }))}
                    className={
                      'px-2 py-2.5 transition-colors min-h-11 rounded-control text-[13px] border text-center ' +
                      (isSel
                        ? 'bg-primary/10 text-text-primary border-primary'
                        : 'bg-bg-elevated text-text-secondary border-[var(--border-subtle)]')
                    }
                  >
                    {opt.label}
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
        disabled={!canContinue}
        pending={pending}
        testId="verdicts-continue"
      >
        Show me the read
      </BeatPrimaryButton>

      <DeleteEverythingFooter />
    </BeatShell>
  )
}

function toBands(b: EstimateOnboardingContext['bands']): EstimateBands | null {
  if (!b.housing || !b.subs || !b.bills || !b.foodOut || !b.saveReach) return null
  return {
    housing: b.housing as HousingBandId,
    subs: b.subs as SubsBandId,
    bills: b.bills as BillsBandId,
    foodOut: b.foodOut as FoodOutBandId,
    saveReach: b.saveReach as SaveReachBandId,
  }
}
