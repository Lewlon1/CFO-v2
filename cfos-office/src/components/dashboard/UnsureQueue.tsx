'use client'

import Link from 'next/link'
import { ClipboardList } from 'lucide-react'

type Props = {
  count: number
}

export function UnsureQueue({ count }: Props) {
  if (count <= 0) return null

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
        <ClipboardList className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          {count} transaction{count !== 1 ? 's' : ''} need{count === 1 ? 's' : ''} your input
        </p>
        <p className="text-xs text-muted-foreground">
          Help your CFO understand what these mean to you
        </p>
      </div>
      <Link
        href="/transactions?value_category=unsure"
        className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium min-h-[44px] inline-flex items-center flex-shrink-0"
      >
        Classify now
      </Link>
    </div>
  )
}
