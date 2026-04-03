'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CfoAvatar } from '@/components/chat/cfo-avatar'
import { DemoEmailCapture } from '@/components/demo/demo-email-capture'
import { DemoResonanceFeedback } from '@/components/demo/demo-resonance-feedback'
import { QUADRANT_ORDER, QUADRANTS } from '@/lib/value-map/constants'
import type { ValueQuadrant, ValueMapResult } from '@/lib/value-map/types'
import { demoAnalytics } from '@/lib/demo/analytics'
import { cn } from '@/lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────

export interface PersonalityData {
  type: string
  name: string
  emoji: string
  headline: string
  description: string
  breakdown: Record<ValueQuadrant, { total: number; percentage: number; count: number }>
}

interface DemoRevealProps {
  reading: string
  personality: PersonalityData
  userName: string
  country: string
  results: ValueMapResult[]
  fallback: boolean
  sessionId?: string | null
}

// ── Typing animation hook ───────────────────────────────────────────────────

function useTypingAnimation(text: string, speed = 20) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    setDisplayed('')
    setDone(false)
    let i = 0
    const timer = setInterval(() => {
      i++
      setDisplayed(text.slice(0, i))
      if (i >= text.length) {
        clearInterval(timer)
        setDone(true)
      }
    }, speed)
    return () => clearInterval(timer)
  }, [text, speed])

  const skip = useCallback(() => {
    setDisplayed(text)
    setDone(true)
  }, [text])

  return { displayed, done, skip }
}

// ── Shareable card (rendered as a div, captured to PNG) ─────────────────────

