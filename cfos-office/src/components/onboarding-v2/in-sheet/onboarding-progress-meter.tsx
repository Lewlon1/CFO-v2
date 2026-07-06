import type { OnboardingProgressResult } from '@/lib/onboarding-v2/onboarding-progress'

/**
 * The "C. knows you · n%" progress meter for the optional-upload onboarding
 * flow. The percentage is the only user-visible number; the chips are
 * plain-word buckets (one per progress part) that light as the user gives more.
 * Adapted from PR70's KnowsYouMeter to this flow's progress model.
 */
export function OnboardingProgressMeter({ result }: { result: OnboardingProgressResult }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0" role="status" aria-label={`Setup progress: ${result.pct}%`}>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[13px] text-text-secondary">C. knows you</span>
        <span className="text-[13px] text-text-muted" aria-hidden="true">·</span>
        <span className="text-[13px] font-bold text-accent-gold tabular-nums">
          {result.pct}%
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {result.parts.map((part) => (
          <span
            key={part.label}
            className={
              'text-[9px] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded-pill border ' +
              (part.earned
                ? 'text-accent-gold border-accent-gold/40 bg-accent-gold/10'
                : 'text-text-muted border-border-medium')
            }
          >
            {part.label}
          </span>
        ))}
      </div>
    </div>
  )
}
