import Link from 'next/link'

export function BottomCta() {
  return (
    <section className="px-6 sm:px-10 pt-4 pb-24 sm:pb-32">
      <div className="mx-auto max-w-3xl flex flex-col items-center text-center">
        <h2 className="v4-serif text-[36px] sm:text-[52px] leading-[1.08] tracking-tight font-normal">
          More from your money.{' '}
          <em className="italic" style={{ color: 'var(--ink-fade)' }}>
            Five minutes from now.
          </em>
        </h2>

        <p className="v4-serif italic mt-6 text-[18px] sm:text-[20px]" style={{ color: 'var(--ink-fade)' }}>
          Free to try. No card. No spreadsheets.
        </p>

        <div className="mt-10">
          <Link href="/signup" className="v4-cta">
            Meet your CFO →
          </Link>
        </div>
      </div>
    </section>
  )
}
