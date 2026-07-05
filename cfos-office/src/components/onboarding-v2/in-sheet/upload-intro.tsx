'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { formatMoney } from '@/lib/utils/money'
import type { OnboardingGoalSummary } from '@/lib/onboarding-v2/types'
import { skipUploadToEssentials } from '@/app/onboarding-v2/skip-upload-actions'

type Props = {
  /** Active goal, or null on the skip/defer path. */
  goal: OnboardingGoalSummary | null
  /** Called when the user taps Upload to proceed to the uploader. */
  onContinue: () => void
}

/**
 * Trust-building bridge between the goal beat and the statement upload. The CFO
 * acknowledges the goal by name and says *why* the statements matter, then puts
 * the next action front and centre: a single primary CTA to upload, with one
 * de-emphasised escape hatch ('I don't have a statement handy') that skips
 * upload and advances straight to the income/rent beat. No passive "preparing"
 * dwell — the screen never implies work is happening while it waits on a tap.
 */
export function UploadIntro({ goal, onContinue }: Props) {
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  function handleUpload() {
    if (busy) return
    onContinue()
  }

  function handleSkip() {
    if (busy) return
    setBusy(true)
    void skipUploadToEssentials()
      .then(() => router.refresh())
      .catch((err) => {
        setBusy(false)
        console.error('[upload-intro] skip-upload failed', err)
      })
  }

  return (
    <div className="px-4 py-6 space-y-5 animate-fade-in">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">
          <CFOAvatar size={28} />
        </span>
        <div className="space-y-1">
          {goal ? (
            <>
              <p className="text-base font-medium text-text-primary leading-snug">
                {goal.name}
                {goal.targetAmount != null
                  ? ` — ${formatMoney(goal.targetAmount, { currency: goal.currency })}`
                  : ''}
                . Good, that&apos;s the target.
              </p>
              <p className="text-sm text-text-secondary leading-snug">
                To tell you whether that&apos;s months or years away, I need to see
                where your money actually goes — not where you think it goes.
              </p>
            </>
          ) : (
            <>
              <p className="text-base font-medium text-text-primary leading-snug">
                No goal yet — that&apos;s fine.
              </p>
              <p className="text-sm text-text-secondary leading-snug">
                We&apos;ll start the other way round: I&apos;ll look at what&apos;s
                actually happening with your money first.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <button
          type="button"
          onClick={handleUpload}
          disabled={busy}
          className="w-full min-h-[44px] rounded-control bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 text-sm font-semibold px-4 py-3 disabled:opacity-40 transition-colors"
        >
          Upload my statements
        </button>
        <button
          type="button"
          onClick={handleSkip}
          disabled={busy}
          className="w-full min-h-11 py-3 text-xs text-text-muted underline underline-offset-2 hover:text-text-secondary disabled:opacity-40 transition-colors"
        >
          {busy ? 'One moment…' : "I don't have a statement handy"}
        </button>
      </div>
    </div>
  )
}
