import Link from 'next/link'

export function Hero() {
  return (
    <section className="px-6 sm:px-10 pt-16 sm:pt-24 pb-20 sm:pb-28">
      <div className="mx-auto max-w-3xl flex flex-col items-center text-center">
        <p className="v4-eyebrow mb-8">
          A personal CFO · Built in Europe · On your side
        </p>

        <h1 className="v4-serif text-[44px] sm:text-[64px] md:text-[76px] leading-[1.04] tracking-tight font-normal">
          More from your money.{' '}
          <em className="italic" style={{ color: 'var(--accent)' }}>
            Less of your time.
          </em>
        </h1>

        <p className="v4-serif italic mt-8 text-[18px] sm:text-[20px] leading-[1.5] max-w-2xl" style={{ color: 'var(--ink-fade)' }}>
          The power of a full finance team at your fingertips. Your CFO runs the maths,
          keeps your money pointed at what matters to you, and coaches toward your goals.
        </p>

        <p className="v4-serif italic mt-6 text-[20px] sm:text-[24px] leading-[1.4] max-w-xl">
          You&rsquo;re the boss. We do the work.
        </p>

        <div className="mt-12 flex flex-col items-center gap-4">
          <Link href="/signup" className="v4-cta">
            Meet your CFO →
          </Link>
          <p className="v4-mono text-[11px] tracking-[0.14em] uppercase" style={{ color: 'var(--ink-quiet)' }}>
            Free to try · No card · No spreadsheets
          </p>
        </div>
      </div>
    </section>
  )
}
