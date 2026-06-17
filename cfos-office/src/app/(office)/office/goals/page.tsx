import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/types'
import { DashboardEmptyState } from '@/components/office/dashboards/DashboardEmptyState'
import { isValueMapV2Enabled } from '@/lib/value-map/flags'
import { GoalsEmptyStateCTA } from './GoalsEmptyStateCTA'
import { GoalCard } from './GoalCard'
import { PlanProvenance } from './PlanProvenance'

type Goal = Database['public']['Tables']['goals']['Row']

export default async function GoalsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: goals } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  const activeGoals = (goals ?? []).filter((g: Goal) => g.status === 'active')
  const completedGoals = (goals ?? []).filter((g: Goal) => g.status === 'completed')

  return (
    <div className="px-3.5 pt-2 pb-24 space-y-4">
      {/* VM-4 (flag VALUE_MAP_V2): provenance only — why the plan looks the
          way it does. Goal data, maths, and ordering are untouched. */}
      {isValueMapV2Enabled() && <PlanProvenance userId={user.id} />}
      {activeGoals.length === 0 && completedGoals.length === 0 ? (
        <DashboardEmptyState
          icon={<span className="text-2xl" aria-hidden="true">◎</span>}
          title="No goals yet"
          body="Tell your CFO about a financial goal and it will track your progress here."
        >
          <GoalsEmptyStateCTA />
        </DashboardEmptyState>
      ) : (
        <div className="space-y-3">
          {activeGoals.map((goal: Goal) => (
            <GoalCard key={goal.id} goal={goal} />
          ))}
          {completedGoals.length > 0 && (
            <>
              <h2 className="font-data text-[8px] tracking-[0.08em] uppercase text-text-muted pt-3 px-1">
                Completed
              </h2>
              {completedGoals.map((goal: Goal) => (
                <GoalCard key={goal.id} goal={goal} />
              ))}
            </>
          )}
          {/* Add another goal — same CFO-chat CTA as the empty state, so the
              option to create a goal is present whether or not goals exist. */}
          <div className="flex justify-center pt-2">
            <GoalsEmptyStateCTA />
          </div>
        </div>
      )}
    </div>
  )
}
