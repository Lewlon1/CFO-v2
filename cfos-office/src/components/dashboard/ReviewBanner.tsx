'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReviewStatus } from '@/app/api/dashboard/summary/route'

type Props = {
  reviewStatus: ReviewStatus
  month: string // YYYY-MM-01 format
}

function formatMonthName(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const date = new Date(y, m - 1)
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export function ReviewBanner({ reviewStatus, month }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  if (reviewStatus.reviewed) {
    if (!reviewStatus.conversation_id) return null
    return (
      <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-muted/50 border border-border text-sm">
        <span className="text-muted-foreground">
          {formatMonthName(month)} reviewed
        </span>
        <button
          onClick={() => router.push(`/chat/${reviewStatus.conversation_id}`)}
          className="text-primary hover:underline font-medium min-h-[44px] min-w-[44px] flex items-center"
        >
          View review
        </button>
      </div>
    )
  }

  async function startReview() {
    setLoading(true)
    try {
      const res = await fetch('/api/review/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: month.slice(0, 7) }),
      })
      const data = await res.json()
      if (data.conversationId) {
        router.push(`/chat/${data.conversationId}`)
      }
    } catch {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-primary/5 border border-primary/20">
      <span className="text-sm font-medium text-foreground">
        {formatMonthName(month)}{' '}hasn&apos;t been reviewed yet
      </span>
      <button
        onClick={startReview}
        disabled={loading}
        className="text-sm font-medium text-primary hover:text-primary/80 min-h-[44px] min-w-[44px] flex items-center disabled:opacity-50"
      >
        {loading ? 'Starting...' : 'Start Review →'}
      </button>
    </div>
  )
}
