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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only sessionStorage hydration; reading in render would break SSR/hydration
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
      ? '/onboarding-v2/value-map'
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
    <div className="px-4 py-3 mb-4 flex items-center gap-3 rounded-xl border border-primary/40 bg-card">
      <p className="flex-1 font-sans text-[13.5px] leading-[1.4] text-foreground">
        {headline}
      </p>
      <button
        type="button"
        onClick={handleClick}
        className="shrink-0 transition-colors min-h-10 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 font-sans text-[13px] font-medium"
      >
        {cta}
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="shrink-0 transition-colors min-h-8 min-w-8 text-[18px] leading-none bg-transparent border-none text-muted-foreground hover:text-foreground"
      >
        ×
      </button>
    </div>
  )
}
