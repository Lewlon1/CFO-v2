'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { submitStruggle } from '@/app/onboarding-v2/actions'
import { STRUGGLE_OPTIONS, type StruggleOptionId } from '@/lib/onboarding-v2/labels'

/**
 * In-sheet entry beat — the CFO's opening "what brought you in?". Folds the
 * old full-page /onboarding-v2 struggle screen into the chat window so the very
 * first thing a new user sees is the chat. Logic mirrors the old StruggleQuestion
 * (preset chips + free text → submitStruggle); on submit we push the returned
 * /office?chat=open&conversationId URL, which the ChatOpenerTrigger already
 * knows how to open — the goal-derive beat then proceeds in the same sheet.
 */
export function StruggleBeatBlock() {
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
    trackEvent('onboarding_v2.struggle_shown')
  }, [trackEvent])

  const canContinue = (selected !== null || freeText.trim().length > 0) && !pending

  function handleOption(id: StruggleOptionId) {
    setSelected(id)
    setFreeText('')
    trackEvent('onboarding_v2.option_selected', { option_id: id })
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
        trackEvent('onboarding_v2.continue_clicked', { route: result.route })
        // We're already in /office, so router.push to a same-layout URL would
        // NOT re-run the (office) layout — needsEntryStruggle / goalBeatActive
        // would stay stale and the sheet would never leave this beat. Refresh
        // re-runs the layout: entry_struggle is now set (→ needsEntryStruggle
        // false, goalBeatActive true), and the GoalBeatWatcher opens the freshly
        // created goal-chat conversation in the same sheet.
        router.refresh()
      } catch (err) {
        console.error('[struggle-beat-block] submitStruggle failed', err)
        setError('Something went wrong. Please try again.')
      }
    })
  }

  return (
    <div className="px-4 py-5">
      {/* Frame the opener as the CFO's own first message so the very first
          thing a new user sees reads like a warm welcome into the office,
          not a form. Mirrors the assistant-message header in MessageList. */}
      <div className="mb-3 flex items-center gap-2">
        <CFOAvatar size={28} withOnlineDot />
        <span className="text-xs font-medium text-text-muted">Your CFO</span>
      </div>
      <p className="mb-2 text-sm text-text-secondary leading-snug">
        Welcome to the office — pull up a chair. This is your space to think
        out loud about money, and nothing you say here leaves it.
      </p>
      <h2 className="mb-2 font-serif text-[22px] leading-[1.15] text-text-primary">
        Before we dig in — what brought you in?
      </h2>
      <p className="mb-5 text-sm text-text-secondary leading-snug">
        Pick whichever sounds closest, or tell me in your own words.
      </p>

      <div className="space-y-2.5 mb-4">
        {STRUGGLE_OPTIONS.map((opt) => {
          const isSelected = selected === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleOption(opt.id)}
              className={
                'w-full text-left px-4 py-3 transition-colors min-h-11 rounded-control text-[14.5px] border ' +
                (isSelected
                  ? 'bg-primary/10 text-text-primary border-primary'
                  : 'bg-bg-elevated text-text-secondary border-[var(--border-subtle)]')
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
        className="w-full px-4 py-3 mb-5 outline-none focus:ring-2 focus:ring-text-primary/30 rounded-control border border-[var(--border-subtle)] bg-bg-elevated text-text-primary font-serif italic text-[16px] resize-none placeholder:text-text-muted"
      />

      {error && (
        <p className="mb-4 text-sm text-destructive">{error}</p>
      )}

      <button
        type="button"
        onClick={handleContinue}
        disabled={!canContinue}
        className="w-full transition-colors min-h-12 rounded-control text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {pending ? 'Just a moment…' : 'Continue'}
      </button>
    </div>
  )
}
