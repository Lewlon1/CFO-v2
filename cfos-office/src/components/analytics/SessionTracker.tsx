'use client';

import { useEffect, useRef } from 'react';
import { useTrackEvent } from '@/lib/events/use-track-event';

export function SessionTracker() {
  const trackEvent = useTrackEvent();
  const tracked = useRef(false);

  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    trackEvent('sign_in');
  }, [trackEvent]);

  return null;
}
