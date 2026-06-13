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
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { folderKeyFromPath, type FolderKey } from '@/lib/chat/folder-prompts'
import type { OnboardingGoalSummary } from '@/lib/onboarding-v2/types'
import type { EstimateOnboardingContext } from '@/lib/onboarding-v2/estimate-context'
import { detectSubstantiveReply } from '@/lib/wow/event-tracker'
import {
  buildLabelRecapTrigger,
  type LabelTransactionsQuadrantId,
  type LabelTransactionsTransaction,
} from './LabelTransactionsBlock'

// Conversation types that should fire an auto-trigger when loaded with zero
// messages. Shared between `startConversation` (new conversation, client-side)
// and `loadConversation` (existing conversation, e.g. one created server-side
// by archetype-orchestrator + materialised via /api/insights/post-upload).
const AUTO_TRIGGER_TYPES = [
  'first_read',
  'post_upload',
  'value_map_complete',
  'monthly_review',
  'bill_optimisation',
  'nudge_initiated',
  'onboarding',
  'onboarding_no_vm',
  'onboarding_goal_chat',
  'value_checkin_done',
  'chip_opener',
] as const

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
  conversationType: string | null
  /** Wow plumbing: MessageList calls this when it renders the first-insight
   *  delivery. Used by handleSend to detect substantive replies within 5 min. */
  registerFirstReadDelivery: (ctx: {
    first_read_message_id: string
    conversation_id: string
  }) => void
  chatError: string | null
  dismissError: () => void
  /** True while a specific conversation is expected to materialise — the
   *  goal-beat auto-open, or an in-flight loadConversation fetch. Lets the
   *  sheet show a "working on this" state instead of the generic folder
   *  prompts during that window. */
  isLoadingConversation: boolean
  handleOptionSelect: (text: string) => void
  handleStructuredSubmit: (
    field: string,
    value: string | number,
    displayText: string,
  ) => void
  handleLabelTransactionsSubmit: (
    transactions: LabelTransactionsTransaction[],
    labels: Record<string, LabelTransactionsQuadrantId>,
  ) => void
  userCurrency?: string
  currentFolder: FolderKey
  /** Server-derived onboarding_step, threaded from the office layout. Drives
   *  the in-sheet onboarding beat host (deterministic, no LLM tool calls). */
  onboardingStep: string | null
  /** True for a brand-new user with no entry_struggle yet — the sheet opens
   *  on the in-sheet "what brought you in?" beat (folded entry). */
  needsEntryStruggle: boolean
  /** Active goal during the upload beat, threaded from the office layout so the
   *  bridge intro can acknowledge it by name. Null off-beat or on the skip path. */
  onboardingGoal: OnboardingGoalSummary | null
  /** Estimates-first onboarding bundle (OB-2): the knows-you score + the data
   *  the estimate beats render from. Null when the user isn't in that flow. */
  estimateOnboarding: EstimateOnboardingContext | null
}

export const ChatContext = createContext<ChatContextValue | null>(null)

export function useChatContext() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChatContext must be used inside <ChatProvider>')
  return ctx
}

/**
 * Non-throwing variant for components that may render outside <ChatProvider>
 * (e.g. dashboard banners, trips, balance-sheet on non-office routes).
 * Returns null when there is no provider — call it unconditionally.
 */
