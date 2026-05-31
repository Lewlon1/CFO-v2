'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { submitStruggle } from '@/app/onboarding-v2/actions'
import {
  STRUGGLE_OPTIONS,
  type StruggleOptionId,
} from '@/lib/onboarding-v2/labels'

type Props = {
  userId: string
  firstName: string | null
  /** Session 32 (B) — when true, swap the eyebrow + subtitle copy for the
   *  layered-read framing. Layout unchanged. */
  layered?: boolean
}

export function StruggleQuestion({ userId, layered = false }: Props) {
  const router = useRouter()
  const trackEvent = useTrackEvent()
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState<StruggleOptionId | null>(null)
  const [freeText, setFreeText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const shownFiredRef = useRef(false)

  useEffect(() => {
    if (shownFiredRef.current) return
    shownFiredRef.current = true
    trackEvent('onboarding_v2.struggle_shown', { userId })
  }, [trackEvent, userId])

  const canContinue =
    (selected !== null || freeText.trim().length > 0) && !pending

  function handleOption(id: StruggleOptionId) {
    setSelected(id)
    setFreeText('')
    trackEvent('onboarding_v2.option_selected', { userId, option_id: id })
  }

  function handleTextChange(v: string) {
    setFreeText(v)
    if (v.trim().length > 0) setSelected(null)
  }

  function handleContinue() {
    if (!canContinue) return
    setError(null)
    startTransition(async () => {
      try {
        const trimmed = freeText.trim()
        const result = await submitStruggle({
          selectedOption: selected,
          freeText: selected ? null : trimmed.length > 0 ? trimmed : null,
        })
        if (result.entryStruggle === 'free_text') {
          trackEvent('onboarding_v2.free_text_submitted', {
            userId,
            text_length: result.freeTextLength ?? 0,
          })
        }
        trackEvent('onboarding_v2.continue_clicked', {
          userId,
          route: result.route,
        })
        if (
          result.route === 'chat' &&
          result.entryStruggle !== 'free_text'
        ) {
          trackEvent('onboarding_v2.chat_opener_delivered', {
            userId,
            route: result.entryStruggle,
          })
        }
        router.push(result.redirectTo)
      } catch (err) {
        console.error('[onboarding-v2] submitStruggle failed', err)
        setError('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 bg-background">
      <div className="w-full max-w-md">
        <p className="eyebrow mb-6 text-center">
          {layered ? 'YOUR CFO IS READY' : "THE CFO'S OFFICE"}
        </p>

        <h1 className="text-center mb-3 font-serif text-[30px] leading-[1.12] text-foreground">
          Before we sit down — what brought you in?
        </h1>

        <p className="text-center mb-8 font-sans text-[13px] text-muted-foreground">
          {layered
            ? 'A few minutes of setup. One sharp read of your last 90 days. Pick whichever sounds closest — or tell me in your own words.'
            : 'Pick whichever sounds closest — or tell me in your own words.'}
        </p>

        <div className="space-y-3 mb-5">
          {STRUGGLE_OPTIONS.map((opt) => {
            const isSelected = selected === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleOption(opt.id)}
                className={
                  'w-full text-left px-4 py-3 transition-colors min-h-11 rounded-xl font-sans text-[14.5px] border ' +
                  (isSelected
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-card text-foreground border-border')
                }
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        <textarea
          value={freeText}
          onChange={(e) => handleTextChange(e.target.value)}
          rows={2}
          placeholder="What's been on your mind?"
          className="w-full px-4 py-3 mb-6 outline-none focus:ring-2 focus:ring-foreground/20 rounded-xl border border-border bg-card text-foreground font-serif italic text-[17px] resize-none placeholder:text-muted-foreground"
        />

        {error && (
          <p className="text-center mb-4 font-sans text-[13px] text-destructive">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleContinue}
          disabled={!canContinue}
          className={
            'w-full transition-opacity min-h-12 rounded-xl font-sans text-h3 font-medium ' +
            (canContinue
              ? 'bg-foreground text-background cursor-pointer'
              : 'bg-muted text-muted-foreground cursor-not-allowed')
          }
        >
          {pending ? 'Just a moment…' : 'Continue'}
        </button>
      </div>
    </main>
  )
}
