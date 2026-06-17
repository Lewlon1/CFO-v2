'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { UploadWizard } from '@/components/upload/UploadWizard'
import { createClient } from '@/lib/supabase/client'
import type { Category } from '@/lib/parsers/types'

type Props = {
  /** Fires once the import has landed (single-file autoImport), with the import
   *  batch id + imported count, wired straight from UploadWizard.onImported. */
  onImported?: (importBatchId?: string, count?: number) => void
  /** Fires when the wizard signals completion (autoImport single-file: right
   *  after onImported). UploadBeatBlock uses this to advance the onboarding
   *  step; the upgrade flow can ignore it and key off onImported. */
  onDone?: () => void
  /** When provided, renders a "Back to chat" control in the header that calls
   *  this. UploadWizard has no cancel of its own, so this is the only escape.
   *  Omitted (onboarding) → no control, matching the original beat exactly. */
  onCancel?: () => void
}

/**
 * In-sheet statement-upload surface. The single source of truth for the
 * "look at the real numbers" upload step — used both by the onboarding upload
 * beat (UploadBeatBlock) and the declared-Read upgrade flow (ChatSheet).
 *
 * Wraps UploadWizard in autoImport mode (same pipeline as the old
 * /onboarding-v2/upload page): the file is parsed and imported without a review
 * step, and the wizard's interim states render inside the chat sheet.
 * Categories are fetched client-side, mirroring the old UploadOrchestrator.
 *
 * This is a behaviour-preserving extraction of UploadBeatBlock's 'upload'
 * phase. onImported / onDone pass straight through to UploadWizard so callers
 * keep the wizard's exact two-seam contract; onCancel is the only addition.
 */
export function InSheetStatementUpload({ onImported, onDone, onCancel }: Props) {
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

  return (
    <div className="px-4 py-4 space-y-4 animate-fade-in">
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary min-h-[44px] transition-colors"
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
          Back to chat
        </button>
      ) : null}
      <div className="space-y-2">
        <h2 className="text-base font-medium text-text-primary leading-tight">
          Let&apos;s look at the real numbers.
        </h2>
        <div className="flex items-center gap-2 rounded-control border border-accent-gold-border bg-accent-gold-bg px-3 py-2 text-accent-gold">
          <span aria-hidden>📅</span>
          <span className="text-sm font-medium">
            Upload your last 3 months — about 90 days
          </span>
        </div>
        <p className="text-sm text-text-secondary leading-snug">
          The more history I can see, the sharper the read — and it never leaves
          your account.
        </p>
      </div>
      <UploadWizard
        categories={categories}
        onImported={onImported ?? (() => {})}
        onDone={onDone}
        context="transactions"
        autoImport
      />
    </div>
  )
}
