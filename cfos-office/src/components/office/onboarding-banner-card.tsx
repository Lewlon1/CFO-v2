'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTrackEvent } from '@/lib/events/use-track-event'

const SESSION_KEY = 'cfos_onboarding_banner_dismissed'

type Variant = 'value_map' | 'upload'

export function OnboardingBannerCard({ variant }: { variant: Variant }) {
  const router = useRouter()
  const trackEvent = useTrackEvent()
  const [dismissed, setDismissed] = useState(false)
  const shownFiredRef = useRef(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDismissed(window.sessionStorage.getItem(SESSION_KEY) === '1')
    }
  }, [])

  useEffect(() => {
    if (dismissed || shownFiredRef.current) return
    shownFiredRef.current = true
    trackEvent('onboarding_v2.banner_shown', { variant })
  }, [dismissed, variant, trackEvent])

  if (dismissed) return null

  const headline =
    variant === 'value_map'
      ? "Pick up where we left off — the Value Map."
      : "One last thing — upload a recent statement so we can see the gap."
  const cta =
    variant === 'value_map' ? 'Start the Value Map →' : 'Upload a statement →'
  const target =
    variant === 'value_map'
      ? '/onboarding-v2/intro'
      : '/office/cash-flow/upload'

  function handleClick() {
    trackEvent('onboarding_v2.banner_clicked', { cta: variant })
    router.push(target)
  }

  function handleDismiss() {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(SESSION_KEY, '1')
    }
    setDismissed(true)
  }

  return (
    <div
      className="px-4 py-3 mb-4 flex items-center gap-3"
      style={{
        backgroundColor: '#FBF8F2',
        border: '1px solid #C9A86A',
        borderRadius: 12,
      }}
    >
      <p
        className="flex-1"
        style={{
          fontFamily: 'var(--font-instrument-sans, sans-serif)',
          fontSize: 13.5,
          lineHeight: 1.4,
          color: '#1A1612',
        }}
      >
        {headline}
      </p>
      <button
        type="button"
        onClick={handleClick}
        className="shrink-0 transition-colors"
        style={{
          minHeight: 40,
          padding: '8px 14px',
          borderRadius: 10,
          backgroundColor: '#1A1612',
          color: '#F5F1E9',
          fontFamily: 'var(--font-instrument-sans, sans-serif)',
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {cta}
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="shrink-0 transition-colors"
        style={{
          minHeight: 32,
          minWidth: 32,
          color: '#8a8276',
          fontSize: 18,
          lineHeight: 1,
          background: 'transparent',
          border: 'none',
        }}
      >
        ×
      </button>
    </div>
  )
}
