'use client'

import { ProcessingForm } from '@/components/onboarding-v2/processing-form'
import { ProcessingProgress } from '@/components/onboarding-v2/processing-progress'

type Props = {
  currency: string
  initialIncome: number | null
  initialRent: number | null
  /** Fires after the income/rent form advances (step is now details_pending). */
  onAdvance: () => void
  /** Skip-upload path — no import happened, so the progress strip is hidden. */
  noImport?: boolean
}

/**
 * In-sheet income/rent beat. This beat only mounts after /api/upload has
 * responded, and that route awaits the whole pipeline (import, enrichment,
 * snapshots, recurring detection) before returning — so the import is a done
 * fact by the time anything here renders. The progress strip lands straight on
 * "Ready when you are" as a completion cue, and Continue gates on the two
 * numbers only. (An earlier port kept a 30s timer from the old orchestrator,
 * where the parse genuinely ran in parallel — that wait had nothing behind it
 * here.)
 */
export function EssentialsBeatBlock({ currency, initialIncome, initialRent, onAdvance, noImport }: Props) {
  return (
    <div className="px-4 py-4 space-y-6">
      {!noImport && <ProcessingProgress importComplete />}
      <ProcessingForm
        initialIncome={initialIncome}
        initialRent={initialRent}
        currency={currency}
        importComplete
        noImport={noImport}
        onAdvance={onAdvance}
      />
    </div>
  )
}
