import { createClient } from '@/lib/supabase/server'
import { detectValueShifts, type ValueShift } from '@/lib/analytics/value-shift-detector'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SnapshotRow {
  month: string
  total_income: number
  total_spending: number
  surplus_deficit: number
  transaction_count: number
  spending_by_category: Record<string, number> | null
  spending_by_value_category: Record<string, number> | null
  vs_previous_month_pct: number | null
}

interface GoalRow {
  name: string
  target_amount: number | null
  current_amount: number | null
  monthly_required_saving: number | null
  on_track: boolean | null
  target_date: string | null
}

interface ActionRow {
  title: string
  status: string
  category: string | null
  priority: string | null
  due_date: string | null
  completed_at: string | null
  created_at: string
}

interface RecurringRow {
  name: string
  amount: number
  currency: string | null
  frequency: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPreviousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 1
    ? `${y - 1}-12`
    : `${y}-${String(m - 1).padStart(2, '0')}`
}

function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const date = new Date(y, m - 1)
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function formatValueBreakdown(breakdown: Record<string, number> | null, totalSpending: number): string {
  if (!breakdown || totalSpending === 0) return 'No value breakdown available.'

  const lines: string[] = []
  for (const [vc, amount] of Object.entries(breakdown)) {
    const pct = Math.round((amount / totalSpending) * 100)
    lines.push(`- ${vc}: ${amount.toFixed(2)} (${pct}%)`)
  }
  return lines.join('\n')
}

