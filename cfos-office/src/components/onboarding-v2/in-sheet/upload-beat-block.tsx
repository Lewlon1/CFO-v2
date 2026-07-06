'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { InSheetStatementUpload } from '@/components/upload/InSheetStatementUpload'
import type { OnboardingGoalSummary } from '@/lib/onboarding-v2/types'
import { skipUploadToEssentials } from '@/app/onboarding-v2/skip-upload-actions'
import { UploadIntro } from './upload-intro'

type Props = {
  /** Fires once the import has landed (single-file autoImport) so the host can
   *  advance to the essentials beat. */
  onImported: (importBatchId?: string, count?: number) => void
  onDone: () => void
  /** Active goal (or null) — drives the bridge intro's personalised
   *  acknowledgement before the upload ask. */
  goal: OnboardingGoalSummary | null
}

/**
 * Onboarding upload beat. Two phases:
 *  • 'intro' — the goal-aware bridge (UploadIntro), which is onboarding-coupled
 *    (it owns the skip-to-essentials escape hatch).
 *  • 'upload' — the shared in-sheet uploader (InSheetStatementUpload), the
 *    single source of truth for the "look at the real numbers" step, with the
 *    same skip escape rendered beneath it. A user who taps Upload and only
 *    then discovers they can't produce a file (wrong format, desktop-only
 *    export) must still be able to reach the declared path — the intro's skip
 *    is unreachable from here (phase is client state, no back control).
 *
 * No onCancel is passed to the uploader: that seam renders a "Back to chat"
 * header control (the upgrade flow's affordance), which is wrong mid-
 * onboarding — the sibling skip link below the wizard is the escape.
 */
export function UploadBeatBlock({ onImported, onDone, goal }: Props) {
  const [phase, setPhase] = useState<'intro' | 'upload'>('intro')
  const [skipBusy, setSkipBusy] = useState(false)
  const router = useRouter()

  function handleSkip() {
    if (skipBusy) return
    setSkipBusy(true)
    void skipUploadToEssentials()
      .then(() => router.refresh())
      .catch((err) => {
        setSkipBusy(false)
        console.error('[upload-beat] skip-upload failed', err)
      })
  }

  if (phase === 'intro') {
    return <UploadIntro goal={goal} onContinue={() => setPhase('upload')} />
  }

  return (
    <>
      <InSheetStatementUpload onImported={onImported} onDone={onDone} />
      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={handleSkip}
          disabled={skipBusy}
          className="w-full min-h-11 py-3 text-xs text-text-muted underline underline-offset-2 hover:text-text-secondary disabled:opacity-40 transition-colors"
        >
          {skipBusy ? 'One moment…' : "I don't have a statement handy"}
        </button>
      </div>
    </>
  )
}
