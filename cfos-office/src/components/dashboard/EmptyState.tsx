'use client'

import Link from 'next/link'
import { BarChart3, Target } from 'lucide-react'

type Props = {
  variant: 'no_data' | 'no_values'
}

export function EmptyState({ variant }: Props) {
  if (variant === 'no_data') {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <BarChart3 className="w-6 h-6 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">Your dashboard is waiting for data</h2>
        <p className="text-sm text-muted-foreground mb-6 max-w-sm">
          Upload a bank statement to see your spending breakdown, track your values, and get insights.
        </p>
        <Link
          href="/transactions"
          className="rounded-md bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium min-h-[44px] inline-flex items-center"
        >
          Upload a statement
        </Link>
        <p className="text-xs text-muted-foreground mt-3">
          Supports: Revolut CSV, Santander, or screenshot of any bank app
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <Target className="w-6 h-6 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-2">Your Values View needs your input</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm">
        The Values View shows how your spending aligns with what matters to you. To get started, take the Value Map or classify some transactions manually.
      </p>
      <div className="flex gap-3">
        <Link
          href="/demo"
          className="rounded-md bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium min-h-[44px] inline-flex items-center"
        >
          Take the Value Map
        </Link>
        <Link
          href="/transactions?value_category=no_idea"
          className="rounded-md border border-border px-5 py-2.5 text-sm font-medium min-h-[44px] inline-flex items-center text-foreground hover:bg-accent transition-colors"
        >
          Classify now
        </Link>
      </div>
    </div>
  )
}
