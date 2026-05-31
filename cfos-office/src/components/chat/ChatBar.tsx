'use client'

import { Send } from 'lucide-react'
import { useChatContext } from './ChatProvider'

export function ChatBar() {
  const { openSheet } = useChatContext()

  return (
    <div className="shrink-0 bg-bg-base z-10" data-chat-bar>
      <button
        onClick={openSheet}
        className="flex items-center gap-2 w-full px-4 pt-1 pb-2"
        aria-label="Open chat"
      >
        <div className="flex-1 flex items-center h-10 px-3 rounded-control bg-muted border border-border-medium">
          <span className="text-[13px] text-text-muted">Ask your CFO&hellip;</span>
        </div>
        <div className="w-7 h-7 flex items-center justify-center rounded-full bg-accent-gold-bg shrink-0">
          <Send size={14} className="text-accent-gold" />
        </div>
      </button>
      {/* Divider */}
      <div className="h-px bg-border-subtle mx-4" />
    </div>
  )
}
