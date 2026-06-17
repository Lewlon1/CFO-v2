'use client'

// VM-4 — the archetype reveal, in VM-3's documented slot (between 'saving'
// and 'payback'). Sequence on screen: name → receipt → reading → tension
// line → onward. The name, receipt, and tension line arrive computed in the
// save response and render immediately; only the 2–3 sentence reading is
// generated (POST /api/value-map/reading) and shows a loading shimmer until
// it lands — or the static cell blurb if Bedrock is down. Nothing here
// blocks: the classification is already persisted server-side.

import { useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { STILL_READING_BLURB } from '@/lib/value-map/archetype-reading-prompt'
import type { RevealPayload } from '@/lib/value-map/reveal'

interface ArchetypeRevealProps {
  reveal: RevealPayload
  onContinue: () => void
}

export function ArchetypeReveal({ reveal, onContinue }: ArchetypeRevealProps) {
  const [reading, setReading] = useState<string | null>(null)
  const fetchStarted = useRef(false)

  const isFallback = reveal.usedFallback || !reveal.displayName

  useEffect(() => {
    if (isFallback || fetchStarted.current) return
    fetchStarted.current = true
    let cancelled = false
    fetch('/api/value-map/reading', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: reveal.sessionId }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled) setReading(typeof body?.reading === 'string' ? body.reading : '')
      })
      .catch(() => {
        if (!cancelled) setReading('')
      })
    return () => {
      cancelled = true
    }
  }, [isFallback, reveal.sessionId])

  if (isFallback) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6 text-center">
        <CFOAvatar size={48} />
        <div className="space-y-3 max-w-sm">
          <h1 className="text-[28px] leading-[1.15] text-text-primary">
            C. is still reading you
          </h1>
          <p className="text-sm text-text-secondary leading-relaxed">{STILL_READING_BLURB}</p>
        </div>
        <ContinueButton onContinue={onContinue} />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-start px-6 pt-12 pb-8 gap-6 text-center overflow-y-auto">
      <CFOAvatar size={48} />
      <div className="space-y-2 max-w-sm">
        <p className="text-xs uppercase tracking-[0.08em] text-text-secondary">Your read</p>
        <h1 className="text-[28px] leading-[1.15] text-text-primary">{reveal.displayName}</h1>
      </div>

      <div className="w-full max-w-sm space-y-4 text-left">
        {/* Receipt — the computed facts behind the name */}
        {reveal.receiptHeadline && (
          <div className="rounded-card border border-[var(--border-subtle)] bg-bg-elevated px-5 py-4 space-y-1">
            <p className="text-sm text-text-primary leading-relaxed">{reveal.receiptHeadline}</p>
            {reveal.receiptBands && (
              <p className="text-xs text-text-secondary leading-relaxed">{reveal.receiptBands}</p>
            )}
          </div>
        )}

        {/* Reading — the only generated text on this screen */}
        {reading === null ? (
          <div className="space-y-2 px-1" aria-label="Reading loading" role="status">
            <div className="h-3 rounded-pill bg-border animate-pulse w-full" />
            <div className="h-3 rounded-pill bg-border animate-pulse w-11/12" />
            <div className="h-3 rounded-pill bg-border animate-pulse w-2/3" />
          </div>
        ) : reading.length > 0 ? (
          <p className="text-sm text-text-primary leading-relaxed px-1">{reading}</p>
        ) : null}

        {/* Tension line */}
        {reveal.tensionLine && (
          <p className="text-xs text-text-secondary leading-relaxed border-l-2 border-[var(--border-subtle)] pl-3">
            {reveal.tensionLine}
          </p>
        )}
      </div>

      <ContinueButton onContinue={onContinue} />
    </div>
  )
}

function ContinueButton({ onContinue }: { onContinue: () => void }) {
  return (
    <Button
      onClick={onContinue}
      className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-8 py-5 text-base min-h-11 mt-2"
    >
      Continue
      <ArrowRight className="ml-2 h-4 w-4" />
    </Button>
  )
}
