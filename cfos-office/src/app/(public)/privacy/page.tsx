import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: "Privacy Notice | The CFO's Office",
  description:
    "How The CFO's Office collects, uses, and protects your personal and financial data.",
}

export default function PrivacyPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between py-4 px-4 border-b">
        <Link href="/" className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-sm bg-primary" />
          <span className="text-[15px] font-medium text-foreground">
            The <span className="text-primary">CFO&apos;s</span> Office
          </span>
        </Link>
        <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground">
          Terms
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 md:py-12">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">Privacy Notice</h1>
        <p className="text-sm text-muted-foreground mb-10">
          Last updated: 9 April 2026 · Version 1.0
        </p>

        <div className="space-y-8 text-[15px] leading-relaxed text-foreground">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Who we are</h2>
            <p>
              The CFO&apos;s Office is a personal finance coaching product currently in closed
              beta. If you have any questions about this notice or how your data is handled,
              contact us at{' '}
              <a href="mailto:hello@cfos.office" className="underline">
                hello@cfos.office
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. What data we collect</h2>
            <ul className="list-disc list-outside ml-5 space-y-1">
              <li>
                <strong>Account data:</strong> email address, display name, country, primary
                currency.
              </li>
              <li>
                <strong>Financial data:</strong> transactions you upload via CSV (date,
                description, amount, currency), plus any categorisation or tagging you add.
              </li>
              <li>
                <strong>Profile information:</strong> anything you share in chat about your
                income, goals, living situation, preferences.
              </li>
              <li>
                <strong>Conversation history:</strong> the messages you exchange with the AI
                CFO.
              </li>
              <li>
                <strong>Value Map results:</strong> how you categorised the 10 sample
                transactions in the pre-signup psychology test.
              </li>
              <li>
                <strong>Analytics events:</strong> which features you use, how often, and when
                — used to improve the product.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Why we process it</h2>
            <p>
              We process your data to provide personalised financial coaching. The lawful
              bases are GDPR Article 6(1)(b) (performance of a contract — the service you
              signed up for) and Article 6(1)(a) (your consent, specifically for AI-powered
              analysis of your financial data).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. How AI is used</h2>
            <p>
              Your financial data is sent to Claude (via AWS Bedrock) to generate personalised
              advice, summaries, and insights. Claude does not retain your data between
              conversations — each request is processed in isolation. We do not use your data
              to train any AI models.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Who we share data with</h2>
            <p>We share data only with the third-party infrastructure providers that run the service:</p>
            <ul className="list-disc list-outside ml-5 mt-2 space-y-1">
              <li>
                <strong>Supabase</strong> (database and authentication) — EU region.
              </li>
              <li>
                <strong>AWS Bedrock</strong> (Claude inference) — EU region.
              </li>
              <li>
                <strong>Vercel</strong> (web hosting).
              </li>
            </ul>
            <p className="mt-2">
              We do not sell your data. We do not share it with advertisers. We do not use it
              for any purpose unrelated to running this service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Data retention</h2>
            <p>
              Your data is retained for as long as your account is active. You can export or
              permanently delete your account at any time from the Settings page. Account
              deletion wipes every row we hold for you across every table, plus your
              authentication record.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Your rights</h2>
            <p>Under GDPR you have the right to:</p>
            <ul className="list-disc list-outside ml-5 mt-2 space-y-1">
              <li>Access a copy of your data (Settings → Export my data)</li>
              <li>Correct inaccurate data (Settings → Profile)</li>
              <li>Delete your data (Settings → Delete my account)</li>
              <li>Export your data in a portable format (Settings → Export my data)</li>
              <li>Restrict or object to processing</li>
              <li>Lodge a complaint with your local data protection authority</li>
            </ul>
            <p className="mt-2">
              To exercise any of these rights, use the Settings page or email us at{' '}
              <a href="mailto:hello@cfos.office" className="underline">
                hello@cfos.office
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Security</h2>
            <p>
              All data is encrypted at rest and in transit. We use row-level security in the
              database so you can only ever access your own records. We never log personal
              identifying information to the client. We hash IP addresses before storing them.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Cookies</h2>
            <p>
              We only use essential cookies for session authentication. We do not use
              analytics, tracking, or advertising cookies.
            </p>
          </section>

          <section className="pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              This notice is plain-English and deliberately short. It reflects how the product
              actually works today. If anything changes materially, we&apos;ll update the
              version number at the top and contact you.
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
