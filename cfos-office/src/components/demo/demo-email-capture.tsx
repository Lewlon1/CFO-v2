'use client'

import { useState, useCallback } from 'react'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { demoAnalytics } from '@/lib/demo/analytics'
import { cn } from '@/lib/utils'

interface DemoEmailCaptureProps {
  defaultName: string
  country: string
  personality: string | null
  readingText: string | null
  resultsJson: unknown
  resonanceRating: number | null
  sessionId: string | null
}

export function DemoEmailCapture({
  defaultName,
  country,
  personality,
  readingText,
  resultsJson,
  resonanceRating,
  sessionId,
}: DemoEmailCaptureProps) {
  const [name, setName] = useState(defaultName)
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !name || !consent || submitting) return

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/demo/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          country,
          personality,
          reading_text: readingText,
          results_json: resultsJson,
          resonance_rating: resonanceRating,
          session_id: sessionId,
          consent: true,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to sign up')
      }

      setSubmitted(true)
      demoAnalytics('demo_email_submitted')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      demoAnalytics('demo_email_failed')
    } finally {
      setSubmitting(false)
    }
  }, [email, name, consent, submitting, country, personality, readingText, resultsJson, sessionId])

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
        <CheckCircle2 className="h-10 w-10 text-green-400" />
        <h3 className="text-lg font-semibold text-foreground">You&apos;re in.</h3>
        <p className="text-sm text-muted-foreground max-w-xs">
          We&apos;ll send you one email when The CFO&apos;s Office is ready to launch. That&apos;s it.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 px-4 pt-2 pb-4">
      <div className="text-center max-w-xs">
        <h3 className="text-base font-semibold text-foreground mb-1">Get notified when we launch</h3>
        <p className="text-sm text-muted-foreground">
          Leave your email and we&apos;ll send you one message — the day The CFO&apos;s Office goes live.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-xs flex flex-col gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          required
          className="w-full rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          autoComplete="email"
          required
          className="w-full rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />

        {/* Consent checkbox */}
        <label className="flex items-start gap-2.5 cursor-pointer">
          <div className="relative mt-0.5 shrink-0">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="sr-only"
            />
            <div
              className={cn(
                'h-5 w-5 rounded border-2 transition-colors duration-150 flex items-center justify-center',
                consent
                  ? 'border-[#E8A84C] bg-[#E8A84C]'
                  : 'border-border bg-transparent',
              )}
            >
              {consent && (
                <svg className="h-2.5 w-2.5 text-black" fill="none" viewBox="0 0 10 8">
                  <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          </div>
          <span className="text-sm text-muted-foreground leading-relaxed">
            I&apos;m happy to hear from The CFO&apos;s Office about the product launch. No spam — only relevant updates about when the full app is available. My results are stored securely and will not be shared with third parties.
          </span>
        </label>

        {error && (
          <p className="text-xs text-red-400 text-center">{error}</p>
        )}

        <Button
          type="submit"
          disabled={submitting || !email || !name || !consent}
          className="w-full bg-[#E8A84C] hover:bg-[#d4963f] text-black font-semibold py-5 text-base disabled:opacity-50"
        >
          {submitting ? 'Joining...' : (
            <>
              Notify me at launch
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </>
          )}
        </Button>
      </form>
    </div>
  )
}
