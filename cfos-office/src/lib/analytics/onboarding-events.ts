'use client'

import { useTrackEvent } from '@/lib/events/use-track-event'

export type OnboardingEventType =
  | 'onboarding_started'
  | 'onboarding_beat_entered'
  | 'onboarding_beat_completed'
  | 'onboarding_skipped'
  | 'onboarding_completed'
  | 'onboarding_resumed'
  | 'value_map_tx_categorised'
  | 'value_map_tx_changed_mind'
  | 'value_map_completed'
  | 'csv_upload_initiated'
  | 'csv_upload_completed'
  | 'capability_selected'
  | 'first_insight_viewed'

export interface OnboardingEventPayload {
  beat?: number
  beat_name?: string
  duration_ms?: number
  total_elapsed_ms?: number
  transaction_id?: string
  category_selected?: string
  confidence?: number
  time_to_decide_ms?: number
  changed_from?: string
  capabilities?: string[]
  skip_point?: string
  import_batch_id?: string
  tx_count?: number
}

export function useTrackOnboarding() {
  const trackEvent = useTrackEvent()

  return function trackOnboardingEvent(
    type: OnboardingEventType,
    payload: OnboardingEventPayload = {}
  ) {
    trackEvent(type, 'funnel', payload as Record<string, unknown>)
  }
}
