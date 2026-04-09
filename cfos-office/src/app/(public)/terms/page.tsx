import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: "Terms of Service | The CFO's Office",
  description: "The terms you agree to when using The CFO's Office during beta.",
}

export default function TermsPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between py-4 px-4 border-b">
        <Link href="/" className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-sm bg-primary" />
          <span className="text-[15px] font-medium text-foreground">
            The <span className="text-primary">CFO&apos;s</span> Office
          </span>
        </Link>
        <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground">
          Privacy
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 md:py-12">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-10">
          Last updated: 9 April 2026 · Version 1.0
        </p>

        <div className="space-y-8 text-[15px] leading-relaxed text-foreground">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. What this is</h2>
            <p>
              The CFO&apos;s Office is a personal finance coaching product, currently in
              closed beta. By creating an account you agree to these terms and to our{' '}
              <Link href="/privacy" className="underline">
                Privacy Notice
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Not regulated financial advice</h2>
            <p>
              The CFO&apos;s Office is <strong>not</strong> a licensed financial advisor and
              does not provide regulated financial, investment, tax, legal, or insurance
              advice. The insights and suggestions the product gives you are informational
              only. Decisions about your money are yours alone.
            </p>
            <p className="mt-2">
              If you need regulated advice, speak to a qualified financial advisor in your
              jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Beta service</h2>
            <p>
              The product is provided on an &quot;as-is&quot; basis during beta. Things may
              break, change, or disappear without warning. We aim to preserve your data
              through changes, but you should keep your own copies of anything important (use
              Settings → Export my data).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Your responsibilities</h2>
            <ul className="list-disc list-outside ml-5 space-y-1">
              <li>Only upload data that belongs to you.</li>
              <li>Keep your login credentials safe and don&apos;t share them.</li>
              <li>Don&apos;t attempt to break, probe, or reverse-engineer the service.</li>
              <li>Don&apos;t use the service for anything illegal.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Our responsibilities</h2>
            <ul className="list-disc list-outside ml-5 space-y-1">
              <li>Treat your data with care and apply the controls described in the Privacy Notice.</li>
              <li>Let you export or delete your data at any time.</li>
              <li>Tell you if something material changes — including these terms.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Accuracy</h2>
            <p>
              The AI CFO will occasionally get things wrong. Numbers come from the data you
              provide; explanations come from a language model. Always sanity-check anything
              that matters before acting on it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Termination</h2>
            <p>
              You can delete your account at any time from Settings. We can suspend or
              terminate accounts that violate these terms. If we terminate your account, your
              data is deleted the same way as if you had deleted it yourself.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Liability</h2>
            <p>
              To the maximum extent permitted by law, we are not liable for losses arising
              from your use of the service, including financial decisions you make based on
              information you receive from the product. This does not affect any statutory
              rights you have as a consumer.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Contact</h2>
            <p>
              Questions about these terms? Email{' '}
              <a href="mailto:hello@cfos.office" className="underline">
                hello@cfos.office
              </a>
              .
            </p>
          </section>

          <section className="pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              These terms are deliberately short. For 3 beta users who trust us, a clear
              honest summary is better than a lawyer-drafted wall of text. We will update
              this before opening to a wider audience.
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
