'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useChatContext } from '@/components/chat/ChatProvider'
import { skipGoalBeat } from '@/app/onboarding-v2/goal-beat-actions'
import type { OnboardingStep } from '@/lib/onboarding-v2/state-machine'

type Props = {
  onboardingStep: OnboardingStep | null
  entryStruggle: string | null
  goalChatConversationId: string | null
}

const SKIP_VISIBLE_AFTER_MS = 90_000

/**
 * Mounted in the office layout. Activates only when the user is mid-goal-beat
 * (onboarding_step = 'goal_chat_started'). Opens the goal-chat conversation
 * in the chat sheet on mount, then surfaces a "Set this up later" control
 * after 90s so any user — Marcus or chat-path — can bail.
 *
 * No polling: the chat route writes the goal_set / goal_skipped_now state
 * transitions when the model emits the matching emit_action. ChatProvider
 * observes the action in onFinish and calls router.refresh(); the office
 * layout sees the new step and routes onward (Marcus → /value-map, chat-path
 * stays in office).
 */
export function GoalBeatWatcher({
  onboardingStep,
  entryStruggle,
  goalChatConversationId,
}: Props) {
  void entryStruggle // kept in props for future per-route copy; not used today
  const router = useRouter()
  const { openSheet, loadConversation, conversationId: activeConversationId } = useChatContext()
  const [pending, startTransition] = useTransition()
  const [skipVisible, setSkipVisible] = useState(false)
  const openedRef = useRef(false)

  const isActive = onboardingStep === 'goal_chat_started'

  useEffect(() => {
    if (!isActive || openedRef.current) return
    if (!goalChatConversationId) return
    if (activeConversationId === goalChatConversationId) {
      openedRef.current = true
      openSheet()
      return
    }
    openedRef.current = true
    openSheet()
    loadConversation(goalChatConversationId)
  }, [isActive, goalChatConversationId, activeConversationId, openSheet, loadConversation])

  useEffect(() => {
    if (!isActive) return
    const t = setTimeout(() => setSkipVisible(true), SKIP_VISIBLE_AFTER_MS)
    return () => clearTimeout(t)
  }, [isActive])

  const handleSkip = useCallback(() => {
    if (pending) return
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
      }
    })
  }, [pending, router])

  if (!isActive || !skipVisible) return null

  return (
    <div className="fixed bottom-3 left-3 z-50 pointer-events-auto">
      <button
        type="button"
        onClick={handleSkip}
        disabled={pending}
        className="text-xs text-text-muted underline underline-offset-2 hover:text-text-secondary disabled:opacity-50 px-2 py-1 rounded bg-bg-base/80 backdrop-blur"
      >
        Set this up later
      </button>
    </div>
  )
}
