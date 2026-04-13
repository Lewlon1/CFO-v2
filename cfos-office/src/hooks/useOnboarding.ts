'use client'

import { useReducer, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ONBOARDING_BEATS,
  type OnboardingBeat,
  type OnboardingState,
  type OnboardingAction,
  type OnboardingData,
} from '@/lib/onboarding/types'
import { BEAT_MESSAGES } from '@/lib/onboarding/constants'
import { useTrackOnboarding } from '@/lib/analytics/onboarding-events'

// ── Helpers ──────────────────────────────────────────────────────────────────

function beatIndex(beat: OnboardingBeat): number {
  return ONBOARDING_BEATS.indexOf(beat)
}

function nextBeat(current: OnboardingBeat, skip?: OnboardingBeat[]): OnboardingBeat | null {
  const idx = beatIndex(current)
  for (let i = idx + 1; i < ONBOARDING_BEATS.length; i++) {
    if (!skip?.includes(ONBOARDING_BEATS[i])) {
      return ONBOARDING_BEATS[i]
    }
  }
  return null
}

function getSkippedBeats(beat: OnboardingBeat, completedBeats: OnboardingBeat[]): OnboardingBeat[] {
  const skips: OnboardingBeat[] = []
  // Skip Value Map → also skip Archetype
  if (beat === 'value_map' || !completedBeats.includes('value_map')) {
    if (beat === 'framework') {
      // Skipping forward from framework means skipping value_map + archetype
    }
  }
  return skips
}

function createInitialState(
  initialProgress: OnboardingState | null,
  name?: string,
  currency?: string
): OnboardingState {
  if (initialProgress) {
    return {
      ...initialProgress,
      data: {
        ...initialProgress.data,
        name: name ?? initialProgress.data.name,
        currency: currency ?? initialProgress.data.currency,
      },
    }
  }

  return {
    beat: 'welcome',
    messageIndex: -1, // -1 means no messages shown yet — first advance shows message 0
    completedBeats: [],
    startedAt: new Date().toISOString(),
    skippedAt: null,
    completedAt: null,
    data: { name, currency },
  }
}

// ── Reducer ──────────────────────────────────────────────────────────────────

function reducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'ADVANCE_MESSAGE': {
      const messages = BEAT_MESSAGES[state.beat]
      const nextIndex = state.messageIndex + 1
      if (nextIndex >= messages.length) return state
      return { ...state, messageIndex: nextIndex }
    }

    case 'COMPLETE_BEAT': {
      const completed = [...state.completedBeats, action.beat]
      const mergedData = action.data
        ? { ...state.data, ...action.data }
        : state.data

      // Determine which beats to skip
      const skips: OnboardingBeat[] = []
      if (action.beat === 'value_map' && !mergedData.personalityType) {
        // Value map was skipped (no personality result) → skip archetype
        skips.push('archetype')
      }
      if (action.beat === 'csv_upload' && !mergedData.importBatchId) {
        // CSV was skipped → skip first insight
        skips.push('first_insight')
      }

      const next = nextBeat(action.beat, skips)
      if (!next) {
        return {
          ...state,
          completedBeats: completed,
          data: mergedData,
          completedAt: new Date().toISOString(),
        }
      }

      return {
        ...state,
        beat: next,
        messageIndex: -1,
        completedBeats: completed,
        data: mergedData,
      }
    }

    case 'SET_DATA':
      return { ...state, data: { ...state.data, ...action.data } }

    case 'SKIP':
      return { ...state, skippedAt: new Date().toISOString() }

    case 'DISMISS':
      return { ...state, completedAt: new Date().toISOString() }

    default:
      return state
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseOnboardingOptions {
  initialProgress: OnboardingState | null
  userName?: string
  currency?: string
}

export function useOnboarding({ initialProgress, userName, currency }: UseOnboardingOptions) {
  const [state, dispatch] = useReducer(
    reducer,
    createInitialState(initialProgress, userName, currency)
  )
  const router = useRouter()
  const trackOnboarding = useTrackOnboarding()
  const beatEnteredAt = useRef<number>(Date.now())
  const startedAt = useRef<number>(Date.now())
  const hasTrackedStart = useRef(false)

  // Fire onboarding_started once
  useEffect(() => {
    if (!hasTrackedStart.current) {
      hasTrackedStart.current = true
      if (initialProgress) {
        trackOnboarding('onboarding_resumed', {
          beat_name: state.beat,
          beat: beatIndex(state.beat),
        })
      } else {
        trackOnboarding('onboarding_started')
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track beat entry
  useEffect(() => {
    beatEnteredAt.current = Date.now()
    trackOnboarding('onboarding_beat_entered', {
      beat: beatIndex(state.beat),
      beat_name: state.beat,
      total_elapsed_ms: Date.now() - startedAt.current,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.beat])

  const advanceMessage = useCallback(() => {
    dispatch({ type: 'ADVANCE_MESSAGE' })
  }, [])

  const completeBeat = useCallback((beat: OnboardingBeat, data?: Partial<OnboardingData>) => {
    const durationMs = Date.now() - beatEnteredAt.current
    trackOnboarding('onboarding_beat_completed', {
      beat: beatIndex(beat),
      beat_name: beat,
      duration_ms: durationMs,
      total_elapsed_ms: Date.now() - startedAt.current,
    })

    dispatch({ type: 'COMPLETE_BEAT', beat, data })

    // Persist progress (fire-and-forget)
    const updatedState = reducer(state, { type: 'COMPLETE_BEAT', beat, data })
    fetch('/api/onboarding/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedState),
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const setData = useCallback((data: Partial<OnboardingData>) => {
    dispatch({ type: 'SET_DATA', data })
  }, [])

  const skip = useCallback(() => {
    trackOnboarding('onboarding_skipped', {
      skip_point: state.beat,
      beat: beatIndex(state.beat),
      total_elapsed_ms: Date.now() - startedAt.current,
    })

    dispatch({ type: 'SKIP' })

    // Persist skip
    fetch('/api/onboarding/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...state, skippedAt: new Date().toISOString() }),
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const dismiss = useCallback(() => {
    trackOnboarding('onboarding_completed', {
      total_elapsed_ms: Date.now() - startedAt.current,
      capabilities: state.data.selectedCapabilities,
    })

    dispatch({ type: 'DISMISS' })

    // Mark complete in DB and seed profile data
    fetch('/api/onboarding/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilities: state.data.selectedCapabilities,
        onboardingData: state.data,
      }),
    }).catch(() => {})

    router.refresh()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, router])

  const messages = BEAT_MESSAGES[state.beat]
  const currentMessage = state.messageIndex >= 0 ? messages[state.messageIndex] : null
  const allMessagesShown = state.messageIndex >= messages.length - 1
  const isComplete = state.completedAt !== null
  const isSkipped = state.skippedAt !== null
  const progress = state.completedBeats.length / ONBOARDING_BEATS.length

  return {
    state,
    currentBeat: state.beat,
    messageIndex: state.messageIndex,
    messages,
    currentMessage,
    allMessagesShown,
    isComplete,
    isSkipped,
    progress,
    advanceMessage,
    completeBeat,
    setData,
    skip,
    dismiss,
  }
}
