'use client'

import type { ValueCategorySummary } from '@/app/api/dashboard/summary/route'

type Props = {
  breakdown: Record<string, ValueCategorySummary>
}

export function ValueSummary({ breakdown }: Props) {
  const parts: string[] = []

  if (breakdown.foundation?.pct > 0) {
    parts.push(`${Math.round(breakdown.foundation.pct)}% goes to things you need (Foundation)`)
  }
  if (breakdown.investment?.pct > 0) {
    parts.push(`${Math.round(breakdown.investment.pct)}% builds your future (Investment)`)
  }
  if (breakdown.leak?.pct > 0) {
    parts.push(`${Math.round(breakdown.leak.pct)}% drains without return (Leak)`)
  }
  if (breakdown.burden?.pct > 0) {
    parts.push(`${Math.round(breakdown.burden.pct)}% you endure but resent (Burden)`)
  }

  if (parts.length === 0) return null

  return (
    <p className="text-sm text-muted-foreground leading-relaxed">
      {parts.join(', ')}.
    </p>
  )
}
