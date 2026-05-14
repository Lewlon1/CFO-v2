type Pillar = {
  title: string
  body: string
}

const PILLARS: Pillar[] = [
  {
    title: 'Commission-free, by design.',
    body:
      'Your CFO doesn’t earn anything from what you buy, switch to, or invest in. The guidance is about your outcomes — not anyone’s revenue.',
  },
  {
    title: 'Built in Europe. Your data stays yours.',
    body:
      'EU-based infrastructure, GDPR by default. Your financial data powers your CFO’s guidance — it’s never sold, shared, or used for marketing. Export or delete anytime.',
  },
  {
    title: 'Quiet by default.',
    body:
      'No dark patterns. No streaks. No notifications begging for attention. You set the rhythm — the CFO works in the background until you sit down.',
  },
  {
    title: 'Free tier, kept simple.',
    body:
      'Start free, see the gap, take the value. If you ever want more depth, there’s a paid tier — and the free tier stays available.',
  },
]

export function Trust() {
  return (
    <section className="px-6 sm:px-10 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl">
        <p className="v4-eyebrow mb-6">05 — Why you can trust it</p>

        <h2 className="v4-serif text-[36px] sm:text-[48px] leading-[1.1] tracking-tight font-normal">
          On your side.{' '}
          <em className="italic" style={{ color: 'var(--ink-fade)' }}>
            By design, not by promise.
          </em>
        </h2>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-10">
          {PILLARS.map((p) => (
            <div key={p.title}>
              <h3 className="v4-serif text-[20px] sm:text-[22px] leading-[1.3]">
                {p.title}
              </h3>
              <p className="v4-sans mt-3 text-[15px] sm:text-[16px] leading-[1.65]" style={{ color: 'var(--ink-fade)' }}>
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
