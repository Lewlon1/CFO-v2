'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { currencySymbol, formatMoney } from '@/lib/format/money'
import { saveIncome, type IncomePace } from '@/app/onboarding-v2/estimate-actions'
import { advanceStep } from '@/app/onboarding-v2/actions-step'
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

const INCOME_MIN = 500
const INCOME_MAX = 50000

/** Income beat — one number, then a deterministic pace preview against the
 *  goal before moving on to the sketch. */
export function IncomeBeatBlock({ context }: { context: EstimateOnboardingContext }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const symbol = currencySymbol(context.currency).trim() || context.currency

  const [phase, setPhase] = useState<'input' | 'pace'>('input')
  const [raw, setRaw] = useState(context.income != null ? String(context.income) : '')
  const [pace, setPace] = useState<IncomePace>(null)
  const [error, setError] = useState<string | null>(null)

  const parsed = Number(raw.replace(/[,\s]/g, ''))
  const valid = Number.isFinite(parsed) && parsed >= INCOME_MIN && parsed <= INCOME_MAX

  function handleSubmit() {
    if (!valid || pending) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await saveIncome({ income: parsed })
        setPace(result)
        setPhase('pace')
      } catch (err) {
        console.error('[income-beat] save failed', err)
        setError('Something went wrong. Please try again.')
      }
    })
  }

  function handleAdvance() {
    if (pending) return
    setError(null)
    startTransition(async () => {
      try {
        await advanceStep('estimate_sketch')
        router.refresh()
      } catch (err) {
        console.error('[income-beat] advance failed', err)
        setError('Something went wrong. Please try again.')
      }
    })
  }

  if (phase === 'pace') {
    return (
      <BeatShell>
        <BeatHeader />
        {pace ? (
          <>
            <p className="mb-3 font-serif text-[20px] leading-snug text-text-primary">
              To land it on time, you&apos;d set aside about{' '}
              <span className="text-accent-gold">
                ≈{formatMoney(pace.requiredMonthly, context.currency)}
              </span>{' '}
              a month.
            </p>
            <p className="mb-6 text-sm text-text-secondary leading-snug">
              {`That's ${pace.requiredPctOfIncome}% of your take-home — `}
              {pace.paceVerdict === 'steep'
                ? "steep, but worth knowing before we go further."
                : 'well within reach on these numbers.'}
            </p>
          </>
        ) : (
          <p className="mb-6 font-serif text-[20px] leading-snug text-text-primary">
            Good — that&apos;s the number I&apos;ll work from.
          </p>
        )}
        <BeatError message={error} />
        <BeatPrimaryButton onClick={handleAdvance} pending={pending} testId="income-pace-continue">
          Keep going
        </BeatPrimaryButton>
        <DeleteEverythingFooter />
      </BeatShell>
    )
  }

  return (
    <BeatShell>
      <BeatHeader subtitle="Roughly what lands in your account each month, after tax." />
      <BeatHeading>What comes in?</BeatHeading>
      <BeatHint>A round number is fine — this is the one figure everything else hangs off.</BeatHint>

      <div className="relative mb-5">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[18px] text-text-muted">
          {symbol}
        </span>
        <input
          data-testid="income-input"
          inputMode="numeric"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="2,600"
          className="w-full pl-9 pr-4 py-3 outline-none focus:ring-2 focus:ring-text-primary/30 rounded-control border border-[var(--border-subtle)] bg-bg-elevated text-text-primary text-[18px] tabular-nums placeholder:text-text-muted"
        />
      </div>

      {raw.trim().length > 0 && !valid && (
        <p className="mb-4 text-xs text-text-muted">
          Enter a monthly figure between {symbol}
          {formatMoney(INCOME_MIN, context.currency).replace(/[^\d.,]/g, '')} and {symbol}
          {formatMoney(INCOME_MAX, context.currency).replace(/[^\d.,]/g, '')}.
        </p>
      )}

      <BeatError message={error} />

      <BeatPrimaryButton
        onClick={handleSubmit}
        disabled={!valid}
        pending={pending}
        testId="income-continue"
      >
        Continue
      </BeatPrimaryButton>

      <DeleteEverythingFooter />
    </BeatShell>
  )
}
