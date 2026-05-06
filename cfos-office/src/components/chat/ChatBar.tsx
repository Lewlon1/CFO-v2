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
        <div className="flex-1 flex items-center h-10 px-3 rounded-[10px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)]">
          <span className="text-[13px] text-[rgba(245,245,240,0.2)]">Ask your CFO&hellip;</span>
        </div>
        <div className="w-7 h-7 flex items-center justify-center rounded-full bg-[rgba(232,168,76,0.15)] shrink-0">
          <Send size={14} className="text-accent-gold" />
        </div>
      </button>
      {/* Divider */}
      <div className="h-px bg-[rgba(255,255,255,0.04)] mx-4" />
    </div>
  )
}
