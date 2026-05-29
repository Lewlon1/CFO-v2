'use client'

import type { InstantPayback } from '@/app/onboarding-v2/processing/processing-actions'
import { formatCurrency } from '@/lib/format/currency'

type Props = {
  payback: InstantPayback | null
}

/**
 * One-liner payback rendered immediately below the income input once the
 * user confirms a value. Reads pre-computed pace from the active goal — no
 * arithmetic happens here. When there is no goal (Marcus / skipped path)
 * or the goal lacks a target_date, the component renders nothing.
 */
export function GoalPaceInline({ payback }: Props) {
  if (!payback) return null
  if (payback.kind !== 'goal_pace') return null

  const monthly = formatCurrency(
    payback.monthly_required_saving,
    payback.currency,
  )

  return (
    <p className="text-sm text-text-secondary leading-snug">
      Your <span className="text-text-primary">{payback.goal_name}</span>{' '}
      goal needs about{' '}
      <span className="text-text-primary font-medium">{monthly}</span> a month
      at the pace you set
      {payback.percent_of_income != null && (
        <>
          {' '}
          — roughly{' '}
          <span className="text-text-primary font-medium">
            {payback.percent_of_income}%
          </span>{' '}
          of your take-home
        </>
      )}
      .
    </p>
  )
}
