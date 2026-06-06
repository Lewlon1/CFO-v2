'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { X, MoreVertical, Plus, MessageSquare, ArrowRight } from 'lucide-react'
import { useChatContext } from './ChatProvider'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { CfoThinking } from '@/components/brand/CfoThinking'
import useSWR from 'swr'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { CHAT_SUBJECTS, getFolderChatMeta, type FolderKey } from '@/lib/chat/folder-prompts'
import type { PostureProfile } from '@/lib/analytics/posture-helpers'
import { OnboardingBeatHost } from '@/components/onboarding-v2/in-sheet/onboarding-beat-host'
import { StruggleBeatBlock } from '@/components/onboarding-v2/in-sheet/struggle-beat-block'
import { IN_SHEET_BEAT_STEPS } from '@/lib/onboarding-v2/in-sheet-steps'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'

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
    handleLabelTransactionsSubmit,
    chatError,
    dismissError,
    isLoadingConversation,
    userCurrency,
    currentFolder,
    conversationId,
    conversationType,
    registerFirstReadDelivery,
    onboardingStep,
    needsEntryStruggle,
  } = useChatContext()

  const onboardingBeatActive = IN_SHEET_BEAT_STEPS.has(onboardingStep ?? '')

  const [menuOpen, setMenuOpen] = useState(false)
  const [showConversations, setShowConversations] = useState(false)
  const [conversations, setConversations] = useState<
    Array<{ id: string; title: string | null; updated_at: string }>
  >([])
  const sheetRef = useRef<HTMLDivElement>(null)

  // Anchor sheet to the visual viewport so the chat input stays pinned above
  // the iOS keyboard. iOS fires BOTH `resize` (when the keyboard appears/disappears)
  // AND `scroll` (when the OS shifts the viewport to bring a focused input into
  // view). Missing either event lets the sheet drift out of alignment — the input
  // appears to scroll off screen. We set `position/top/height` inline so they
  // override the Tailwind `items-start` positioning on the parent.
  useEffect(() => {
    if (!isSheetOpen) return
    const vv = window.visualViewport
    if (!vv) return
    const el = sheetRef.current
    if (!el) return

    const apply = () => {
      // 92% of the visible viewport so the backdrop peeks through at the top.
      el.style.position = 'fixed'
      el.style.top = `${vv.offsetTop}px`
      el.style.height = `${vv.height * 0.92}px`
      el.style.maxHeight = 'none'
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      // Reset inline styles so the next open re-applies cleanly.
      if (el) {
        el.style.position = ''
        el.style.top = ''
        el.style.height = ''
        el.style.maxHeight = ''
      }
    }
  }, [isSheetOpen])

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
      .catch((err) => {
        // On failure the list stays empty — user can still start a new
        // conversation. Log so a flaky endpoint is visible.
        console.error('[ChatSheet] failed to load conversation list', err)
      })
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
      className="fixed inset-0 z-50 flex items-start"
      onClick={handleBackdropClick}
      data-chat-sheet
      data-state="open"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/55" style={{ transition: 'opacity 200ms ease' }} />

      {/* Sheet — drops from top */}
      {/* eslint-disable no-restricted-syntax -- theme-agnostic drop shadow; no --shadow token exists (single use) */}
      <div
        ref={sheetRef}
        className="chat-sheet-scope relative w-full bg-bg-elevated rounded-b-[20px] flex flex-col animate-sheet-down shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-enable no-restricted-syntax */}
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-1 shrink-0 bg-bg-base">
          <CFOAvatar size={44} withOnlineDot />
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-text-primary">Your CFO</p>
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
              <div className="absolute right-0 top-full mt-1 w-52 bg-bg-elevated border border-border-medium rounded-control shadow-lg z-10 py-1">
                <button
                  onClick={handleNewConversation}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-text-primary hover:bg-tap-highlight min-h-[44px]"
                >
                  <Plus size={16} />
                  New conversation
                </button>
                <button
                  onClick={handleShowConversations}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-[13px] text-text-primary hover:bg-tap-highlight min-h-[44px]"
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
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-text-tertiary hover:text-office-text"
            aria-label="Close chat"
          >
            <X size={20} />
          </button>
        </div>

        {/* Status line */}
        <div className="flex items-center gap-3 px-4 pt-1 pb-2.5 bg-bg-base border-b border-border-medium">
          <span className="text-[13px] text-text-secondary flex-1">Your CFO is online</span>
        </div>

        {/* Content */}
        {showConversations ? (
          <ConversationList
            conversations={conversations}
            onBack={() => setShowConversations(false)}
          />
        ) : needsEntryStruggle ? (
          // Folded entry beat — the CFO's "what brought you in?" opening,
          // in-sheet instead of a full-page screen.
          <div className="flex-1 min-h-0 overflow-y-auto">
            <StruggleBeatBlock />
          </div>
        ) : onboardingBeatActive ? (
          // Deterministic onboarding beat (upload → essentials → confirm →
          // Read handoff) renders in-sheet instead of the message list. No
          // free-text input during a beat — each block carries its own controls.
          <div className="flex-1 min-h-0 overflow-y-auto">
            <OnboardingBeatHost
              step={onboardingStep as OnboardingStep | null}
              currency={userCurrency ?? 'EUR'}
            />
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {messages.length === 0 ? (
                // A conversation is loading or its opener is composing — show
                // the working state, not the generic folder prompts. Without
                // this the prompts flash before an auto-opened conversation
                // (e.g. the goal beat) arrives.
                isLoadingConversation ||
                status === 'submitted' ||
                status === 'streaming' ? (
                  <CfoThinking variant="block" className="pt-10" />
                ) : (
                  <FolderEmptyState folder={currentFolder} onFillInput={setInput} />
                )
              ) : (
                <MessageList
                  messages={messages}
                  status={status}
                  onOptionSelect={handleOptionSelect}
                  onStructuredSubmit={handleStructuredSubmit}
                  onLabelTransactionsSubmit={handleLabelTransactionsSubmit}
                  userCurrency={userCurrency}
                  conversationId={conversationId}
                  conversationType={conversationType}
                  registerFirstReadDelivery={registerFirstReadDelivery}
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

        {/* Drag handle — at bottom */}
        <div className="flex justify-center py-1.5 shrink-0" onClick={closeSheet}>
          <div className="w-9 h-1 rounded-full bg-card cursor-pointer" />
        </div>
      </div>
    </div>
  )
}

// ── Contextual empty state — folder-aware subject + pre-prompts ────────────

const postureProfileFetcher = async (url: string): Promise<PostureProfile | null> => {
  const res = await fetch(url)
  if (!res.ok) return null
  return res.json() as Promise<PostureProfile>
}

function FolderEmptyState({
  folder,
  onFillInput,
}: {
  folder: FolderKey
  onFillInput: (text: string) => void
}) {
  // Same SWR key as CashFlowDashboard — deduped by useSWR.
  const { data: postureProfile } = useSWR<PostureProfile | null>(
    '/api/profile/income-shape',
    postureProfileFetcher,
  )
  const meta = getFolderChatMeta(folder, postureProfile ?? null) ?? CHAT_SUBJECTS.home

  return (
    <div className="px-4 pt-4 pb-6">
      <div className="text-[18px] leading-tight tracking-[-0.01em] text-office-text"
        style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}
      >
        {meta.subject}
      </div>
      <div className="text-[11px] text-text-secondary italic mt-0.5">
        {meta.subtitle}
      </div>

      <div className="h-px bg-border-medium my-4" />

      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-office-gold mb-2.5">
        Things you could ask
      </div>
      <div className="flex flex-col gap-1.5">
        {meta.prompts.map((prompt, i) => (
          <button
            key={prompt}
            onClick={() => onFillInput(prompt)}
            className="flex items-center gap-2 text-left px-3 py-[10px] bg-tap-highlight border border-border-medium rounded-control hover:border-office-gold transition-colors min-h-[44px]"
          >
            <span className="text-[10px] text-text-muted font-medium shrink-0 tabular-nums">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="flex-1 text-[13px] text-office-text leading-snug">{prompt}</span>
            <ArrowRight size={12} className="text-text-muted shrink-0" strokeWidth={1.5} />
          </button>
        ))}
      </div>

      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted mt-5">
        Or ask your own
      </div>
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
