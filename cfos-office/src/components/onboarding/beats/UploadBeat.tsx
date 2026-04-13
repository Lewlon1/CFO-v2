'use client'

import { useState, useEffect, useCallback } from 'react'
import { UploadWizard } from '@/components/upload/UploadWizard'
import { createClient } from '@/lib/supabase/client'
import type { Category } from '@/lib/parsers/types'

interface UploadBeatProps {
  onComplete: (importBatchId: string | null, transactionCount: number) => void
  onSkip: () => void
}

export function UploadBeat({ onComplete, onSkip }: UploadBeatProps) {
  const [categories, setCategories] = useState<Category[]>([])

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

  const handleImported = useCallback((importBatchId?: string, count?: number) => {
    onComplete(importBatchId ?? null, count ?? 0)
  }, [onComplete])

  const handleDone = useCallback(() => {
    // Already completed via handleImported
  }, [])

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
