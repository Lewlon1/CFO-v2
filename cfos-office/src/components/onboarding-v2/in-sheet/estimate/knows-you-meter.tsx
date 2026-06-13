import type { KnowsYouResult, KnowsYouPartKey } from '@/lib/onboarding-v2/knows-you'

/**
 * The "C. knows you · n%" status-line meter (OB-2). Replaces "Your CFO is
 * online" during the estimates-first onboarding. The percentage is the ONLY
 * sanctioned user-visible number; the five chips are plain-word buckets that
 * light as the user gives more, never numbers.
 */

const CHIPS: { label: string; keys: KnowsYouPartKey[] }[] = [
  { label: 'YOUR WORDS', keys: ['name', 'door', 'context', 'composite_relate'] },
  { label: 'THE GOAL', keys: ['goal'] },
  { label: 'THE NUMBERS', keys: ['income', 'sketch'] },
  { label: 'WHAT MATTERS', keys: ['top_value', 'verdicts'] },
  { label: 'HABITS', keys: ['statement_checked', 'value_map_done'] },
]

export function KnowsYouMeter({ knowsYou }: { knowsYou: KnowsYouResult }) {
  const earnedByKey = new Map(knowsYou.parts.map((p) => [p.key, p.earned]))
  const isLit = (keys: KnowsYouPartKey[]) =>
    keys.some((k) => (earnedByKey.get(k) ?? 0) > 0)

  return (
    <div className="flex flex-col gap-1.5 flex-1 min-w-0">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[13px] text-text-secondary">C. knows you</span>
        <span className="text-[13px] text-text-muted">·</span>
        <span className="text-[13px] font-bold text-accent-gold tabular-nums">
          {knowsYou.pct}%
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {CHIPS.map((chip) => {
          const lit = isLit(chip.keys)
          return (
            <span
              key={chip.label}
              className={
                'text-[9px] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded-pill border ' +
                (lit
                  ? 'text-accent-gold border-accent-gold/40 bg-accent-gold/10'
                  : 'text-text-muted border-border-medium')
              }
            >
              {chip.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}
