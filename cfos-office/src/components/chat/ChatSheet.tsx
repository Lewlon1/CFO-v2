'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { X, MoreVertical, Plus, MessageSquare } from 'lucide-react'
import { useChatContext } from './ChatProvider'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { CFOAvatar } from '@/components/brand/CFOAvatar'

export function ChatSheet() {
  const {
    messages,
    status,
    input,
    setInput,
    handleSend,
    isSheetOpen,
    closeSheet,
    startConversation,
    handleOptionSelect,
    handleStructuredSubmit,
    chatError,
    dismissError,
    userCurrency,
  } = useChatContext()

  const [menuOpen, setMenuOpen] = useState(false)
  const [showConversations, setShowConversations] = useState(false)
  const [conversations, setConversations] = useState<
    Array<{ id: string; title: string | null; updated_at: string }>
  >([])
  const sheetRef = useRef<HTMLDivElement>(null)

  // Body scroll lock
  useEffect(() => {
    if (isSheetOpen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prev
      }
    }
  }, [isSheetOpen])

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-chat-menu]')) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [menuOpen])

  // Fetch conversations when list is shown
  useEffect(() => {
    if (!showConversations) return
    fetch('/api/conversations/recent?list=1')
      .then((r) => (r.ok ? r.json() : { conversations: [] }))
      .then((data) => {
        setConversations(data.conversations ?? [])
      })
      .catch(() => {})
  }, [showConversations])

  const handleNewConversation = useCallback(() => {
    setMenuOpen(false)
    setShowConversations(false)
    startConversation()
  }, [startConversation])

  const handleShowConversations = useCallback(() => {
    setMenuOpen(false)
    setShowConversations(true)
  }, [])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        closeSheet()
      }
    },
    [closeSheet],
  )

  if (!isSheetOpen) return null

  const errorBanner = chatError ? (
    <div className="px-4 py-2 bg-office-gold/10 border-t border-office-gold/20 text-office-gold text-sm flex items-center justify-between">
      <span>{chatError}</span>
      <button
        onClick={dismissError}
        className="ml-3 text-office-gold hover:text-office-text font-medium shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
      >
        Dismiss
      </button>
    </div>
  ) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      onClick={handleBackdropClick}
      data-chat-sheet
      data-state="open"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="chat-sheet-scope relative w-full max-h-[82dvh] bg-office-bg-secondary rounded-t-2xl flex flex-col animate-sheet-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 h-14 shrink-0 border-b border-office-border">
          <CFOAvatar size={28} withOnlineDot />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-office-text">Your CFO</p>
            <p className="text-[10px] text-office-text-muted font-data tracking-wide">
              Observes &middot; Calculates &middot; Educates
            </p>
          </div>

          {/* Menu */}
          <div className="relative" data-chat-menu>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-office-text-secondary hover:text-office-text"
              aria-label="Chat menu"
            >
              <MoreVertical size={18} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-office-bg-tertiary border border-office-border rounded-lg shadow-lg z-10 py-1">
                <button
                  onClick={handleNewConversation}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-office-text hover:bg-office-bg-secondary min-h-[44px]"
                >
                  <Plus size={16} />
                  New conversation
                </button>
                <button
                  onClick={handleShowConversations}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-office-text hover:bg-office-bg-secondary min-h-[44px]"
                >
                  <MessageSquare size={16} />
                  Previous conversations
                </button>
              </div>
            )}
          </div>

          {/* Close */}
          <button
            onClick={closeSheet}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-office-text-secondary hover:text-office-text"
            aria-label="Close chat"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        {showConversations ? (
          <ConversationList
            conversations={conversations}
            onBack={() => setShowConversations(false)}
          />
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {messages.length === 0 ? (
                <SheetEmptyState />
              ) : (
                <MessageList
                  messages={messages}
                  status={status}
                  onOptionSelect={handleOptionSelect}
                  onStructuredSubmit={handleStructuredSubmit}
                  userCurrency={userCurrency}
                />
              )}
            </div>
            {errorBanner}
            <ChatInput
              input={input}
              onInputChange={setInput}
              onSend={handleSend}
              disabled={status === 'submitted' || status === 'streaming'}
            />
          </>
        )}
      </div>
    </div>
  )
}

// ── Empty state when no messages ────────────────────────────────────────────

function SheetEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
      <CFOAvatar size={48} />
      <p className="mt-4 text-sm text-office-text">
        What&apos;s on your mind?
      </p>
      <p className="mt-1 text-xs text-office-text-muted">
        Ask about your spending, plan a trip, or just check in.
      </p>
    </div>
  )
}

// ── Conversation list view ──────────────────────────────────────────────────

function ConversationList({
  conversations,
  onBack,
}: {
  conversations: Array<{ id: string; title: string | null; updated_at: string }>
  onBack: () => void
}) {
  const { loadConversation } = useChatContext()

  const handleSelect = (id: string) => {
    loadConversation(id)
    onBack()
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-4 py-3 border-b border-office-border">
        <button
          onClick={onBack}
          className="text-sm text-office-text-secondary hover:text-office-text min-h-[44px] flex items-center gap-1"
        >
          &larr; Back
        </button>
      </div>
      {conversations.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-office-text-muted">
          No previous conversations
        </div>
      ) : (
        <div className="py-2">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => handleSelect(c.id)}
              className="w-full text-left px-4 py-3 hover:bg-office-bg-tertiary min-h-[44px] border-b border-office-border-subtle"
            >
              <p className="text-sm text-office-text truncate">
                {c.title ?? 'Untitled conversation'}
              </p>
              <p className="text-xs text-office-text-muted mt-0.5">
                {new Date(c.updated_at).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                })}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
