'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useChatContext } from '@/components/chat/ChatProvider'
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

  // ChatContext is optional — ReviewBanner may render outside the office layout.
  // When present, we open the persistent chat sheet rather than navigating to /chat/{id},
  // because that URL is 301-redirected to /office and the conversation ID would be dropped.
  let chatCtx: ReturnType<typeof useChatContext> | null = null
  try {
    chatCtx = useChatContext()
  } catch {
    // Not inside ChatProvider — fall back to router.push('/office')
  }

  function openConversation(conversationId: string) {
    if (chatCtx) {
      chatCtx.loadConversation(conversationId)
      chatCtx.openSheet()
    } else {
      // No chat context — conversation can't be carried via URL (301 redirect drops it).
      // At least land the user in the office; they can find the conversation in history.
      router.push('/office')
    }
  }

  if (reviewStatus.reviewed) {
    if (!reviewStatus.conversation_id) return null
    const conversationId = reviewStatus.conversation_id
    return (
      <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-muted/50 border border-border text-sm">
        <span className="text-muted-foreground">
          {formatMonthName(month)} reviewed
        </span>
        <button
          onClick={() => openConversation(conversationId)}
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
        openConversation(data.conversationId)
      }
    } finally {
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
