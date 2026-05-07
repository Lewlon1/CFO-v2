'use client'

import { Scale } from 'lucide-react'
import { useChatContext } from '@/components/chat/ChatProvider'

type Props = {
  onUploadClick: () => void
}

export function EmptyState({ onUploadClick }: Props) {
  let chatCtx: ReturnType<typeof useChatContext> | null = null
  try {
    chatCtx = useChatContext()
  } catch {
    // Not inside ChatProvider
  }

  function handleStartConversation() {
    if (chatCtx) {
      chatCtx.startConversation('balance_sheet_setup')
      chatCtx.setInput("I'd like to set up my balance sheet — what do you need to know?")
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <Scale className="w-6 h-6 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-2">
        Your CFO doesn&apos;t know what you own or owe yet
      </h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm">
        Start by telling your CFO about your savings, investments, or debts in a conversation, or
        upload a statement below.
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={handleStartConversation}
          className="rounded-md bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium min-h-[44px] inline-flex items-center justify-center"
        >
          Start a conversation
        </button>
        <button
          type="button"
          onClick={onUploadClick}
          className="rounded-md border border-border px-5 py-2.5 text-sm font-medium min-h-[44px] inline-flex items-center justify-center text-foreground hover:bg-accent transition-colors"
        >
          Upload a document
        </button>
      </div>
    </div>
  )
}
