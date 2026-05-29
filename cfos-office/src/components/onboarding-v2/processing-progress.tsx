'use client'

import { useEffect, useState } from 'react'

type Stage =
  | 'reading_csv'
  | 'categorising'
  | 'detecting_recurring'
  | 'crunching'
  | 'ready'

const STAGE_COPY: Record<Stage, { label: string; pct: number }> = {
  reading_csv: { label: 'Reading your statement…', pct: 18 },
  categorising: { label: 'Sorting transactions…', pct: 42 },
  detecting_recurring: { label: 'Spotting recurring spend…', pct: 70 },
  crunching: { label: 'Crunching the numbers…', pct: 90 },
  ready: { label: 'Ready when you are.', pct: 100 },
}

type Props = {
  /** True once the background import pipeline has signalled completion. */
  importComplete: boolean
}

/**
 * Decorative progress strip for the processing screen. The actual import
 * pipeline runs server-side in /api/upload — we don't have fine-grained
 * progress events to bind to, so the stages advance on a soft schedule
 * that lands at 'ready' when `importComplete` flips true. The user is
 * filling out the income/rent form alongside this; the strip is reassurance,
 * not load-bearing UX.
 */
export function ProcessingProgress({ importComplete }: Props) {
  const [stage, setStage] = useState<Stage>('reading_csv')

  useEffect(() => {
    if (importComplete) {
      setStage('ready')
      return
    }
    const t1 = setTimeout(() => setStage('categorising'), 1500)
    const t2 = setTimeout(() => setStage('detecting_recurring'), 4500)
    const t3 = setTimeout(() => setStage('crunching'), 8000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [importComplete])

  const { label, pct } = STAGE_COPY[stage]

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="text-sm text-text-secondary">{label}</p>
        <p className="text-xs text-text-muted tabular-nums">{pct}%</p>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--bg-muted)] overflow-hidden">
        <div
          className="h-full bg-text-primary transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
