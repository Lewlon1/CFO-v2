'use client'

import { useState, useCallback } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CfoAvatar } from '@/components/chat/cfo-avatar'
import { QUADRANTS, QUADRANT_ORDER } from '@/lib/value-map/constants'
import { DEMO_COUNTRIES, getDemoTransactions } from '@/lib/demo/transactions'
import { DemoCard } from '@/components/demo/demo-card'
import { DemoReveal } from '@/components/demo/demo-reveal'
import { demoAnalytics } from '@/lib/demo/analytics'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { useDemoSession } from '@/lib/demo/use-demo-session'
import { calculatePersonality } from '@/lib/value-map/personalities'
import type { ValueMapResult, ValueQuadrant } from '@/lib/value-map/types'

// ── Types ────────────────────────────────────────────────────────────────────

type DemoStep = 'welcome' | 'explainer' | 'exercise' | 'loading' | 'reveal'

interface ReadingResponse {
  reading: string
  personality: {
    type: string
    name: string
    emoji: string
    headline: string
    description: string
    breakdown: Record<ValueQuadrant, { total: number; percentage: number; count: number }>
  }
  fallback: boolean
  invalid?: boolean
}

// ── Component ────────────────────────────────────────────────────────────────

interface DemoFlowProps {
  initialName?: string
  initialCountry?: string | null
  isAuthenticated?: boolean
}

