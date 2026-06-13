'use client'

import { useEffect, useRef, useState } from 'react'
import { ProcessingProgress } from '@/components/onboarding-v2/processing-progress'

type Props = {
  /** Fires once the import has settled, so the host can advance to the confirm
   *  beat (check_confirm_pending). */
  onDone: () => void
}

// The statement import already landed (the upload beat's onDone advanced us
// here); this is a brief settle so the background aggregation + recurring
// detection finishes before the confirm beat reads the reconciled fixed costs.
// Unlike the value-first processing beat there is NO income/rent form — income
// and rent are already on file from the estimate flow.
const SETTLE_MS = 2500
const ADVANCE_DELAY_MS = 700

/**
 * Statement-check mission (OB-3) — progress-only beat. Shows the import progress
 * strip hitting "Ready", then auto-advances to the fixed-cost confirm beat. No
 * form: the only thing to do here is wait for the parse to settle.
 */
export function CheckProcessingBeatBlock({ onDone }: Props) {
  const [importComplete, setImportComplete] = useState(false)
  // Read the latest onDone via a ref so the one-shot timer effect below can use
  // empty deps — it must NOT reset its countdown when the host re-renders.
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    const t1 = setTimeout(() => setImportComplete(true), SETTLE_MS)
    const t2 = setTimeout(() => onDoneRef.current(), SETTLE_MS + ADVANCE_DELAY_MS)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  return (
    <div className="px-4 py-4 space-y-6">
      <div className="space-y-1">
        <h2 className="text-base font-medium text-text-primary leading-tight">
          Checking your month
        </h2>
        <p className="text-sm text-text-secondary leading-snug">
          Lining your statement up against the sketch you gave me.
        </p>
      </div>
      <ProcessingProgress importComplete={importComplete} />
    </div>
  )
}
