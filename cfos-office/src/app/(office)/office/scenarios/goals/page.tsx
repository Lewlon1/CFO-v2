import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/types'
import { GoalsEmptyStateCTA } from './GoalsEmptyStateCTA'

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
      {activeGoals.length === 0 && completedGoals.length === 0 ? (
        <div className="rounded-[10px] border border-[rgba(255,255,255,0.04)] bg-bg-deep p-6 text-center space-y-3">
          <div className="text-3xl" aria-hidden="true">◎</div>
          <h2 className="text-[13px] font-semibold text-text-primary">No goals yet</h2>
          <p className="text-[12px] text-text-secondary max-w-sm mx-auto">
            Tell your CFO about a financial goal and it will track your progress here.
          </p>
          <GoalsEmptyStateCTA />
        </div>
      ) : (
        <div className="space-y-3">
          {activeGoals.map((goal: Goal) => (
            <GoalCard key={goal.id} goal={goal} />
          ))}
          {completedGoals.length > 0 && (
            <>
              <h2 className="font-data text-[8px] tracking-[0.08em] uppercase text-[rgba(245,245,240,0.25)] pt-3 px-1">
                Completed
              </h2>
              {completedGoals.map((goal: Goal) => (
                <GoalCard key={goal.id} goal={goal} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function GoalCard({ goal }: { goal: Goal }) {
  const target = goal.target_amount ?? 0
  const current = goal.current_amount ?? 0
  const progress = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
  const isCompleted = goal.status === 'completed'

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null
    return new Date(dateStr).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  }

  return (
    <div className="rounded-[10px] border border-[rgba(255,255,255,0.04)] bg-bg-deep p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-text-primary truncate">{goal.name}</h3>
          {goal.description && (
            <p className="text-[11px] text-text-secondary mt-0.5 line-clamp-2">{goal.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {goal.priority && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              goal.priority === 'high' ? 'bg-red-500/10 text-red-400' :
              goal.priority === 'medium' ? 'bg-amber-500/10 text-amber-400' :
              'bg-[rgba(255,255,255,0.04)] text-text-secondary'
            }`}>
              {goal.priority}
            </span>
          )}
          {isCompleted && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-500/10 text-green-400">
              done
            </span>
          )}
        </div>
      </div>

      {target > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="font-data text-text-secondary">
              {current.toLocaleString('en', { minimumFractionDigits: 0 })} / {target.toLocaleString('en', { minimumFractionDigits: 0 })}
            </span>
            <span className="font-data font-semibold text-text-primary">{progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[rgba(255,255,255,0.04)] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${isCompleted ? 'bg-green-500' : 'bg-accent-gold'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 text-[10px] text-text-secondary font-data">
        {goal.target_date && (
          <span>Target: {formatDate(goal.target_date)}</span>
        )}
        {goal.monthly_required_saving != null && goal.monthly_required_saving > 0 && (
          <span>{goal.monthly_required_saving.toLocaleString('en', { minimumFractionDigits: 0 })}/mo needed</span>
        )}
        {goal.on_track != null && !isCompleted && (
          <span className={goal.on_track ? 'text-green-400' : 'text-amber-400'}>
            {goal.on_track ? 'On track' : 'Behind'}
          </span>
        )}
      </div>
    </div>
  )
}