export function DemoFlow({ initialName = '', initialCountry = null, isAuthenticated = false }: DemoFlowProps) {
  const [step, setStep] = useState<DemoStep>(initialCountry ? 'explainer' : 'welcome')
  const [name, setName] = useState(initialName)
  const [country, setCountry] = useState<string | null>(initialCountry)
  const [results, setResults] = useState<ValueMapResult[]>([])
  const [readingData, setReadingData] = useState<ReadingResponse | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const session = useDemoSession()
  const trackEvent = useTrackEvent()
  const selectedCountry = DEMO_COUNTRIES.find((c) => c.code === country)

  // ── Welcome → Explainer ───────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    if (!country) return
    demoAnalytics('demo_started', { country })
    trackEvent('value_map_started', { mode: 'demo', country })
    setStep('explainer')
  }, [country, trackEvent])

  // ── Explainer → Exercise ──────────────────────────────────────────────────

  const handleStartExercise = useCallback(() => {
    setStep('exercise')
  }, [])

  // ── Exercise → Loading → Reveal ───────────────────────────────────────────

  const handleExerciseComplete = useCallback(async (exerciseResults: ValueMapResult[], elapsedSeconds: number) => {
    setResults(exerciseResults)
    setStep('loading')
    demoAnalytics('demo_finished', { elapsed_seconds: Math.round(elapsedSeconds), cards: exerciseResults.length })
    trackEvent('value_map_completed', { mode: 'demo', card_count: exerciseResults.length })

    // Save session to DB first (fast insert), then fetch reading with session_id
    let savedSessionId: string | null = null
    const personalityData = calculatePersonality(exerciseResults)
    const payload = session.getSessionPayload(
      exerciseResults,
      personalityData.personality,
      personalityData.breakdown,
      elapsedSeconds
    )

    if (payload) {
      try {
        const sessionRes = await fetch('/api/demo/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json()
          savedSessionId = sessionData.session_id
          setSessionId(savedSessionId)
        }
      } catch {
        // Non-critical — continue to reading even if session save fails
      }
    }

    try {
      const res = await fetch('/api/demo/reading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || 'Anonymous',
          country,
          currency: selectedCountry?.currency ?? 'GBP',
          results: exerciseResults,
          elapsed_seconds: elapsedSeconds,
          session_id: savedSessionId,
        }),
      })

      if (!res.ok) throw new Error('Reading failed')

      const data: ReadingResponse = await res.json()

      if (data.invalid) {
        setReadingData({
          ...data,
          reading: data.reading || 'You moved through those pretty quickly. Try again — take your time, and let your gut decide. The reading gets sharper when you do.',
        })
      } else {
        setReadingData(data)
      }
    } catch {
      setReadingData({
        reading: 'Your CFO is processing your results. The patterns in your spending tell a story — one that takes more than a quick glance to read. Come back soon for your full reading.',
        personality: {
          type: 'truth_teller',
          name: 'The Truth Teller',
          emoji: '\u{1F50D}',
          headline: 'You see your spending clearly.',
          description: '',
          breakdown: {
            foundation: { total: 0, percentage: 25, count: 0 },
            investment: { total: 0, percentage: 25, count: 0 },
            burden: { total: 0, percentage: 25, count: 0 },
            leak: { total: 0, percentage: 25, count: 0 },
          },
        },
        fallback: true,
      })
    }

    setStep('reveal')
  }, [name, country, selectedCountry, session, trackEvent])

  // ── Render ────────────────────────────────────────────────────────────────

  // Welcome screen
  if (step === 'welcome') {
    return (
      <div className="flex flex-col items-center justify-center gap-8 px-4 py-8 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-3 text-center">
          <CfoAvatar size="lg" />
          <h1 className="text-2xl font-semibold text-foreground">The Value Map</h1>
          <p className="text-sm text-muted-foreground max-w-xs">
            10 transactions. 2 minutes. A personality reading your bank app could never give you.
          </p>
        </div>

        {/* Name input */}
        <div className="w-full max-w-xs">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your first name (optional)"
            className="w-full rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 text-center"
          />
        </div>

        {/* Country select */}
        <div className="w-full max-w-xs">
          <p className="text-xs text-muted-foreground text-center mb-3">Where are you based?</p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_COUNTRIES.map((c) => (
              <button
                key={c.code}
                onClick={() => setCountry(c.code)}
                className={`flex items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-medium transition-all duration-150 ${
                  country === c.code
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:border-border/80 hover:text-foreground'
                }`}
              >
                <span className="text-lg">{c.flag}</span>
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Start button */}
        <Button
          onClick={handleStart}
          disabled={!country}
          className="w-full max-w-xs bg-[#E8A84C] hover:bg-[#d4963f] text-black font-semibold py-5 text-base disabled:opacity-40"
        >
          Start
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    )
  }

  // Quadrant explainer
  if (step === 'explainer') {
    return (
      <div className="flex flex-col items-center gap-6 px-4 py-8 flex-1 overflow-y-auto">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-foreground mb-2">How it works</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            For each transaction, decide which quadrant it belongs to. Trust your gut.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 w-full max-w-sm">
          {QUADRANT_ORDER.map((qId) => {
            const q = QUADRANTS[qId]
            return (
              <div
                key={qId}
                className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <span className="text-2xl shrink-0">{q.emoji}</span>
                <div>
                  <p className="text-sm font-semibold" style={{ color: q.colour }}>
                    {q.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{q.description}</p>
                </div>
              </div>
            )
          })}
        </div>

        <Button
          onClick={handleStartExercise}
          className="w-full max-w-sm bg-[#E8A84C] hover:bg-[#d4963f] text-black font-semibold py-5 text-base"
        >
          Let&apos;s go
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    )
  }

  // Card exercise
  if (step === 'exercise' && selectedCountry) {
    const transactions = getDemoTransactions(selectedCountry.code)
    return (
      <DemoCard
        transactions={transactions}
        onComplete={handleExerciseComplete}
        onFirstTap={session.startSession}
        onCardResult={session.recordResponse}
      />
    )
  }

  // Loading
  if (step === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 flex-1">
        <CfoAvatar size="lg" status="thinking" />
        <p className="text-sm text-muted-foreground animate-pulse">
          Your CFO is reading your results...
        </p>
      </div>
    )
  }

  // Reveal (includes shareable card + email capture inline)
  if (step === 'reveal' && readingData) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
        <DemoReveal
          reading={readingData.reading}
          personality={readingData.personality}
          userName={name || 'You'}
          country={country ?? 'UK'}
          results={results}
          fallback={readingData.fallback}
          sessionId={session.sessionToken}
          isAuthenticated={isAuthenticated}
        />
      </div>
    )
  }

  return null
}
