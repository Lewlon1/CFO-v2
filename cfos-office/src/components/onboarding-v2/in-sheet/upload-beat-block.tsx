'use client'

import { useEffect, useRef, useState } from 'react'
import { UploadWizard } from '@/components/upload/UploadWizard'
import { createClient } from '@/lib/supabase/client'
import type { Category } from '@/lib/parsers/types'

type Props = {
  /** Fires once the import has landed (single-file autoImport) so the host can
   *  advance to the essentials beat. */
  onImported: (importBatchId?: string, count?: number) => void
  onDone: () => void
}

/**
 * In-sheet statement-upload beat. Wraps UploadWizard in autoImport mode — the
 * same pipeline the old /onboarding-v2/upload page used — so the file is parsed
 * and imported without a review step, and the wizard's interim states render
 * inside the chat sheet. Categories are fetched client-side, mirroring the old
 * UploadOrchestrator.
 */
export function UploadBeatBlock({ onImported, onDone }: Props) {
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

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-medium text-text-primary leading-tight">
          Let&apos;s look at the real numbers.
        </h2>
        <p className="text-sm text-text-secondary leading-snug">
          Drop a recent bank statement — I&apos;ll read the last 90 days and
          show you what&apos;s actually going on. It never leaves your account.
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
