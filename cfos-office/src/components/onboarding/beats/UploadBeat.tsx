'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { UploadWizard } from '@/components/upload/UploadWizard'
import { createClient } from '@/lib/supabase/client'
import type { Category } from '@/lib/parsers/types'

interface UploadBeatProps {
  onComplete: (importBatchId: string | null, transactionCount: number) => void
  onSkip: () => void
}

export function UploadBeat({ onComplete, onSkip }: UploadBeatProps) {
  const [categories, setCategories] = useState<Category[]>([])
  // Accumulate across all files in the batch — refs avoid stale closures
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

  // Called once per file — accumulate totals but don't advance the beat yet.
  // Advancing here would unmount the wizard mid-batch, losing subsequent files.
  const handleImported = useCallback((importBatchId?: string, count?: number) => {
    totalImportedRef.current += count ?? 0
    if (importBatchId) lastBatchIdRef.current = importBatchId
  }, [])

  // Called by the wizard when ALL files in the batch are done (autoImport path
  // bypasses the summary screens and calls onDone directly).
  const handleDone = useCallback(() => {
    onComplete(lastBatchIdRef.current, totalImportedRef.current)
  }, [onComplete])

  return (
    <div className="px-4 py-2 animate-[fade-in_0.3s_ease-out]">
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
