'use client'

import Link from 'next/link'

export function EmptyBillsState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="text-4xl mb-4">📋</div>
      <h2 className="text-lg font-semibold text-foreground mb-2">No bills tracked yet</h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        Upload your first bill to get plan details and savings recommendations, or check
        the dashboard for detected recurring charges.
      </p>
      <div className="flex gap-3">
        <Link
          href="/dashboard"
          className="text-sm font-medium text-primary hover:text-primary/80 min-h-[44px] min-w-[44px] flex items-center"
        >
          View dashboard
        </Link>
      </div>
    </div>
  )
}
