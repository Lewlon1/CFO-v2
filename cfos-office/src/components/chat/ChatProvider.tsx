'use client'

import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useRouter } from 'next/navigation'
import { useTrackEvent } from '@/lib/events/use-track-event'

// ── Context shape ─────────────────────────────────────────────────────────────

interface ChatContextValue {
  messages: UIMessage[]
  status: string
  input: string
  setInput: (v: string) => void
  handleSend: () => void
  sendChatMessage: (text: string) => void
  openSheet: () => void
  closeSheet: () => void
  isSheetOpen: boolean
  startConversation: (type?: string, metadata?: Record<string, string>) => void
  loadConversation: (id: string) => void
  conversationId: string | null
  chatError: string | null
  dismissError: () => void
  handleOptionSelect: (text: string) => void
  handleStructuredSubmit: (
    field: string,
    value: string | number,
    displayText: string,
  ) => void
  userCurrency?: string
}

export const ChatContext = createContext<ChatContextValue | null>(null)

export function useChatContext() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChatContext must be used inside <ChatProvider>')
  return ctx
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface ChatProviderProps {
  children: ReactNode
  userCurrency?: string
}

export function ChatProvider({ children, userCurrency }: ChatProviderProps) {
  const router = useRouter()
  const trackEvent = useTrackEvent()

  // Sheet visibility
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  // Conversation state
  const [conversationId, setConversationId] = useState<string | null>(null)
  const conversationIdRef = useRef(conversationId)
  conversationIdRef.current = conversationId

  const [input, setInput] = useState('')
  const [chatError, setChatError] = useState<string | null>(null)

  // Conversation type — set when starting a typed conversation (nudge, review, etc.)
  const conversationTypeRef = useRef<string | undefined>(undefined)
  const conversationMetadataRef = useRef<Record<string, string> | undefined>(
    undefined,
  )
  const autoTriggeredRef = useRef(false)
  const initialLoadDone = useRef(false)

  // ── useChat hook ──────────────────────────────────────────────────────────

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      body: () => ({
        conversationId: conversationIdRef.current,
        ...(!conversationIdRef.current && conversationTypeRef.current
          ? { conversationType: conversationTypeRef.current }
          : {}),
        ...(!conversationIdRef.current && conversationMetadataRef.current
          ? { conversationMetadata: conversationMetadataRef.current }
          : {}),
      }),
    }),
    onError: (error) => {
      const msg = error?.message || ''
      if (msg.includes('429') || msg.toLowerCase().includes('busy')) {
        setChatError('Too many requests. Please wait a moment and try again.')
      } else if (msg.includes('504') || msg.toLowerCase().includes('timeout')) {
        setChatError('Response timed out. Please try again.')
      } else {
        setChatError('Something went wrong. Please try again.')
      }
    },
    onFinish: ({ messages: finishedMessages }) => {
      // Extract conversationId from assistant metadata
      const lastAssistant = [...finishedMessages]
        .reverse()
        .find((m) => m.role === 'assistant')
      if (
        lastAssistant?.metadata &&
        typeof lastAssistant.metadata === 'object' &&
        'conversationId' in lastAssistant.metadata &&
        lastAssistant.metadata.conversationId
      ) {
        const newId = lastAssistant.metadata.conversationId as string
        if (!conversationIdRef.current || conversationIdRef.current !== newId) {
          setConversationId(newId)
        }
      }

      // Refresh layout if profile was updated via tool
      const profileUpdated = finishedMessages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.parts) &&
          m.parts.some(
            (p: { type: string; state?: string }) =>
              p.type === 'tool-update_user_profile' &&
              p.state === 'output-available',
          ),
      )
      if (profileUpdated) {
        router.refresh()
      }
    },
  })

  // ── Load most recent conversation on mount ────────────────────────────────

  useEffect(() => {
    if (initialLoadDone.current) return
    initialLoadDone.current = true

    fetch('/api/conversations/recent')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.conversation) {
          setConversationId(data.conversation.id)
          if (data.messages?.length > 0) {
            setMessages(data.messages)
          }
        }
      })
      .catch((err) => {
        // A non-OK response is already handled (returns null upstream and
        // we just don't load a conversation). This catch only fires on
        // network/parse failures, which are real problems — log them.
        console.error('[ChatProvider] failed to load recent conversation', err)
      })
  }, [setMessages])

  // ── Auto-trigger for typed conversations ──────────────────────────────────

  const pendingTriggerRef = useRef<{
    type: string
    metadata?: Record<string, string>
  } | null>(null)

  useEffect(() => {
    const pending = pendingTriggerRef.current
    if (!pending) return
    if (messages.length > 0 || status !== 'ready') return

    pendingTriggerRef.current = null
    autoTriggeredRef.current = true

    const type = pending.type
    let trigger: string

    if (type === 'onboarding') {
      trigger =
        '[System: New user just completed the Value Map and signed up. Deliver your first-meeting welcome per your conversation instructions. Reference their archetype in one line, then prompt them to upload a recent bank statement so you can show them what is actually going on with their money. Include the markdown link [Upload your transactions](/transactions). Maximum 4 sentences. Do not mention sample data or the Value Map mechanics.]'
    } else if (type === 'onboarding_no_vm') {
      trigger =
        '[System: New user who signed up directly. Welcome them briefly, then suggest the Value Map as a quick way to get started — "a 2-minute exercise that helps me understand how you think about money." You MUST include this exact markdown link in your response: [Try the Value Map](/demo). If they want to skip it, that is fine.]'
    } else if (type === 'value_map_complete') {
      trigger =
        '[System: Value Map just completed. Deliver your Gap analysis — compare their stated values with their actual spending now.]'
    } else if (type === 'monthly_review') {
      trigger =
        '[System: Monthly review started. Begin with Phase 1 — the headline number.]'
    } else if (type === 'bill_optimisation') {
      trigger =
        '[System: User wants to discuss a specific bill. Review the bill details in your context and open with a focused observation — cost vs market, contract status, or an obvious saving opportunity.]'
    } else if (type === 'nudge_initiated') {
      const nudgeType = pending.metadata?.nudge_type ?? 'general'
      trigger = `[System: User arrived via ${nudgeType} nudge. Open the conversation proactively.]`
    } else if (type === 'value_checkin_done') {
      const count = pending.metadata?.checkin_count ?? 'several'
      trigger = `[System: User just finished a value check-in — they classified ${count} transactions. Acknowledge what you learned in 2 sentences. Reference one specific insight if visible in your review context (e.g. "so your Friday night takeaways are Leaks, not Foundation"). Do NOT list everything they classified. Keep it warm and brief, then offer to discuss anything on their mind.]`
    } else if (type === 'chip_opener') {
      const prompt = pending.metadata?.prompt
      trigger = prompt
        ? `[System: User just completed onboarding and tapped "${prompt}" as their first action. Respond to this directly — treat it as their opening message. Follow the first-post-onboarding instructions.]`
        : '[System: User completed onboarding. Welcome them briefly and ask what they want to work on.]'
    } else if (type === 'experiment_template') {
      const title = pending.metadata?.title ?? 'their experiment'
      trigger = `[System: User tapped "Yes, draft it for me" on the experiment card for "${title}". Deliver the template per your conversation instructions. No clarifying questions — draft first.]`
    } else {
      trigger =
        '[System: Post-upload analysis triggered. Deliver your first insight.]'
    }

    sendMessage({ text: trigger })
  }, [messages.length, status, sendMessage])

  // ── Actions ───────────────────────────────────────────────────────────────

  const openSheet = useCallback(() => {
    setIsSheetOpen(true)
    trackEvent('chat_bar_expanded', 'engagement')
  }, [trackEvent])

  const closeSheet = useCallback(() => {
    setIsSheetOpen(false)
  }, [])

  const startConversation = useCallback(
    (type?: string, metadata?: Record<string, string>) => {
      // Reset state for a new conversation
      setConversationId(null)
      conversationIdRef.current = null
      setMessages([])
      autoTriggeredRef.current = false
      conversationTypeRef.current = type
      conversationMetadataRef.current = metadata
      setChatError(null)
      setInput('')

      // If this is a typed conversation that needs auto-trigger, queue it
      const autoTriggerTypes = [
        'first_insight',
        'post_upload',
        'value_map_complete',
        'monthly_review',
        'bill_optimisation',
        'nudge_initiated',
        'onboarding',
        'onboarding_no_vm',
        'value_checkin_done',
        'chip_opener',
        'experiment_template',
      ]
      if (type && autoTriggerTypes.includes(type)) {
        pendingTriggerRef.current = { type, metadata }
      }

      setIsSheetOpen(true)
    },
    [setMessages],
  )

  const loadConversation = useCallback(
    (id: string) => {
      setConversationId(id)
      conversationIdRef.current = id
      conversationTypeRef.current = undefined
      conversationMetadataRef.current = undefined
      autoTriggeredRef.current = false
      setChatError(null)
      setInput('')

      // Fetch messages for this conversation
      fetch(`/api/conversations/recent?id=${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.messages) {
            setMessages(data.messages)
          }
        })
        .catch((err) => {
          // If the fetch fails the UI stays on the previously loaded
          // conversation. Log so a flaky API is at least visible in the
          // console during development.
          console.error('[ChatProvider] failed to load conversation messages', err)
        })
    },
    [setMessages],
  )

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text) return
    setChatError(null)
    setInput('')
    trackEvent('message_sent')
    sendMessage({ text })
  }, [input, sendMessage, trackEvent])

  // Direct send (used by quick action pills, option selects, etc.)
  const sendChatMessage = useCallback(
    (text: string) => {
      setChatError(null)
      trackEvent('message_sent')
      sendMessage({ text })
    },
    [sendMessage, trackEvent],
  )

  const handleOptionSelect = useCallback(
    (text: string) => {
      // Profiling agreement buttons need a system trigger to force the tool call.
      const isProfilingAgreement =
        /let.s do a few now|sure.*profile|do.*now/i.test(text)
      if (isProfilingAgreement) {
        sendMessage({
          text: '[System: User agreed to profiling. IMMEDIATELY call request_structured_input with field="net_monthly_income", input_type="currency_amount", label="What\'s your monthly take-home pay?", rationale="Helps me tell you whether your spending patterns are sustainable". Do not output any text before the tool call — just call the tool now.]',
        })
      } else {
        sendMessage({ text })
      }
    },
    [sendMessage],
  )

  const handleStructuredSubmit = useCallback(
    async (field: string, value: string | number, displayText: string) => {
      await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value }),
      })
      sendMessage({ text: displayText })
    },
    [sendMessage],
  )

  const dismissError = useCallback(() => setChatError(null), [])

  // ── Context value ─────────────────────────────────────────────────────────

  const value: ChatContextValue = {
    messages,
    status,
    input,
    setInput,
    handleSend,
    sendChatMessage,
    openSheet,
    closeSheet,
    isSheetOpen,
    startConversation,
    loadConversation,
    conversationId,
    chatError,
    dismissError,
    handleOptionSelect,
    handleStructuredSubmit,
    userCurrency,
  }

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}
