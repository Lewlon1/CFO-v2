'use client';

import { useCallback } from 'react';
import { getSessionId } from '@/lib/analytics/session';

// Stable function reference across renders. Previously this hook returned a
// fresh closure every render, which broke React's dependency tracking — any
// useEffect or useCallback that listed `trackEvent` in its deps re-ran on
// every render. That caused the Value Map onboarding events
// (value_map_completed, value_map_reading_shown) to fire 3-4 times per
// session, corrupting funnel analytics. useCallback with an empty dep array
// keeps the identity stable for the life of the component.
export function useTrackEvent() {
  return useCallback(function trackEvent(
    event: string,
    categoryOrProperties?: string | Record<string, unknown>,
    properties?: Record<string, unknown>
  ) {
    // Normalise args: support both (event, props) and (event, category, props)
    let metadata: Record<string, unknown> = {};
    if (typeof categoryOrProperties === 'string') {
      metadata = { ...properties, event_category: categoryOrProperties };
    } else if (categoryOrProperties) {
      metadata = categoryOrProperties;
    }

    // Fire and forget — never block the UI
    fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_name: event,
        metadata,
        session_id: getSessionId(),
      }),
    }).catch(() => {
      // Silent fail — analytics should never break the app
    });
  }, []);
}
