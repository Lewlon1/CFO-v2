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
}

export function StruggleQuestion({ userId }: Props) {
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
    <main
      className="min-h-dvh flex flex-col items-center justify-center px-6 py-12"
      style={{ backgroundColor: '#F5F1E9' }}
    >
      <div className="w-full max-w-md">
        <p
          className="uppercase mb-6 text-center"
          style={{
            fontFamily: 'var(--font-instrument-sans, sans-serif)',
            fontSize: 10,
            letterSpacing: '0.22em',
            color: '#8a8276',
          }}
        >
          THE CFO&apos;S OFFICE
        </p>

        <h1
          className="text-center mb-3"
          style={{
            fontFamily: 'var(--font-instrument-serif, serif)',
            fontSize: 30,
            lineHeight: 1.12,
            color: '#1A1612',
          }}
        >
          Before we sit down — what brought you in?
        </h1>

        <p
          className="text-center mb-8"
          style={{
            fontFamily: 'var(--font-instrument-sans, sans-serif)',
            fontSize: 13,
            color: '#8a8276',
          }}
        >
          Pick whichever sounds closest — or tell me in your own words.
        </p>

        <div className="space-y-3 mb-5">
          {STRUGGLE_OPTIONS.map((opt) => {
            const isSelected = selected === opt.id
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleOption(opt.id)}
                className="w-full text-left px-4 transition-colors"
                style={{
                  minHeight: 44,
                  borderRadius: 12,
                  border: `1px solid ${isSelected ? '#1A1612' : '#E5DDD0'}`,
                  backgroundColor: isSelected ? '#1A1612' : '#FBF8F2',
                  color: isSelected ? '#F5F1E9' : '#1A1612',
                  fontFamily: 'var(--font-instrument-sans, sans-serif)',
                  fontSize: 14.5,
                  paddingTop: 12,
                  paddingBottom: 12,
                }}
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
          className="w-full px-4 py-3 mb-6 outline-none focus:ring-2 focus:ring-[#1A1612]/20"
          style={{
            backgroundColor: '#FBF8F2',
            border: '1px solid #E5DDD0',
            borderRadius: 12,
            fontFamily: 'var(--font-instrument-serif, serif)',
            fontStyle: 'italic',
            fontSize: 17,
            color: '#1A1612',
            resize: 'none',
          }}
        />

        {error && (
          <p
            className="text-center mb-4"
            style={{
              fontFamily: 'var(--font-instrument-sans, sans-serif)',
              fontSize: 13,
              color: '#a04040',
            }}
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleContinue}
          disabled={!canContinue}
          className="w-full transition-opacity"
          style={{
            minHeight: 48,
            borderRadius: 12,
            backgroundColor: canContinue ? '#1A1612' : '#D8D2C7',
            color: canContinue ? '#F5F1E9' : '#8a8276',
            fontFamily: 'var(--font-instrument-sans, sans-serif)',
            fontSize: 15,
            fontWeight: 500,
            cursor: canContinue ? 'pointer' : 'not-allowed',
          }}
        >
          {pending ? 'Just a moment…' : 'Continue'}
        </button>
      </div>
    </main>
  )
}
