import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = {
  title: "The CFO's Office — Private Beta",
  description:
    "An AI-powered personal CFO that gets to know your finances and helps you grow your long-term wealth. Private beta — invite only.",
}

export default async function LandingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/office')
  }

  return (
    <main className="min-h-dvh flex flex-col items-center px-6 py-10 sm:py-16">
      <div className="w-full max-w-[580px] flex flex-col items-center">
        {/* Logo + wordmark */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-9 h-9 rounded-sm bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg">
            £
          </div>
          <span className="text-lg font-semibold text-foreground">
            The CFO&apos;s Office
          </span>
        </div>

        {/* Beta badge with pulsing dot */}
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] uppercase tracking-wider text-muted-foreground mb-10">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          Private Beta
        </span>

        {/* Mission headline */}
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold text-foreground leading-tight text-center max-w-lg">
          Financial clarity shouldn&apos;t require a finance degree.
        </h1>
        <p className="mt-4 text-sm sm:text-base text-muted-foreground text-center max-w-md leading-relaxed">
          The CFO&apos;s Office pairs you with an AI that gets to know your
          finances inside out. The more you share, the sharper the guidance —
          your CFO loves to get into the details. Spend less time figuring out
          how to grow your long-term wealth, and more time actually doing it.
        </p>

        {/* Value proposition cards */}
        <div className="mt-10 w-full space-y-3">
          <div className="rounded-lg border border-border bg-card p-4 flex gap-3">
            <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">📊</span>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Share your transactions, tell your CFO about your bills, savings,
              debts — the more context it has, the more specific and useful every
              conversation gets.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 flex gap-3">
            <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">💬</span>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Ask anything about your money. Get answers grounded in your real
              numbers, not generic tips from someone who doesn&apos;t know your
              situation.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4 flex gap-3">
            <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">🧭</span>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Build a strategy that fits your life. Whether it&apos;s clearing
              debt, saving for a move, or just knowing where it all goes — your
              CFO helps you map the path.
            </p>
          </div>
        </div>

        {/* CTAs */}
        <div className="mt-10 flex flex-col items-center gap-3 w-full max-w-xs">
          <Link
            href="/login"
            className="w-full inline-flex items-center justify-center h-12 px-6 rounded-md bg-primary text-primary-foreground font-medium text-base transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="w-full inline-flex items-center justify-center h-12 px-6 rounded-md border border-border text-foreground font-medium text-base transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Create an account
          </Link>
        </div>

        {/* Divider */}
        <div className="w-full my-12">
          <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        </div>

        {/* A note from Lewis */}
        <section className="w-full">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm flex-shrink-0">
              L
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">A note from Lewis</p>
              <p className="text-xs text-muted-foreground">Founder</p>
            </div>
          </div>
          <div className="text-sm text-muted-foreground leading-relaxed space-y-3">
            <p>
              Thanks for being part of the beta. This is an early version of
              something I&apos;ve been building for a while — an AI-powered CFO
              that works with your real financial data to give you specific,
              useful guidance you can actually act on.
            </p>
            <p>
              It&apos;s not finished. Things will break, some answers won&apos;t
              be perfect, and the design is still evolving. That&apos;s exactly
              why your feedback matters so much right now.
            </p>
            <div>
              <p className="font-medium text-foreground mb-2">How to give feedback:</p>
              <div className="space-y-2">
                <p>
                  <span aria-hidden="true">👍👎</span>{' '}
                  Use the thumbs up/down on any message from your CFO. This is
                  the single most useful thing you can do — it tells me exactly
                  what&apos;s working and what isn&apos;t.
                </p>
                <p>
                  <span aria-hidden="true">💬</span>{' '}
                  For anything else — bugs, suggestions, ideas, complaints —
                  message me directly on WhatsApp. I read everything.
                </p>
              </div>
            </div>
            <p>
              The more honest you are, the better this gets for everyone.
              Don&apos;t hold back.
            </p>
          </div>
        </section>

        {/* Divider */}
        <div className="w-full my-10">
          <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        </div>

        {/* Data & Privacy */}
        <section className="w-full flex gap-3">
          <span className="text-lg flex-shrink-0 mt-0.5" aria-hidden="true">🔒</span>
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">Your data is safe.</span>{' '}
            Everything is handled in line with GDPR. Your financial data is used
            only to power your CFO&apos;s guidance — it&apos;s never sold, shared,
            or used for marketing. You can export or delete your data at any time.
          </p>
        </section>

        {/* Footer */}
        <footer className="mt-12 mb-4 text-xs text-muted-foreground font-mono">
          The CFO&apos;s Office &copy; 2026
        </footer>
      </div>
    </main>
  )
}
