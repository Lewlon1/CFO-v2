'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { useChatContext } from '@/components/chat/ChatProvider'
import { remapActionUrl } from '@/lib/nudges/remap-action-url'
import { useTrackEvent } from '@/lib/events/use-track-event'

interface Nudge {
  id: string
  type: string
  title: string
  body: string
  action_url: string | null
  status: string
  read_at: string | null
  created_at: string
}

interface NudgeGroup {
  label: string
  nudges: Nudge[]
}

interface InboxClientProps {
  groups: NudgeGroup[]
  unreadCount: number
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
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
}

export function InboxClient({ groups, unreadCount }: InboxClientProps) {
  const router = useRouter()
  const { openSheet, startConversation } = useChatContext()
  const trackEvent = useTrackEvent()

  useEffect(() => {
    trackEvent('inbox_viewed', 'engagement', { unread_count: unreadCount })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleNudgeTap = async (nudge: Nudge) => {
    trackEvent('inbox_item_tapped', 'engagement', {
      nudge_id: nudge.id,
      nudge_type: nudge.type,
    })

    // Mark as read
    if (!nudge.read_at) {
      await fetch('/api/nudges', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: nudge.id, status: 'read' }),
      }).catch(() => {})
    }

    // Navigate based on remapped action URL
    const action = remapActionUrl(nudge.action_url)
    if (action.type === 'chat') {
      startConversation(action.chatType, action.metadata)
    } else {
      router.push(action.target)
    }
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <CFOAvatar size={38} />
        <p className="mt-4 text-sm text-office-text">Nothing here yet</p>
        <p className="mt-1 text-xs text-office-text-muted max-w-[280px]">
          Your CFO will drop you a note when there&apos;s something worth
          knowing.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-6">
      {groups.map((group) => (
        <div key={group.label}>
          <h3 className="text-xs font-medium text-office-text-muted uppercase tracking-wider mb-2 px-1">
            {group.label}
          </h3>
          <div className="space-y-1">
            {group.nudges.map((nudge) => {
              const isUnread = !nudge.read_at

              return (
                <button
                  key={nudge.id}
                  onClick={() => handleNudgeTap(nudge)}
                  className={`w-full text-left px-4 py-3 rounded-lg hover:bg-office-bg-secondary transition-colors min-h-[44px] ${
                    isUnread
                      ? 'border-l-2 border-office-gold bg-office-bg-secondary/30'
                      : 'border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm truncate ${
                          isUnread
                            ? 'text-office-text font-medium'
                            : 'text-office-text-secondary'
                        }`}
                      >
                        {nudge.title}
                      </p>
                      <p className="text-xs text-office-text-muted truncate mt-0.5">
                        {nudge.body}
                      </p>
                    </div>
                    <span className="text-[10px] text-office-text-muted shrink-0 mt-0.5 font-data">
                      {timeAgo(nudge.created_at)}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
