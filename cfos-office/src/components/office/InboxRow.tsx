'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CFOAvatar } from '@/components/brand/CFOAvatar'

interface Nudge {
  id: string
  title: string
  created_at: string
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000,
  )
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function InboxRow() {
  const router = useRouter()
  const [nudges, setNudges] = useState<Nudge[]>([])
  const [count, setCount] = useState(0)

  useEffect(() => {
    fetch('/api/nudges?status=pending&limit=5')
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((data) => {
        const items = data.data ?? data ?? []
        setNudges(items)
        setCount(items.length)
      })
      .catch(() => {})
  }, [])

  if (count === 0) return null

  const latest = nudges[0]

  return (
    <button
      onClick={() => router.push('/office/inbox')}
      className="w-full flex items-center gap-3 px-4 py-3 bg-office-bg-secondary/50 rounded-lg border border-office-border-subtle hover:bg-office-bg-secondary transition-colors min-h-[44px]"
    >
      <CFOAvatar size={22} />
      <span className="flex-1 text-sm text-office-text truncate text-left">
        {latest?.title ?? 'New message from your CFO'}
      </span>
      <span className="text-xs text-office-text-muted shrink-0">
        {latest ? timeAgo(latest.created_at) : ''}
      </span>
      {count > 0 && (
        <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-office-gold text-office-bg text-[10px] font-bold font-data shrink-0">
          {count}
        </span>
      )}
    </button>
  )
}
