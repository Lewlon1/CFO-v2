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
// Grace period after the tentative hand-off signal lands, so the CFO's
// streamed acknowledgement is visible before we redirect to the upload screen.
const TENTATIVE_ROUTE_GRACE_MS = 4000

/**
 * Mounted in the office layout. Activates only when the user is mid-goal-beat
 * (onboarding_step = 'goal_chat_started' or 'goal_chat_tentative'). Opens
 * the goal-chat conversation in the chat sheet, polls
 * /api/onboarding/essentials-status, and routes onward to /onboarding-v2/upload
 * when EITHER a goal lands OR the step reaches 'goal_chat_tentative' (the
 * deferral / stall hand-off — the user is moving on without a confirmed goal).
 * Income and rent are collected later on the processing screen. Routing on the
 * tentative signal is what stops a user who declines a goal from being
 * stranded on the chat screen. The skip control below is a manual fallback for
 * the residual case where the tentative signal hasn't landed yet.
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
  // stall handler advances to after 7 turns without a goal — both still need
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
  // chat-route stall handler advances to `goal_chat_tentative` after 7 turns
  // without a goal). Either signal means the user is stuck on goal-picking
  // and should be able to move to upload.
  useEffect(() => {
    if (!isActive) return
    if (onboardingStep === 'goal_chat_tentative') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to a step transition; the sibling branch is timer-driven, so this stays an effect
      setSkipVisible(true)
      return
    }
    if (entryStruggle !== 'dont_know') return
    const t = setTimeout(() => setSkipVisible(true), SKIP_VISIBLE_AFTER_MS)
    return () => clearTimeout(t)
  }, [isActive, entryStruggle, onboardingStep])

  // Poll for the beat's hand-off signal. Value-first flow: a goal is the
  // happy-path signal — income and rent get collected on the processing
  // screen. But a confirmed goal is NOT required to move on: when the user
  // defers a goal ("just visibility") or stalls, the chat route advances the
  // onboarding step to `goal_chat_tentative`, and that is also a hand-off
  // signal. Routing on EITHER is what stops a non-`dont_know` decliner from
  // being stranded on the chat screen (the documented intent of the
  // tentative-aware polling — see app/api/chat/route.ts). The essentials-status
  // endpoint returns { goal, income, rent, step } — we read `goal` and `step`.
  //
  // Small grace before routing on the tentative signal so the CFO's streamed
  // acknowledgement ("a goal can wait — let's look at your numbers") is visible
  // before the redirect, rather than yanking the screen away mid-sentence.
  useEffect(() => {
    if (!isActive || completedRef.current) return
    let graceTimer: ReturnType<typeof setTimeout> | null = null

    const complete = () => {
      if (completedRef.current) return
      completedRef.current = true
      startTransition(async () => {
        try {
          // Goal landed → upload_pending. The upload beat now runs in-sheet
          // (OnboardingBeatHost), so stay in /office and refresh rather than
          // routing to the (now redirect-only) /onboarding-v2/upload page.
          await completeGoalBeat()
          router.refresh()
        } catch (err) {
          console.error('[GoalBeatWatcher] completeGoalBeat failed', err)
          completedRef.current = false
        }
      })
    }

    const interval = setInterval(async () => {
      if (completedRef.current) return
      try {
        const res = await fetch('/api/onboarding/essentials-status', { cache: 'no-store' })
        if (!res.ok) return
        const { goal, step } = (await res.json()) as {
          goal: boolean
          income: boolean
          rent: boolean
          step: string | null
        }
        if (completedRef.current) return
        if (goal) {
          // Confirmed goal — route immediately.
          clearInterval(interval)
          if (graceTimer) clearTimeout(graceTimer)
          complete()
        } else if (step === 'goal_chat_tentative' && !graceTimer) {
          // Deferral / stall hand-off — let the acknowledgement land, then route.
          clearInterval(interval)
          graceTimer = setTimeout(complete, TENTATIVE_ROUTE_GRACE_MS)
        }
      } catch (err) {
        // Network/parse failures are recoverable — next tick will retry.
        console.error('[GoalBeatWatcher] poll failed', err)
      }
    }, POLL_INTERVAL_MS)
    return () => {
      clearInterval(interval)
      if (graceTimer) clearTimeout(graceTimer)
    }
  }, [isActive, router])

  const handleSkip = useCallback(() => {
    if (pending || completedRef.current) return
    completedRef.current = true
    startTransition(async () => {
      try {
        // Same in-sheet hand-off as completeGoalBeat — stay in /office.
        await skipGoalBeat()
        router.refresh()
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