function ShareableCard({
  cardRef,
  userName,
  personality,
  firstParagraph,
}: {
  cardRef: React.RefObject<HTMLDivElement | null>
  userName: string
  personality: PersonalityData
  firstParagraph: string
}) {
  return (
    <div
      ref={cardRef}
      className="w-[540px] h-[540px] bg-[#0C0C0E] rounded-2xl flex flex-col text-white relative overflow-hidden"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      {/* Gold accent bar at top */}
      <div className="h-1 w-full bg-[#E8A84C] shrink-0" />

      {/* Gradient overlay */}
      <div
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at top right, rgba(232,168,76,0.2) 0%, transparent 55%)',
        }}
      />

      <div className="relative z-10 flex flex-col h-full px-9 pt-7 pb-7">
        {/* Personality hero */}
        <div className="mb-5">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-4xl leading-none">{personality.emoji}</span>
            <span className="text-[28px] font-bold text-white leading-tight">{personality.name}</span>
          </div>
          <p className="text-[#E8A84C] text-[13px] font-semibold tracking-wide uppercase">{personality.headline}</p>
        </div>

        {/* Reading text — fills remaining space, clips at bottom */}
        <p className="text-white/85 text-[13.5px] leading-[1.55] flex-1 overflow-hidden">
          {firstParagraph}
        </p>

        {/* Allocation bar */}
        <div className="mt-5 shrink-0">
          <div className="flex h-2.5 w-full rounded-full overflow-hidden">
            {QUADRANT_ORDER.map((qId) => {
              const pct = personality.breakdown[qId as ValueQuadrant]?.percentage ?? 0
              if (pct === 0) return null
              return (
                <div
                  key={qId}
                  className="h-full"
                  style={{ width: `${pct}%`, backgroundColor: QUADRANTS[qId].colour }}
                />
              )
            })}
          </div>
          <div className="flex justify-between mt-1.5">
            {QUADRANT_ORDER.map((qId) => {
              const pct = personality.breakdown[qId as ValueQuadrant]?.percentage ?? 0
              if (pct === 0) return null
              return (
                <span key={qId} className="text-xs text-white/40">
                  {QUADRANTS[qId].name} {pct}%
                </span>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main reveal component ───────────────────────────────────────────────────

export function DemoReveal({ reading, personality, userName, country, results, fallback, sessionId }: DemoRevealProps) {
  const displayName = userName === 'You' || userName === 'Anonymous' ? '' : userName
  const hookMessage = `${displayName ? displayName + ', have' : 'Have'} you ever thought about your spending like this before? These were sample transactions — imagine what your CFO could tell you from your real ones. The patterns in how fast you decide, where you hesitate, what you call a "leak" versus a "foundation" — that's your actual relationship with money. And this is just the surface.`

  const { displayed, done, skip } = useTypingAnimation(hookMessage, 15)
  const cardRef = useRef<HTMLDivElement>(null)
  const [saving, setSaving] = useState(false)
  const [resonanceRating, setResonanceRating] = useState<number | null>(null)

  // Show full reading on the card — overflow-hidden clips anything past the bottom
  const cardExcerpt = reading

  // Track reading generated
  useEffect(() => {
    demoAnalytics(fallback ? 'demo_reading_fallback' : 'demo_reading_generated')
  }, [fallback])

  const handleSaveCard = useCallback(async () => {
    if (!cardRef.current || saving) return
    setSaving(true)

    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,
        backgroundColor: '#0C0C0E',
        useCORS: true,
      })

      const dataUrl = canvas.toDataURL('image/png')

      // Try native share on mobile
      if (navigator.share && navigator.canShare) {
        try {
          const blob = await (await fetch(dataUrl)).blob()
          const file = new File([blob], 'value-map-reading.png', { type: 'image/png' })
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: `${personality.name} — The Value Map`,
            })
            demoAnalytics('demo_card_saved')
            setSaving(false)
            return
          }
        } catch {
          // Fall through to download
        }
      }

      // Fallback: download
      const link = document.createElement('a')
      link.download = 'value-map-reading.png'
      link.href = dataUrl
      link.click()
      demoAnalytics('demo_card_saved')
    } catch (err) {
      console.error('Failed to save card:', err)
    } finally {
      setSaving(false)
    }
  }, [saving, personality.name])

  return (
    <div className="flex flex-col items-center px-4 py-4 gap-6 overflow-y-auto min-h-0 h-full pb-16">

      {/* ── Shareable card — top of page ── */}
      <div className="w-full max-w-sm">
        <div className="relative w-full overflow-hidden rounded-xl border border-border" style={{ aspectRatio: '1/1' }}>
          <div className="absolute inset-0 origin-top-left" style={{ transform: 'scale(0.6667)', width: '150%', height: '150%' }}>
            <ShareableCard
              cardRef={cardRef}
              userName={userName}
              personality={personality}
              firstParagraph={cardExcerpt}
            />
          </div>
        </div>
      </div>

      {/* Save card button */}
      <Button
        onClick={handleSaveCard}
        disabled={saving}
        className="w-full max-w-sm bg-[#E8A84C] hover:bg-[#d4963f] text-black font-semibold py-5"
      >
        {saving ? 'Saving...' : (
          <>
            <Download className="h-4 w-4 mr-2" />
            Save card
          </>
        )}
      </Button>

      {/* ── CFO hook message — types in after card appears ── */}
      <div
        className={cn(
          'w-full max-w-sm text-sm text-foreground/90 leading-relaxed',
          !done && 'cursor-pointer',
        )}
        onClick={!done ? skip : undefined}
      >
        <div className="flex items-start gap-3">
          <CfoAvatar size="sm" status={done ? 'idle' : 'thinking'} className="mt-0.5 shrink-0" />
          <p>{displayed}{!done && <span className="animate-pulse">|</span>}</p>
        </div>
        {!done && (
          <p className="text-xs text-muted-foreground text-center mt-2">Tap to skip</p>
        )}
      </div>

      {/* ── Resonance feedback — shown once hook finishes ── */}
      {done && (
        <DemoResonanceFeedback value={resonanceRating} onChange={(rating) => {
          setResonanceRating(rating)
          if (sessionId && rating) {
            fetch('/api/demo/session', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ session_id: sessionId, ai_response_rating: rating }),
            }).catch(() => {})
          }
        }} />
      )}

      {/* ── Signup CTA — shown once hook finishes ── */}
      {done && (
        <div className="w-full max-w-sm">
          <div className="rounded-xl border border-[#E8A84C]/30 bg-[#E8A84C]/5 p-5">
            <p className="text-sm font-semibold text-foreground mb-1">
              Want to see what your real spending says?
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              Upload a bank statement and find out how this compares to your actual patterns. Free to try.
            </p>
            <a
              href={sessionId ? `/signup?session_token=${sessionId}` : '/signup'}
              onClick={() => demoAnalytics('demo_finished')}
              className="flex items-center justify-center w-full px-4 py-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors"
            >
              Sign up free — it&apos;s just an email
            </a>
          </div>
        </div>
      )}

      {/* ── Email capture — waitlist fallback ── */}
      {done && (
        <>
          <div className="w-full max-w-sm border-t border-border" />
          <DemoEmailCapture
            defaultName={userName === 'You' ? '' : userName}
            country={country}
            personality={personality.type}
            readingText={reading}
            resultsJson={results}
            resonanceRating={resonanceRating}
            sessionId={sessionId ?? null}
          />
        </>
      )}
    </div>
  )
}
