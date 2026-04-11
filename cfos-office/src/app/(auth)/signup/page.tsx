'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { calculateProfileCompleteness } from '@/lib/profiling/engine'

// Country list (code → currency). Kept short for beta.
const COUNTRIES = [
  { code: 'ES', name: 'Spain', currency: 'EUR' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
  { code: 'IE', name: 'Ireland', currency: 'EUR' },
  { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
  { code: 'PT', name: 'Portugal', currency: 'EUR' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR' },
  { code: 'IT', name: 'Italy', currency: 'EUR' },
] as const

function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const trackEvent = useTrackEvent()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  // Auto-detect country from browser locale as an initial default (user can change).
  const [country, setCountry] = useState<string>(() => {
    if (typeof navigator === 'undefined') return ''
    const locale = navigator.language || navigator.languages?.[0]
    if (!locale) return ''
    const regionCode = locale.split('-')[1]?.toUpperCase()
    if (regionCode && COUNTRIES.some(c => c.code === regionCode)) {
      return regionCode
    }
    return ''
  })
  const [password, setPassword] = useState('')
  const [consentChecked, setConsentChecked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Store session_token from Value Map demo in localStorage
  useEffect(() => {
    const sessionToken = searchParams.get('session_token')
    if (sessionToken) {
      localStorage.setItem('cfos_demo_session_token', sessionToken)
    }
  }, [searchParams])

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // Track signup + persist name/country/currency + link Value Map session
    let hasValueMap = false
    if (data.user) {
      const selectedCountry = COUNTRIES.find(c => c.code === country)
      const primaryCurrency = selectedCountry?.currency ?? 'EUR'
      const trimmedName = displayName.trim()

      // Persist profile fields and recompute completeness in one update.
      // display_name is not in the question registry so it doesn't affect
      // completeness; country + primary_currency are both weight 3.
      const completeness = calculateProfileCompleteness({
        display_name: trimmedName,
        country,
        primary_currency: primaryCurrency,
      })

      const { error: profileError } = await supabase
        .from('user_profiles')
        .update({
          display_name: trimmedName,
          country,
          primary_currency: primaryCurrency,
          profile_completeness: completeness,
        })
        .eq('id', data.user.id)

      if (profileError) {
        // Non-fatal — user is signed up, profile fields can fill in later.
        console.error('Profile update after signup failed:', profileError)
      }

      trackEvent('signup_completed', {
        method: 'email',
        country,
        currency: primaryCurrency,
      })

      const sessionToken = localStorage.getItem('cfos_demo_session_token')
      if (sessionToken) {
        try {
          const res = await fetch('/api/value-map/link-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_token: sessionToken }),
          })
          const json = await res.json()
          hasValueMap = json?.linked === true
          localStorage.removeItem('cfos_demo_session_token')
        } catch {
          // Non-critical — proceed regardless
        }
      }

      // Record GDPR consent. The checkbox was required to submit the form,
      // so by this point the user has granted all three consents. Non-fatal
      // on failure — we surface it in the console but don't block the flow
      // since the user is already authenticated.
      try {
        await fetch('/api/account/consent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            consents: [
              { type: 'terms_of_service', version: '1.0' },
              { type: 'privacy_policy', version: '1.0' },
              { type: 'data_processing', version: '1.0' },
            ],
          }),
        })
      } catch (consentErr) {
        console.warn('Consent recording failed (non-fatal):', consentErr)
      }
    }

    router.push(hasValueMap ? '/chat?type=onboarding' : '/chat?type=onboarding_no_vm')
    router.refresh()
  }

  return (
    <>
      <h2 className="text-lg font-semibold text-foreground mb-2">Create your account</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Four quick fields — then let&apos;s look at your numbers.
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSignup} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm text-muted-foreground mb-1.5">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="name" className="block text-sm text-muted-foreground mb-1.5">
            First name
          </label>
          <input
            id="name"
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            required
            autoComplete="given-name"
            className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Your first name"
          />
        </div>

        <div>
          <label htmlFor="country" className="block text-sm text-muted-foreground mb-1.5">
            Country
          </label>
          <select
            id="country"
            value={country}
            onChange={e => setCountry(e.target.value)}
            required
            className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-base focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Select your country</option>
            {COUNTRIES.map(c => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="password" className="block text-sm text-muted-foreground mb-1.5">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="At least 8 characters"
          />
        </div>

        <label className="flex items-start gap-2.5 text-sm text-muted-foreground pt-1">
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={e => setConsentChecked(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-2 focus:ring-ring"
          />
          <span>
            I agree to the{' '}
            <Link href="/terms" target="_blank" className="underline text-foreground">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" target="_blank" className="underline text-foreground">
              Privacy Notice
            </Link>
            . I understand my financial data will be processed by AI to provide personalised
            advice.
          </span>
        </label>

        <Button
          type="submit"
          disabled={loading || !consentChecked}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
        >
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  )
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="text-muted-foreground text-sm">Loading…</div>}>
      <SignupForm />
    </Suspense>
  )
}
