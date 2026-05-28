'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ProcessingForm } from '@/components/onboarding-v2/processing-form'
import { ProcessingProgress } from '@/components/onboarding-v2/processing-progress'

type Props = {
  initialIncome: number | null
  initialRent: number | null
  currencySymbol: string
}

// Hard cap on the perceived wait. The background pipeline runs server-side
// and continues regardless — this flag just enables the Continue button so
// a slow snapshot refresh doesn't trap the user behind the form.
const IMPORT_GRACE_MS = 30_000

/**
 * Hosts the income / rent form and the processing-progress strip side by
 * side. The actual import pipeline (parsing, recurring detection, snapshot
 * refresh, merchant_aggregates refresh) is kicked off by the upload
 * orchestrator before we land here; the wait is masked by the form. After
 * IMPORT_GRACE_MS we treat the import as complete for UX purposes — any
 * still-running background work continues to backfill.
 */
export function ProcessingOrchestrator({
  initialIncome,
  initialRent,
  currencySymbol,
}: Props) {
  const router = useRouter()
  const [importComplete, setImportComplete] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setImportComplete(true), IMPORT_GRACE_MS)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <div className="flex-1 flex flex-col max-w-[430px] mx-auto w-full px-4 py-6 gap-6">
        <ProcessingProgress importComplete={importComplete} />
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <ProcessingForm
            initialIncome={initialIncome}
            initialRent={initialRent}
            currencySymbol={currencySymbol}
            importComplete={importComplete}
            onAdvance={(redirectTo) => router.push(redirectTo)}
          />
        </div>
      </div>
    </div>
  )
}
