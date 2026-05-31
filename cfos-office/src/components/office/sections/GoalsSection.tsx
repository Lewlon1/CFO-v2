import Link from 'next/link'
import { formatCurrencyRounded } from '@/lib/utils/format-currency-rounded'
import type { PrimaryGoal } from '@/lib/goals/primary-goal'
import { GoalsEmptyState } from './GoalsEmptyState'

interface GoalsSectionProps {
  goal: PrimaryGoal | null
  currency?: string
  upcomingEventsCount?: number
}

export function GoalsSection({ goal, currency = 'EUR', upcomingEventsCount = 0 }: GoalsSectionProps) {
  if (!goal && upcomingEventsCount === 0) {
    return <GoalsEmptyState />
  }

  return (
    <div className="space-y-2 pt-1">
      {goal && <ActiveGoalSummary goal={goal} currency={currency} />}
      <Link
        href="/office/goals/travel-events"
        className="flex items-center justify-between gap-2 py-1 text-label text-text-secondary hover:text-text-primary transition-colors"
      >
        <span>Travel &amp; Events</span>
        <span className="tabular-nums text-text-tertiary">
          {upcomingEventsCount === 0
            ? 'None planned'
            : `${upcomingEventsCount} upcoming`}
        </span>
      </Link>
    </div>
  )
}

function ActiveGoalSummary({ goal, currency }: { goal: PrimaryGoal; currency: string }) {
  const current = Math.max(0, goal.current_amount ?? 0)
  const target = goal.target_amount ?? 0
  const hasTarget = target > 0
  const pct = hasTarget ? Math.min(100, Math.round((current / target) * 100)) : null
  const onTrack = goal.on_track

  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-1.5">
        <span className="font-data text-h1 font-extrabold tracking-[-0.03em] text-text-primary tabular-nums">
          {formatCurrencyRounded(current, currency)}
        </span>
        {hasTarget && (
          <>
            <span className="text-label text-text-tertiary">
              of {formatCurrencyRounded(target, currency)}
            </span>
            {pct != null && (
              <span className="text-label ml-auto text-text-secondary tabular-nums">
                {pct}%
              </span>
            )}
          </>
        )}
      </div>
      {(onTrack != null || goal.monthly_required_saving) && (
        <div className="flex items-center gap-2 text-label">
          {onTrack != null && (
            <span
              style={{
                color: onTrack ? 'var(--positive)' : 'var(--negative)',
              }}
            >
              {onTrack ? 'On track' : 'Behind'}
            </span>
          )}
          {goal.monthly_required_saving != null && goal.monthly_required_saving > 0 && (
            <span className="text-text-tertiary">
              · {formatCurrencyRounded(goal.monthly_required_saving, currency)}/mo needed
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default GoalsSection
