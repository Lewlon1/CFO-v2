'use client'

import { useEffect, useState } from 'react'
import { ProcessingForm } from '@/components/onboarding-v2/processing-form'
import { ProcessingProgress } from '@/components/onboarding-v2/processing-progress'
import { moneySymbol } from '@/lib/utils/money'

type Props = {
  currency: string
  initialIncome: number | null
  initialRent: number | null
  /** Fires after the income/rent form advances (step is now details_pending). */
  onAdvance: () => void
}

// Hard cap on the perceived parse wait — the background pipeline continues
// regardless; this just unblocks Continue so a slow snapshot refresh doesn't
// trap the user behind the form. Ported from the old ProcessingOrchestrator.
const IMPORT_GRACE_MS = 30_000

/**
 * In-sheet income/rent beat. Hosts the kept progress bar alongside the
 * income/rent form (both reused from the old /onboarding-v2/processing page)
 * so the statement parse is overlapped with two quick numbers rather than a
 * dead spinner. ProcessingForm already takes an onAdvance callback and runs
 * advanceToConfirm itself, so we just react to it.
 */
export function EssentialsBeatBlock({ currency, initialIncome, initialRent, onAdvance }: Props) {
  const [importComplete, setImportComplete] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setImportComplete(true), IMPORT_GRACE_MS)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="px-4 py-4 space-y-6">
      <ProcessingProgress importComplete={importComplete} />
      <ProcessingForm
        initialIncome={initialIncome}
        initialRent={initialRent}
        currencySymbol={moneySymbol(currency)}
        importComplete={importComplete}
        onAdvance={onAdvance}
      />
    </div>
  )
}
