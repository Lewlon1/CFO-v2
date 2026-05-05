type Capability = {
  index: string
  title: string
  question: string
  body: React.ReactNode
  timeLine: string
}

const CAPABILITIES: Capability[] = [
  {
    index: '01',
    title: 'Everyday money management',
    question: '"Where does it all go — and am I paying too much for any of this?"',
    body: (
      <>
        It starts with your <em className="italic">Value Map</em> — a five-minute exercise
        where you tell your CFO what each kind of spending means to you. From there, your
        CFO reads your transactions, names the patterns, and audits everything you pay
        monthly. The <em className="italic">Leak</em> gets surfaced. The{' '}
        <em className="italic">Foundation</em> gets confirmed. Your categories, your call.
      </>
    ),
    timeLine:
      'What used to be a Sunday afternoon with spreadsheets — done in the time it takes to make a coffee.',
  },
  {
    index: '02',
    title: 'Planning & goals',
    question: '"What am I actually building toward?"',
    body: (
      <>
        Bring the goals you&rsquo;re working on — a deposit, a sabbatical, paying down the
        card, leaving the job. Your CFO turns each one into a concrete plan with monthly
        numbers, runway, and the trade-offs you&rsquo;d be making. You see the path
        before you commit.
      </>
    ),
    timeLine: 'A real plan, not a vibe. In one conversation.',
  },
  {
    index: '03',
    title: 'Ongoing advisory',
    question: '"What did we agree last time?"',
    body: (
      <>
        The relationship. Your CFO remembers what you said you&rsquo;d do, checks back
        when you next sit down, and flags drift before it becomes a problem. Every
        conversation builds on the last one.
      </>
    ),
    timeLine:
      'No starting from scratch. No re-explaining yourself. The work compounds.',
  },
  {
    index: '04',
    title: 'Investing & wealth building',
    question: '"Is my money actually growing — and at what cost?"',
    body: (
      <>
        A read on what you hold, what it&rsquo;s costing you in fees, and how it lines up
        with the goals you&rsquo;ve set. Your CFO is commission-free — the recommendations
        are about your outcomes, not anyone&rsquo;s revenue.
      </>
    ),
    timeLine: 'No product pushing. No fee dressing. Just the maths, plainly.',
  },
  {
    index: '05',
    title: 'Life events & protection',
    question: '"What happens if life changes — kids, a move, a redundancy?"',
    body: (
      <>
        The big shifts — buying, moving, a new job, a partner, children, illness — get
        modelled before you hit them. Your CFO walks through what changes, what to put
        in place, and what becomes possible.
      </>
    ),
    timeLine: 'Decisions made calmly, in advance — not in the moment.',
  },
]

export function Capabilities() {
  return (
    <section className="px-6 sm:px-10 py-20 sm:py-28">
      <div className="mx-auto max-w-3xl">
        <p className="v4-eyebrow mb-6">01 — What your CFO does</p>

        <h2 className="v4-serif text-[36px] sm:text-[48px] leading-[1.1] tracking-tight font-normal">
          Five things your CFO does for you.
        </h2>
        <p className="v4-serif italic mt-4 text-[18px] sm:text-[20px]" style={{ color: 'var(--ink-fade)' }}>
          The work, broken down.
        </p>

        <div className="mt-12">
          {CAPABILITIES.map((cap) => (
            <article key={cap.index} className="v4-capability">
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-8">
                <div className="sm:w-24 flex-shrink-0">
                  <span className="v4-mono text-[11px] tracking-[0.18em]" style={{ color: 'var(--ink-quiet)' }}>
                    {cap.index}
                  </span>
                </div>
                <div className="flex-1">
                  <h3 className="v4-serif text-[22px] sm:text-[26px] leading-[1.2]">
                    {cap.title}
                  </h3>
                  <p className="v4-serif italic mt-3 text-[16px] sm:text-[18px]" style={{ color: 'var(--ink-fade)' }}>
                    {cap.question}
                  </p>
                  <p className="v4-sans mt-4 text-[15px] sm:text-[16px] leading-[1.65]">
                    {cap.body}
                  </p>
                  <p className="v4-serif italic mt-4 text-[14px] sm:text-[15px]" style={{ color: 'var(--ink-quiet)' }}>
                    {cap.timeLine}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