function formatShifts(shifts: ValueShift[]): string {
  if (shifts.length === 0) return 'No significant value category shifts detected this month.'

  const lines: string[] = []
  for (const shift of shifts.slice(0, 3)) {
    lines.push(`**${shift.category_name}**: ${shift.shift_narrative_hint}`)
    lines.push(`  Previous dominant: ${shift.previous_dominant ?? 'n/a'} → Current: ${shift.current_dominant ?? 'n/a'}`)
    lines.push(`  Spending change: ${shift.amount_difference >= 0 ? '+' : ''}${shift.amount_difference.toFixed(2)}`)
    if (shift.notable_transactions.length > 0) {
      lines.push(`  Key transactions:`)
      for (const txn of shift.notable_transactions) {
        lines.push(`    - ${txn.description}: ${txn.amount.toFixed(2)} (${txn.value_category})`)
      }
    }
  }
  return lines.join('\n')
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function assembleReviewContext(
  userId: string,
  reviewMonth: string // YYYY-MM
): Promise<string> {
  const supabase = await createClient()
  const prevMonth = getPreviousMonth(reviewMonth)
  const reviewMonthDate = `${reviewMonth}-01`
  const prevMonthDate = `${prevMonth}-01`

  // Fetch all data in parallel
  const [
    currentSnapResult,
    previousSnapResult,
    goalsResult,
    actionsResult,
    recurringResult,
  ] = await Promise.allSettled([
    supabase
      .from('monthly_snapshots')
      .select('month, total_income, total_spending, surplus_deficit, transaction_count, spending_by_category, spending_by_value_category, vs_previous_month_pct')
      .eq('user_id', userId)
      .eq('month', reviewMonthDate)
      .single(),
    supabase
      .from('monthly_snapshots')
      .select('month, total_income, total_spending, surplus_deficit, transaction_count, spending_by_category, spending_by_value_category, vs_previous_month_pct')
      .eq('user_id', userId)
      .eq('month', prevMonthDate)
      .single(),
    supabase
      .from('goals')
      .select('name, target_amount, current_amount, monthly_required_saving, on_track, target_date')
      .eq('user_id', userId)
      .eq('status', 'active'),
    supabase
      .from('action_items')
      .select('title, status, category, priority, due_date, completed_at, created_at')
      .eq('profile_id', userId)
      .in('status', ['pending', 'in_progress', 'completed'])
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('recurring_expenses')
      .select('name, amount, currency, frequency')
      .eq('user_id', userId),
  ])

  const currentSnap: SnapshotRow | null =
    currentSnapResult.status === 'fulfilled' ? currentSnapResult.value.data : null
  const previousSnap: SnapshotRow | null =
    previousSnapResult.status === 'fulfilled' ? previousSnapResult.value.data : null
  const goals: GoalRow[] =
    goalsResult.status === 'fulfilled' ? (goalsResult.value.data ?? []) : []
  const actions: ActionRow[] =
    actionsResult.status === 'fulfilled' ? (actionsResult.value.data ?? []) : []
  const recurring: RecurringRow[] =
    recurringResult.status === 'fulfilled' ? (recurringResult.value.data ?? []) : []

  // If no current snapshot, we can't do a review
  if (!currentSnap) {
    return `## Monthly Review Data: ${formatMonth(reviewMonth)}\n\nNo snapshot data available for this month.`
  }

  const hasPreviousMonth = previousSnap !== null

  // Detect value shifts (only if we have both months)
  let valueShifts: ValueShift[] = []
  if (hasPreviousMonth) {
    try {
      valueShifts = await detectValueShifts(supabase, userId, reviewMonth, prevMonth)
    } catch {
      // Non-fatal — continue without shifts
    }
  }

  // ── Assemble sections ──────────────────────────────────────────────────────

  const sections: string[] = []

  // Headline numbers
  sections.push(`## Monthly Review Data: ${formatMonth(reviewMonth)}`)

  sections.push(`### Headline Numbers
- Total income: ${currentSnap.total_income.toFixed(2)}
- Total spending: ${currentSnap.total_spending.toFixed(2)}
- Surplus/deficit: ${currentSnap.surplus_deficit >= 0 ? '+' : ''}${currentSnap.surplus_deficit.toFixed(2)}
- Transactions: ${currentSnap.transaction_count}`)

  // Month-over-month comparison
  if (hasPreviousMonth && previousSnap) {
    const spendingChange = currentSnap.total_spending - previousSnap.total_spending
    const spendingChangePct = previousSnap.total_spending > 0
      ? ((spendingChange / previousSnap.total_spending) * 100).toFixed(1)
      : 'n/a'
    const incomeChange = currentSnap.total_income - previousSnap.total_income

    sections.push(`### vs ${formatMonth(prevMonth)}
- Previous spending: ${previousSnap.total_spending.toFixed(2)}
- Spending change: ${spendingChange >= 0 ? '+' : ''}${spendingChange.toFixed(2)} (${spendingChangePct}%)
- Previous surplus/deficit: ${previousSnap.surplus_deficit >= 0 ? '+' : ''}${previousSnap.surplus_deficit.toFixed(2)}
- Income change: ${incomeChange >= 0 ? '+' : ''}${incomeChange.toFixed(2)}`)
  } else {
    sections.push(`### Comparison\nThis is the first reviewed month — no previous month to compare.`)
  }

  // Value breakdown
  sections.push(`### Value Breakdown (Current Month)
${formatValueBreakdown(currentSnap.spending_by_value_category, currentSnap.total_spending)}`)

  if (hasPreviousMonth && previousSnap) {
    sections.push(`### Value Breakdown (Previous Month)
${formatValueBreakdown(previousSnap.spending_by_value_category, previousSnap.total_spending)}`)
  }

  // Value shifts
  sections.push(`### Value Category Shifts
${formatShifts(valueShifts)}`)

  // Goals
  if (goals.length > 0) {
    const goalLines = goals.map(g => {
      const progress = g.target_amount && g.current_amount
        ? `${g.current_amount.toFixed(2)} / ${g.target_amount.toFixed(2)}`
        : 'no target set'
      const status = g.on_track ? 'on track' : 'off track'
      const monthly = g.monthly_required_saving
        ? ` (needs ${g.monthly_required_saving.toFixed(2)}/month)`
        : ''
      return `- ${g.name}: ${progress} — ${status}${monthly}`
    })
    sections.push(`### Active Goals\n${goalLines.join('\n')}`)
  } else {
    sections.push(`### Active Goals\nNo active goals set.`)
  }

  // Action items
  const pendingActions = actions.filter(a => a.status === 'pending' || a.status === 'in_progress')
  const completedActions = actions.filter(a => a.status === 'completed' && a.completed_at)

  const actionLines: string[] = []
  if (completedActions.length > 0) {
    actionLines.push('Recently completed:')
    for (const a of completedActions.slice(0, 5)) {
      actionLines.push(`- ✓ ${a.title} (completed ${a.completed_at?.slice(0, 10)})`)
    }
  }
  if (pendingActions.length > 0) {
    actionLines.push('Still pending:')
    for (const a of pendingActions.slice(0, 5)) {
      actionLines.push(`- ○ ${a.title} [${a.priority ?? 'medium'}]${a.due_date ? ` — due ${a.due_date}` : ''}`)
    }
  }
  if (actionLines.length === 0) {
    actionLines.push('No action items tracked yet.')
  }
  sections.push(`### Action Items\n${actionLines.join('\n')}`)

  // Recurring expenses summary
  if (recurring.length > 0) {
    const recLines = recurring
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map(r => `- ${r.name}: ${r.amount.toFixed(2)} ${r.currency ?? ''} (${r.frequency ?? 'monthly'})`)
    sections.push(`### Recurring Expenses\n${recLines.join('\n')}`)
  }

  return sections.join('\n\n')
}
