'use client'

import { useChatContext } from '@/components/chat/ChatProvider'

export function GoalsEmptyStateCTA() {
  const { setInput, openSheet } = useChatContext()

  return (
    <button
      type="button"
      onClick={() => {
        setInput("I'd like to set a financial goal")
        openSheet()
      }}
      className="inline-flex items-center justify-center rounded-lg bg-accent-gold px-4 py-2.5 text-[12px] font-semibold text-bg-base hover:bg-accent-gold/90 transition-colors"
    >
      Chat with your CFO
    </button>
  )
}
