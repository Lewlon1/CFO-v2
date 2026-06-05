import type { ToolContext } from '@/lib/ai/tools/types'
import { updateAssetPortrait } from '@/lib/balance-sheet/portrait'
import { refreshCurrentNetWorthSnapshot } from '@/lib/analytics/net-worth-snapshot'

export type LiabilityType =
  | 'mortgage'
  | 'student_loan'
  | 'credit_card'
  | 'personal_loan'
  | 'car_finance'
  | 'bnpl'
  | 'overdraft'
  | 'other'

/** Infer a liability_type from a debt-clearance goal's name. */
export function inferLiabilityType(goalName: string): LiabilityType {
  const n = goalName.toLowerCase()
  if (/\bcard\b|credit/.test(n)) return 'credit_card'
  if (/mortgage/.test(n)) return 'mortgage'
  if (/student/.test(n)) return 'student_loan'
  if (/overdraft/.test(n)) return 'overdraft'
  if (/\b(car|auto|vehicle)\b/.test(n)) return 'car_finance'
  if (/loan|finance/.test(n)) return 'personal_loan'
  return 'other'
}

/**
 * Ensure a liability row exists for a debt-clearance goal, so the payoff tools
 * (calculate_debt_payoff → reads liabilities.outstanding_balance) have a balance
 * to work from.
 *
 * Why this exists: onboarding's goal beat states the card balance ("clear the
 * $5,000 card") but only ever wrote it to goals.target_amount — never to the
 * balance sheet. Later the CFO couldn't run payoff pace and re-asked for a
 * balance the user had already given ("the earlier mention didn't get
 * captured"). This closes that gap deterministically, rather than relying on
 * the model to remember to call upsert_liability.
 *
 * Dedups by (liability_type, name) and never clobbers a balance the user has
 * already set — it only seeds an empty one. Best-effort: failures are logged,
 * never thrown (goal creation must not fail because of this).
 */
export async function ensureLiabilityForDebtGoal(
  ctx: ToolContext,
  args: { goalId: string; goalName: string; balance: number; currency: string },
): Promise<void> {
  const { goalId, goalName, balance, currency } = args
  if (!Number.isFinite(balance) || balance <= 0) return

  const liabilityType = inferLiabilityType(goalName)
  const nowIso = new Date().toISOString()

  try {
    // Dedup: same user + type + name (case-insensitive). Re-stating the goal
    // must not spawn a duplicate liability.
    const { data: dupe } = await ctx.supabase
      .from('liabilities')
      .select('id, outstanding_balance')
      .eq('user_id', ctx.userId)
      .eq('liability_type', liabilityType)
      .ilike('name', goalName)
      .maybeSingle()

    if (dupe?.id) {
      // Only seed a balance that's currently empty — never overwrite a figure
      // the user (or a richer upsert_liability call) already set.
      if (Number(dupe.outstanding_balance ?? 0) > 0) return
      const { error } = await ctx.supabase
        .from('liabilities')
        .update({ outstanding_balance: balance, last_updated: nowIso })
        .eq('id', dupe.id)
        .eq('user_id', ctx.userId)
      if (error) {
        console.error('[liability-from-goal] seed-balance update failed:', error)
        return
      }
    } else {
      const { error } = await ctx.supabase.from('liabilities').insert({
        user_id: ctx.userId,
        liability_type: liabilityType,
        name: goalName,
        currency,
        outstanding_balance: balance,
        payment_frequency: 'monthly',
        is_priority: false,
        details: { related_goal_id: goalId, seeded_from: 'debt_clearance_goal' },
        source: 'chat',
        last_updated: nowIso,
      })
      if (error) {
        console.error('[liability-from-goal] insert failed:', error)
        return
      }
    }

    await updateAssetPortrait(ctx)
    await refreshCurrentNetWorthSnapshot(ctx.supabase, ctx.userId)
  } catch (err) {
    console.error('[liability-from-goal] unexpected error:', err)
  }
}
