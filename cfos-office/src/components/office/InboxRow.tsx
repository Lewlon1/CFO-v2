'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
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
        const items = data.nudges ?? []
        setNudges(items)
        setCount(data.unread_count ?? items.length)
      })
      .catch(() => {})
  }, [])

  if (count === 0) return null

  const latest = nudges[0]

  return (
    <button
      onClick={() => router.push('/office/inbox')}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-[10px] border border-border-subtle hover:bg-tap-highlight transition-colors min-h-[48px]"
    >
      <div className="relative shrink-0">
        <CFOAvatar size={28} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-negative text-bg-base text-[8px] font-bold font-data">
            {count}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-text-primary">Inbox</span>
          <span className="font-data text-[9px] text-text-muted shrink-0">
            {latest ? timeAgo(latest.created_at) : ''}
          </span>
        </div>
        <p className="font-data text-[10px] text-text-tertiary truncate">
          {latest?.title ?? 'New message from your CFO'}
        </p>
      </div>
      <ChevronRight size={14} className="shrink-0 opacity-[0.15]" />
    </button>
  )
}
