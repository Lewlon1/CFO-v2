'use client';

import { getSessionId } from '@/lib/analytics/session';

export function useTrackEvent() {
  return function trackEvent(
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
  };
}
