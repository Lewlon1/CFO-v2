'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useChatContext } from '@/components/chat/ChatProvider'
import { completeGoalBeat, skipGoalBeat } from '@/app/onboarding-v2/goal-beat-actions'

type Props = {
  onboardingStep: string | null
  entryStruggle: string | null
  goalChatConversationId: string | null
}

const POLL_INTERVAL_MS = 2500
const SKIP_VISIBLE_AFTER_MS = 90_000

/**
 * Mounted in the office layout. Activates only when the user is mid-goal-beat
 * (onboarding_step = 'goal_chat_started'). Opens the goal-chat conversation in
 * the chat sheet, polls /api/onboarding/essentials-status until both
 * net_monthly_income AND monthly_rent have landed (a goal is optional —
 * the dont_know pivot path collects essentials without a confirmed goal),
 * and routes onward to /onboarding-v2/upload when essentials complete.
 * For Marcus (dont_know) users, also surfaces a skip control after 90s in
 * case the user can't articulate anything.
 */
export function GoalBeatWatcher({
  onboardingStep,
  entryStruggle,
  goalChatConversationId,
}: Props) {
  const router = useRouter()
  const { openSheet, loadConversation, conversationId: activeConversationId } = useChatContext()
  const [pending, startTransition] = useTransition()
  const [skipVisible, setSkipVisible] = useState(false)
  const completedRef = useRef(false)
  const openedRef = useRef(false)

  // Active for the goal-derive beat AND the tentative state the chat route's
  // stall handler advances to after 5 turns without a goal — both still need
  // essentials collection, both should advance to upload once income+rent land.
  const isActive =
    onboardingStep === 'goal_chat_started' ||
    onboardingStep === 'goal_chat_tentative'

  // Open the goal-chat conversation in the sheet when the watcher activates.
  useEffect(() => {
    if (!isActive || openedRef.current) return
    if (!goalChatConversationId) return
    // If ChatOpenerTrigger has already loaded the same conversation from a URL
    // param, don't double-load it.
    if (activeConversationId === goalChatConversationId) {
      openedRef.current = true
      openSheet()
      return
    }
    openedRef.current = true
    openSheet()
    loadConversation(goalChatConversationId)
  }, [isActive, goalChatConversationId, activeConversationId, openSheet, loadConversation])

  // Surface the skip control after 90 seconds for `dont_know` users only.
  useEffect(() => {
    if (!isActive) return
    if (entryStruggle !== 'dont_know') return
    const t = setTimeout(() => setSkipVisible(true), SKIP_VISIBLE_AFTER_MS)
    return () => clearTimeout(t)
  }, [isActive, entryStruggle])

  // Poll for essentials completion. When both net_monthly_income AND
  // monthly_rent have landed (regardless of whether a goal was set),
  // complete the beat and route to /onboarding-v2/upload.
  useEffect(() => {
    if (!isActive || completedRef.current) return
    const interval = setInterval(async () => {
      if (completedRef.current) return
      try {
        const res = await fetch('/api/onboarding/essentials-status', { cache: 'no-store' })
        if (!res.ok) return
        const { income, rent } = (await res.json()) as {
          goal: boolean
          income: boolean
          rent: boolean
        }
        if (income && rent && !completedRef.current) {
          completedRef.current = true
          clearInterval(interval)
          startTransition(async () => {
            try {
              const { redirectTo } = await completeGoalBeat()
              if (redirectTo) {
                router.push(redirectTo)
              } else {
                router.refresh()
              }
            } catch (err) {
              console.error('[GoalBeatWatcher] completeGoalBeat failed', err)
              completedRef.current = false
            }
          })
        }
      } catch (err) {
        // Network/parse failures are recoverable — next tick will retry.
        console.error('[GoalBeatWatcher] poll failed', err)
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [isActive, router])

  const handleSkip = useCallback(() => {
    if (pending || completedRef.current) return
    completedRef.current = true
    startTransition(async () => {
      try {
        const { redirectTo } = await skipGoalBeat()
        if (redirectTo) {
          router.push(redirectTo)
        } else {
          router.refresh()
        }
      } catch (err) {
        console.error('[GoalBeatWatcher] skipGoalBeat failed', err)
        completedRef.current = false
      }
    })
  }, [pending, router])

  if (!isActive) return null

  // The chat sheet is the primary surface — the watcher is mostly invisible.
  // The only UI is the optional skip control for dont_know users, anchored to
  // the bottom-left so it doesn't compete with the chat input or sheet header.
  if (!skipVisible) return null

  return (
    <div className="fixed bottom-3 left-3 z-50 pointer-events-auto">
      <button
        type="button"
        onClick={handleSkip}
        disabled={pending}
        className="text-xs text-text-muted underline underline-offset-2 hover:text-text-secondary disabled:opacity-50 px-2 py-1 rounded bg-bg-base/80 backdrop-blur"
      >
        Continue without setting a goal yet
      </button>
    </div>
  )
}
