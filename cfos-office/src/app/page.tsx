import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: "The CFO's Office",
  description:
    "Your money tells a story. Step into the CFO's Office to make sure it's the one you want.",
}

export default async function LandingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/chat')
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-between px-6 py-10 sm:py-16">
      <div className="flex-1 w-full max-w-xl flex flex-col items-center justify-center text-center">
        {/* Logo + wordmark */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-sm bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg">
            £
          </div>
          <span className="text-lg font-semibold text-foreground">
            The CFO&apos;s Office
          </span>
        </div>

        {/* Beta badge */}
        <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-[11px] uppercase tracking-wider text-muted-foreground mb-8">
          Private Beta · Invite only
        </span>

        {/* Headline */}
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold text-foreground leading-tight max-w-lg">
          Your money tells a story.
          <br />
          <span className="text-muted-foreground">
            Step into the CFO&apos;s Office to make sure it&apos;s the one you want.
          </span>
        </h1>

        {/* Value bullets */}
        <ul className="mt-10 space-y-4 text-left text-sm sm:text-base text-muted-foreground max-w-md w-full">
          <li className="flex gap-3">
            <span className="mt-[0.45rem] h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
            <span>
              Upload your bank data. See what your spending says about you.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-[0.45rem] h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
            <span>
              Get advice grounded in your real numbers, not generic tips.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-[0.45rem] h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
            <span>
              A CFO that knows your finances, remembers your goals, and tells you the truth.
            </span>
          </li>
        </ul>

        {/* CTA */}
        <div className="mt-12 flex flex-col items-center gap-3 w-full max-w-xs">
          <Link
            href="/login"
            className="w-full inline-flex items-center justify-center h-12 px-6 rounded-md bg-primary text-primary-foreground font-medium text-base transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Create an account
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-10 text-xs text-muted-foreground">
        Private Beta · Built by Lewis Lonsdale
      </footer>
    </main>
  )
}
