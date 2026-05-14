import { formatCurrencyRounded } from '@/lib/utils/format-currency-rounded'
import type { PrimaryGoal } from '@/lib/goals/primary-goal'
import { GoalsEmptyState } from './GoalsEmptyState'

interface GoalsSectionProps {
  goal: PrimaryGoal | null
  currency?: string
}

export function GoalsSection({ goal, currency = 'EUR' }: GoalsSectionProps) {
  if (!goal) {
    return <GoalsEmptyState />
  }

  const current = Math.max(0, goal.current_amount ?? 0)
  const target = goal.target_amount ?? 0
  const hasTarget = target > 0
  const pct = hasTarget ? Math.min(100, Math.round((current / target) * 100)) : null
  const onTrack = goal.on_track

  return (
    <div className="space-y-1 pt-1">
      <div className="flex items-baseline gap-1.5">
        <span className="font-data text-[18px] font-extrabold tracking-[-0.03em] text-text-primary tabular-nums">
          {formatCurrencyRounded(current, currency)}
        </span>
        {hasTarget && (
          <>
            <span className="text-[11px] text-text-tertiary">
              of {formatCurrencyRounded(target, currency)}
            </span>
            {pct != null && (
              <span className="text-[11px] ml-auto text-text-secondary tabular-nums">
                {pct}%
              </span>
            )}
          </>
        )}
      </div>
      {(onTrack != null || goal.monthly_required_saving) && (
        <div className="flex items-center gap-2 text-[11px]">
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
