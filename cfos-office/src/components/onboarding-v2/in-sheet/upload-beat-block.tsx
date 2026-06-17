'use client'

import { useState } from 'react'
import { InSheetStatementUpload } from '@/components/upload/InSheetStatementUpload'
import type { OnboardingGoalSummary } from '@/lib/onboarding-v2/types'
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
 *    single source of truth for the "look at the real numbers" step.
 *
 * No onCancel is passed to the uploader: onboarding has no "back to chat" —
 * the user proceeds or uses the intro's skip. The 'upload' phase therefore
 * looks and behaves exactly as before this extraction.
 */
export function UploadBeatBlock({ onImported, onDone, goal }: Props) {
  const [phase, setPhase] = useState<'intro' | 'upload'>('intro')

  if (phase === 'intro') {
    return <UploadIntro goal={goal} onContinue={() => setPhase('upload')} />
  }

  return <InSheetStatementUpload onImported={onImported} onDone={onDone} />
}
