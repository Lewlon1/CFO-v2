'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { useTrackEvent } from '@/lib/events/use-track-event'

function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const trackEvent = useTrackEvent()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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

    // Track signup + link anonymous demo session if present
    let hasValueMap = false
    if (data.user) {
      trackEvent('signup_completed', { method: 'email' })
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
    }

    router.push(hasValueMap ? '/chat?type=onboarding' : '/chat?type=onboarding_no_vm')
    router.refresh()
  }

  return (
    <>
      <h2 className="text-lg font-semibold text-foreground mb-2">Create your account</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Just email and password — nothing else. You can tell us more over time.
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
            className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="you@example.com"
          />
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
            className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="At least 8 characters"
          />
        </div>

        <Button
          type="submit"
          disabled={loading}
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
