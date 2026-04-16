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
  // We advance the beat on the FIRST successful import so the user can move
  // on while remaining files keep processing. Parent keeps this component
  // mounted (hidden) until onBackgroundDone fires.
  const handleImported = useCallback((importBatchId?: string, count?: number) => {
    totalImportedRef.current += count ?? 0
    if (importBatchId) lastBatchIdRef.current = importBatchId

    if (!advancedRef.current && lastBatchIdRef.current) {
      advancedRef.current = true
      onComplete(lastBatchIdRef.current, totalImportedRef.current)
    }
  }, [onComplete])

  // Wizard finished the whole queue. If we never advanced (e.g. every file
  // failed to import) fall back to the original behaviour so the modal is
  // never stuck. Otherwise, signal the parent that the hidden wizard can go.
  const handleDone = useCallback(() => {
    if (!advancedRef.current) {
      advancedRef.current = true
      onComplete(lastBatchIdRef.current, totalImportedRef.current)
      return
    }
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
