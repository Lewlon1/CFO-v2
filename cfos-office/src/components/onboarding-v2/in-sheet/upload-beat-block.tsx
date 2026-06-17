'use client'

import { useEffect, useRef, useState } from 'react'
import { UploadWizard } from '@/components/upload/UploadWizard'
import { createClient } from '@/lib/supabase/client'
import type { Category } from '@/lib/parsers/types'
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
  /**
   * 'onboarding' (default) — the value-first upload, fronted by the goal-bridge
   * intro. 'check' — the OB-3 statement-check mission for an already-onboarded
   * user: skip the goal bridge and reframe the copy around verifying the sketch.
   */
  mode?: 'onboarding' | 'check'
}

/**
 * In-sheet statement-upload beat. Wraps UploadWizard in autoImport mode — the
 * same pipeline the old /onboarding-v2/upload page used — so the file is parsed
 * and imported without a review step, and the wizard's interim states render
 * inside the chat sheet. Categories are fetched client-side, mirroring the old
 * UploadOrchestrator.
 */
export function UploadBeatBlock({ onImported, onDone, goal, mode = 'onboarding' }: Props) {
  const isCheck = mode === 'check'
  // The check mission's user is already onboarded — the goal bridge would be a
  // re-introduction, so skip straight to the upload.
  const [phase, setPhase] = useState<'intro' | 'upload'>(isCheck ? 'upload' : 'intro')
  const [categories, setCategories] = useState<Category[]>([])
  const totalImportedRef = useRef(0)
  const lastBatchIdRef = useRef<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('categories')
      .select('*')
      .order('name')
      .then(({ data }) => {
        if (data) setCategories(data as Category[])
      })
  }, [])

  function handleImported(importBatchId?: string, count?: number) {
    totalImportedRef.current += count ?? 0
    if (importBatchId) lastBatchIdRef.current = importBatchId
    onImported(importBatchId, count)
  }

  if (phase === 'intro') {
    return <UploadIntro goal={goal} onContinue={() => setPhase('upload')} />
  }

  return (
    <div className="px-4 py-4 space-y-4 animate-fade-in">
      <div className="space-y-2">
        <h2 className="text-base font-medium text-text-primary leading-tight">
          {isCheck ? "Let's check the maths." : "Let's look at the real numbers."}
        </h2>
        <div className="flex items-center gap-2 rounded-control border border-accent-gold-border bg-accent-gold-bg px-3 py-2 text-accent-gold">
          <span aria-hidden>📅</span>
          <span className="text-sm font-medium">
            {isCheck
              ? 'Upload a recent month — more sharpens the check'
              : 'Upload your last 3 months — about 90 days'}
          </span>
        </div>
        <p className="text-sm text-text-secondary leading-snug">
          {isCheck
            ? "I'll line every estimate up against the real number — and it never leaves your account."
            : 'The more history I can see, the sharper the read — and it never leaves your account.'}
        </p>
      </div>
      <UploadWizard
        categories={categories}
        onImported={handleImported}
        onDone={onDone}
        context="transactions"
        autoImport
      />
    </div>
  )
}