export function useOptionalChatContext() {
  return useContext(ChatContext)
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface ChatProviderProps {
  children: ReactNode
  userCurrency?: string
  /** Render the sheet open on the first paint. Set by the office layout when
   *  the user lands mid-goal-beat, so the office home never flashes behind the
   *  sheet while a post-paint effect opens it. */
  initialSheetOpen?: boolean
  /** Server-derived onboarding_step. Threaded to context for the in-sheet
   *  onboarding beat host. */
  onboardingStep?: string | null
  /** True when the user has not yet answered the entry struggle. */
  needsEntryStruggle?: boolean
  /** Active goal during the upload beat (see ChatContextValue). */
  onboardingGoal?: OnboardingGoalSummary | null
  /** Estimates-first onboarding bundle (OB-2). */
  estimateOnboarding?: EstimateOnboardingContext | null
}

export function ChatProvider({ children, userCurrency, initialSheetOpen, onboardingStep = null, needsEntryStruggle = false, onboardingGoal = null, estimateOnboarding = null }: ChatProviderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const trackEvent = useTrackEvent()
  const currentFolder = folderKeyFromPath(pathname)

  // Should the sheet be open on the very first paint? Two signals, both
  // resolved before paint so the office home never flashes behind the sheet:
  //   • initialSheetOpen — server-derived from onboarding_step, covers the
  //     goal-beat *refresh* (URL is bare /office; ?chat=open was stripped).
  //   • ?chat=open — covers every flow that redirects into the chat: the
  //     goal-beat first arrival and the value-map / archetype / first-read
  //     hand-offs. usePathname's sibling useSearchParams reads it consistently
  //     on server (the office layout is force-dynamic) and client, so there's
  //     no hydration mismatch.
  const wantsChatOpen =
    (initialSheetOpen ?? false) || searchParams.get('chat') === 'open'

  // Sheet visibility — seeded open when a chat-landing flow brought us here.
  const [isSheetOpen, setIsSheetOpen] = useState(wantsChatOpen)

  // Whether we expect a conversation to arrive imminently. Seeded true on a
  // chat landing so the first paint shows the loading state, not the folder
  // prompts; loadConversation toggles it around its fetch, and the recent-load
  // effect below clears the seed if nothing else claims it.
  const [isLoadingConversation, setIsLoadingConversation] = useState(wantsChatOpen)
  // Tracks an in-flight explicit loadConversation so the recent-load fallback
  // doesn't clear the loading state out from under it.
  const loadInFlightRef = useRef(false)

  // Conversation state
  const [conversationId, setConversationId] = useState<string | null>(null)
  const conversationIdRef = useRef(conversationId)
  // eslint-disable-next-line react-hooks/refs -- ref intentionally mirrors the latest conversationId so the request-time body() callback reads it; imperative writes in start/loadConversation cover the synchronous send-race
  conversationIdRef.current = conversationId
  const [conversationType, setConversationType] = useState<string | null>(null)

  const [input, setInput] = useState('')
  const [chatError, setChatError] = useState<string | null>(null)

  // Wow plumbing: holds the active first-Read delivery so handleSend can
  // detect substantive replies within 5 minutes of it being shown.
  const firstReadCtxRef = useRef<{
    first_read_message_id: string
    conversation_id: string
    delivered_at: number
  } | null>(null)

  const registerFirstReadDelivery = useCallback(
    (ctx: { first_read_message_id: string; conversation_id: string }) => {
      // Re-registering the same insight is a no-op (component re-mount,
      // re-render). Only the FIRST delivery captures the timestamp — that's
      // what the 5-minute window measures from.
      if (
        firstReadCtxRef.current?.first_read_message_id ===
        ctx.first_read_message_id
      ) {
        return
      }
      firstReadCtxRef.current = {
        ...ctx,
        delivered_at: Date.now(),
      }
    },
    [],
  )

  // Conversation type — set when starting a typed conversation (nudge, review, etc.)
  const conversationTypeRef = useRef<string | undefined>(undefined)
  const conversationMetadataRef = useRef<Record<string, string> | undefined>(
    undefined,
  )
  const autoTriggeredRef = useRef(false)
  const initialLoadDone = useRef(false)

  // ── useChat hook ──────────────────────────────────────────────────────────

  const { messages, sendMessage, status, setMessages } = useChat({
    // eslint-disable-next-line react-hooks/refs -- body() below is a deferred request-time callback (the AI SDK builds each HTTP request later, like an event handler), so reading the latest ref values there is safe and intentional
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
          if (typeof data.conversation.type === 'string') {
            setConversationType(data.conversation.type)
          }
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
      .finally(() => {
        // Universal fallback: once the recent-conversation load settles, drop
        // the first-paint loading seed — unless an explicit loadConversation
        // is mid-flight (it clears the flag itself). Stops a ?chat=open landing
        // with no conversation to load from sitting on the loading state.
        if (!loadInFlightRef.current) setIsLoadingConversation(false)
      })
  }, [setMessages])

  // ── Auto-trigger for typed conversations ──────────────────────────────────

  const pendingTriggerRef = useRef<{
    type: string
    metadata?: Record<string, string>
  } | null>(null)
  // Bumped whenever pendingTriggerRef is set in an async path (e.g.
  // loadConversation's fetch .then()). Acts as a useEffect dependency so
  // the auto-trigger evaluates again after the ref is populated. Without
  // this, setting pendingTriggerRef inside a promise resolution doesn't
  // cause a re-render, so the effect never re-runs and the trigger is lost.
  const [pendingTriggerNonce, setPendingTriggerNonce] = useState(0)

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
    } else if (type === 'onboarding_goal_chat') {
      // The user has just submitted their entry struggle and walked into the
      // office. Per the goal-derive-and-confirm task in the system prompt,
      // open with either a draft proposal (if the struggle gives enough
      // signal) or a single clarifying question (if it doesn't).
      trigger =
        '[System: The user has just walked into your office for the first time and shared what brought them in (see "Your task in this conversation" in the system prompt for the exact wording). Open this conversation per the derive-and-confirm task. If the signal is specific enough to draft a goal directly, draft it: name the goal, propose a target amount, propose a target date, present as one concrete proposal. If the signal is too vague, ask exactly one clarifying question that turns the direction into a target. Maximum 2-3 sentences. Sign off with "— C." on its own line.]'
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
    } else {
      trigger =
        '[System: Post-upload analysis triggered. Deliver your first insight.]'
    }

    sendMessage({ text: trigger })
  }, [messages.length, status, sendMessage, pendingTriggerNonce])

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
      setConversationType(type ?? null)
      firstReadCtxRef.current = null
      setChatError(null)
      setInput('')

      // If this is a typed conversation that needs auto-trigger, queue it.
      // Such conversations open an opener immediately, so keep the loading
      // state up until it streams; a plain manual chat shows the prompts.
      const willAutoTrigger =
        !!type && (AUTO_TRIGGER_TYPES as readonly string[]).includes(type)
      if (willAutoTrigger) {
        pendingTriggerRef.current = { type, metadata }
      }
      setIsLoadingConversation(willAutoTrigger)

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
      setConversationType(null)
      firstReadCtxRef.current = null
      autoTriggeredRef.current = false
      setChatError(null)
      setInput('')
      loadInFlightRef.current = true
      setIsLoadingConversation(true)

      // Fetch messages for this conversation
      fetch(`/api/conversations/recent?id=${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const msgs = data?.messages ?? []
          if (msgs) {
            setMessages(msgs)
          }

          // If this is a typed conversation with no messages yet (e.g. a
          // first_read conversation just created by the archetype
          // orchestrator), queue the auto-trigger so the CFO opens it.
          // Skipping when there are already messages avoids re-triggering
          // on subsequent loads from the conversation list.
          const convType = data?.conversation?.type as string | undefined
          const convMetadata = data?.conversation?.metadata as
            | Record<string, string>
            | undefined
          if (
            convType &&
            (AUTO_TRIGGER_TYPES as readonly string[]).includes(convType) &&
            msgs.length === 0
          ) {
            conversationTypeRef.current = convType
            conversationMetadataRef.current = convMetadata
            pendingTriggerRef.current = { type: convType, metadata: convMetadata }
            setPendingTriggerNonce((n) => n + 1)
          }
          if (typeof convType === 'string') {
            setConversationType(convType)
          }
        })
        .catch((err) => {
          // If the fetch fails the UI stays on the previously loaded
          // conversation. Log so a flaky API is at least visible in the
          // console during development.
          console.error('[ChatProvider] failed to load conversation messages', err)
        })
        .finally(() => {
          loadInFlightRef.current = false
          setIsLoadingConversation(false)
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
    // Wow plumbing: if the user is replying within 5 min of a first Read
    // delivery, log a substantive-reply event. The helper enforces the
    // length + window thresholds; this site just provides the context.
    const ctx = firstReadCtxRef.current
    if (ctx) {
      detectSubstantiveReply(text, {
        first_read_message_id: ctx.first_read_message_id,
        first_read_delivered_at: ctx.delivered_at,
        conversation_id: ctx.conversation_id,
      })
    }
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

  // Fires after LabelTransactionsBlock has POSTed every label to
  // /api/corrections/signal. The block already wrote the learning-engine
  // signal — our job here is to advance the chat by sending a hidden
  // [System: ...] trigger so the LLM responds in the next turn. Mirrors the
  // existing handleStructuredSubmit/onStructuredSubmit pattern.
  const handleLabelTransactionsSubmit = useCallback(
    (
      transactions: LabelTransactionsTransaction[],
      labels: Record<string, LabelTransactionsQuadrantId>,
    ) => {
      const trigger = buildLabelRecapTrigger(transactions, labels)
      sendMessage({ text: trigger })
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
    conversationType,
    registerFirstReadDelivery,
    chatError,
    dismissError,
    isLoadingConversation,
    handleOptionSelect,
    handleStructuredSubmit,
    handleLabelTransactionsSubmit,
    userCurrency,
    currentFolder,
    onboardingStep,
    needsEntryStruggle,
    onboardingGoal,
    estimateOnboarding,
  }

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}
