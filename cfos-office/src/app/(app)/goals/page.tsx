import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

type Goal = {
  id: string
  name: string
  description: string | null
  target_amount: number | null
  current_amount: number | null
  target_date: string | null
  priority: string | null
  status: string | null
  monthly_required_saving: number | null
  on_track: boolean | null
  created_at: string
}

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
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Goals</h1>
      </div>

      {activeGoals.length === 0 && completedGoals.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center space-y-4">
          <div className="text-4xl">🎯</div>
          <h2 className="text-lg font-medium text-foreground">No goals yet</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Tell your CFO about a financial goal and it will track your progress here.
          </p>
          <Link
            href="/chat"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Chat with your CFO
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {activeGoals.map((goal: Goal) => (
            <GoalCard key={goal.id} goal={goal} />
          ))}
          {completedGoals.length > 0 && (
            <>
              <h2 className="text-sm font-medium text-muted-foreground pt-2">Completed</h2>
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
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-foreground truncate">{goal.name}</h3>
          {goal.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{goal.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {goal.priority && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              goal.priority === 'high' ? 'bg-red-500/10 text-red-500' :
              goal.priority === 'medium' ? 'bg-amber-500/10 text-amber-500' :
              'bg-muted text-muted-foreground'
            }`}>
              {goal.priority}
            </span>
          )}
          {isCompleted && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-500/10 text-green-500">
              done
            </span>
          )}
        </div>
      </div>

      {target > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">
              {current.toLocaleString('en', { minimumFractionDigits: 0 })} / {target.toLocaleString('en', { minimumFractionDigits: 0 })}
            </span>
            <span className="font-medium text-foreground">{progress}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${isCompleted ? 'bg-green-500' : 'bg-primary'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        {goal.target_date && (
          <span>Target: {formatDate(goal.target_date)}</span>
        )}
        {goal.monthly_required_saving != null && goal.monthly_required_saving > 0 && (
          <span>{goal.monthly_required_saving.toLocaleString('en', { minimumFractionDigits: 0 })}/mo needed</span>
        )}
        {goal.on_track != null && !isCompleted && (
          <span className={goal.on_track ? 'text-green-500' : 'text-amber-500'}>
            {goal.on_track ? 'On track' : 'Behind'}
          </span>
        )}
      </div>
    </div>
  )
}
