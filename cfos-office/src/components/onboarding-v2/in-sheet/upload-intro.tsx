'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { CfoThinking } from '@/components/brand/CfoThinking'
import { formatMoney } from '@/lib/utils/money'
import type { OnboardingGoalSummary } from '@/lib/onboarding-v2/types'
import { skipUploadToEssentials } from '@/app/onboarding-v2/skip-upload-actions'

type Props = {
  /** Active goal, or null on the skip/defer path. */
  goal: OnboardingGoalSummary | null
  /** Called once the bridge is done — auto-fires after the dwell, or on tap. */
  onContinue: () => void
}

// The bridge dwell. Kept well under the test driver's 30s wait for the file
// input (which only mounts in the upload phase, so the driver waits this out).
const DWELL_MS = 2800
const DWELL_REDUCED_MS = 600

/**
 * Trust-building bridge between the goal beat and the statement-upload ask.
 * Instead of snapping straight from the goal chat to the uploader, the CFO
 * acknowledges the goal by name, says *why* the statements matter, shows a brief
 * "preparing" beat, then hands off to the uploader. Advancing is now an explicit
 * tap — 'Continue' proceeds to the uploader, or 'I don't have a statement handy'
 * skips upload and advances straight to the income/rent beat.
 */
export function UploadIntro({ goal, onContinue }: Props) {
  const [showPreparing, setShowPreparing] = useState(false)
  const doneRef = useRef(false)
  const router = useRouter()

  const advance = () => {
    if (doneRef.current) return
    doneRef.current = true
    onContinue()
  }

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const dwell = reduced ? DWELL_REDUCED_MS : DWELL_MS
    const prep = setTimeout(() => setShowPreparing(true), Math.min(900, dwell / 2))
    return () => {
      clearTimeout(prep)
    }
  }, [])

  return (
    <div className="px-4 py-6 space-y-4 animate-fade-in">
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

      {showPreparing && <CfoThinking label="Getting ready to read your statements…" />}

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={advance}
          className="text-xs text-text-muted underline underline-offset-2 hover:text-text-secondary"
        >
          Continue
        </button>
        <button
          type="button"
          onClick={() => {
            if (doneRef.current) return
            doneRef.current = true
            void skipUploadToEssentials()
              .then(() => router.refresh())
              .catch((err) => {
                doneRef.current = false
                console.error('[upload-intro] skip-upload failed', err)
              })
          }}
          className="text-xs text-text-muted underline underline-offset-2 hover:text-text-secondary"
        >
          I don&apos;t have a statement handy
        </button>
      </div>
    </div>
  )
}
