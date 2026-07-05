'use client'

import { useEffect } from 'react'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { getSessionId } from '@/lib/analytics/session'

// Fires `session_started` once per browser-tab session. Dedupes against a
// SEPARATE sessionStorage key (`cfo_session_tracked`) from the one
// `getSessionId()` manages (`cfo_session_id`) — this lets the component be
// mounted from multiple layouts on the same page load (office + onboarding-v2)
// without double-firing: the first mount's effect marks the session id
// tracked, so any other mount's effect sees the flag already set and no-ops.
export function SessionTracker() {
  const trackEvent = useTrackEvent()

  useEffect(() => {
    const sessionId = getSessionId()
    const alreadyTracked = sessionStorage.getItem('cfo_session_tracked')
    if (alreadyTracked === sessionId) return
    sessionStorage.setItem('cfo_session_tracked', sessionId)
    trackEvent('session_started', 'session', { path: window.location.pathname })
  }, [trackEvent])

  return null
}
