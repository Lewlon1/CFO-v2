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
 * (onboarding_step = 'goal_chat_started' or 'goal_chat_tentative'). Opens
 * the goal-chat conversation in the chat sheet, polls
 * /api/onboarding/essentials-status until a goal has landed (income and rent
 * are collected later on the processing screen), and routes onward to
 * /onboarding-v2/upload when the goal lands. For users who can't articulate
 * anything, surfaces a skip control after 90s that routes to upload too —
 * value-first has no bifurcation.
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

  // Surface the skip control after 90 seconds for Marcus users from the start,
  // and immediately for anyone who has hit the tentative-stall state (the
  // chat-route stall handler advances to `goal_chat_tentative` after 5 turns
  // without a goal). Either signal means the user is stuck on goal-picking
  // and should be able to move to upload.
  useEffect(() => {
    if (!isActive) return
    if (onboardingStep === 'goal_chat_tentative') {
      setSkipVisible(true)
      return
    }
    if (entryStruggle !== 'dont_know') return
    const t = setTimeout(() => setSkipVisible(true), SKIP_VISIBLE_AFTER_MS)
    return () => clearTimeout(t)
  }, [isActive, entryStruggle, onboardingStep])

  // Poll for goal landing. Value-first flow: a goal is the only signal we
  // need from this beat — income and rent get collected on the processing
  // screen. As soon as a goal exists, complete the beat and route to
  // /onboarding-v2/upload (the upload orchestrator then hands off to
  // /onboarding-v2/processing). The essentials-status endpoint returns
  // { goal, income, rent } — we only read `goal`.
  useEffect(() => {
    if (!isActive || completedRef.current) return
    const interval = setInterval(async () => {
      if (completedRef.current) return
      try {
        const res = await fetch('/api/onboarding/essentials-status', { cache: 'no-store' })
        if (!res.ok) return
        const { goal } = (await res.json()) as {
          goal: boolean
          income: boolean
          rent: boolean
        }
        if (goal && !completedRef.current) {
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
