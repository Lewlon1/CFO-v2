'use client'

import { useChatContext } from './ChatProvider'
import { useTrackEvent } from '@/lib/events/use-track-event'

interface Pill {
  label: string
  message: string
  conversationType?: string
}

const PILLS: Pill[] = [
  {
    label: 'What am I wasting money on?',
    message: 'Look at my spending data — what am I wasting money on? Be specific.',
  },
  {
    label: 'How did I do this month?',
    message: "Let's do a monthly review. How did my spending look this month compared to last?",
    conversationType: 'monthly_review',
  },
  {
    label: 'Help me plan a trip',
    message: 'I want to plan a trip. Can you help me figure out the budget and how to fund it from my current cash flow?',
    conversationType: 'trip_planning',
  },
]

export function QuickActionPills() {
  const { openSheet, startConversation, sendChatMessage } = useChatContext()
  const trackEvent = useTrackEvent()

  const handleTap = (pill: Pill) => {
    trackEvent('quick_action_tapped', 'engagement', { action_text: pill.label })

    if (pill.conversationType) {
      // Typed conversations use startConversation which handles auto-trigger
      startConversation(pill.conversationType)
    } else {
      // Regular message — open sheet and send
      openSheet()
      sendChatMessage(pill.message)
    }
  }

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide pl-[38px]">
      {PILLS.map((pill) => (
        <button
          key={pill.label}
          onClick={() => handleTap(pill)}
          className="whitespace-nowrap px-3 py-1.5 rounded-full bg-office-bg-tertiary border border-office-border-subtle text-xs text-office-text-secondary hover:text-office-text hover:border-office-border transition-colors min-h-[44px] shrink-0"
        >
          {pill.label}
        </button>
      ))}
    </div>
  )
}
