'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { UploadWizard } from '@/components/upload/UploadWizard'
import { createClient } from '@/lib/supabase/client'
import type { Category } from '@/lib/parsers/types'

interface UploadBeatProps {
  onComplete: (importBatchId: string | null, transactionCount: number) => void
  onSkip: () => void
  onBackgroundDone?: (totalTransactionCount: number) => void
  hidden?: boolean
}

export function UploadBeat({ onComplete, onSkip, onBackgroundDone, hidden }: UploadBeatProps) {
  const [categories, setCategories] = useState<Category[]>([])
  // Accumulate across all files in the batch — refs avoid stale closures
  const totalImportedRef = useRef(0)
  const lastBatchIdRef = useRef<string | null>(null)
  const advancedRef = useRef(false)

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

  // Fires per-file after the server commits that file's transactions.
  // We accumulate the counts but do NOT advance the onboarding beat here —
  // we wait for the full batch so the user sees the wizard's BatchSummary
  // (including any per-file failures) before moving on. Previously we
  // advanced on first success and hid the wizard in the background, which
  // buried failure messages and let the insight engine narrate over a
  // partial dataset.
  const handleImported = useCallback((importBatchId?: string, count?: number) => {
    totalImportedRef.current += count ?? 0
    if (importBatchId) lastBatchIdRef.current = importBatchId
  }, [])

  // Wizard finished the whole queue (or the user acknowledged the batch
  // summary). Advance the onboarding beat now, passing the final imported
  // count so the modal can skip insight generation when nothing landed.
  const handleDone = useCallback(() => {
    if (advancedRef.current) return
    advancedRef.current = true
    onComplete(lastBatchIdRef.current, totalImportedRef.current)
    onBackgroundDone?.(totalImportedRef.current)
  }, [onComplete, onBackgroundDone])

  return (
    <div
      className={`px-4 py-2 animate-[fade-in_0.3s_ease-out] ${hidden ? 'hidden' : ''}`}
      aria-hidden={hidden || undefined}
    >
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] overflow-hidden">
        <UploadWizard
          categories={categories}
          onImported={handleImported}
          onDone={handleDone}
          context="transactions"
          autoImport
        />
      </div>
      <button
        onClick={onSkip}
        className="mt-3 ml-[40px] text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors min-h-[44px]"
      >
        I&apos;ll do this later
      </button>
    </div>
  )
}
