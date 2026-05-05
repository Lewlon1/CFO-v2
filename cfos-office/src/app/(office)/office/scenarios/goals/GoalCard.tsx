'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import type { Database } from '@/lib/supabase/types'

type Goal = Database['public']['Tables']['goals']['Row']

function formatDate(dateStr: string | null) {
  if (!dateStr) return null
  return new Date(dateStr).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

export function GoalCard({ goal }: { goal: Goal }) {
  const router = useRouter()
  const [deleteState, setDeleteState] = useState<'idle' | 'confirming' | 'deleting' | 'error'>('idle')

  const target = goal.target_amount ?? 0
  const current = goal.current_amount ?? 0
  const progress = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
  const isCompleted = goal.status === 'completed'

  const handleDelete = async () => {
    setDeleteState('deleting')
    try {
      const res = await fetch('/api/goals/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_id: goal.id }),
      })
      if (!res.ok) {
        setDeleteState('error')
        setTimeout(() => setDeleteState('idle'), 2000)
        return
      }
      router.refresh()
    } catch {
      setDeleteState('error')
      setTimeout(() => setDeleteState('idle'), 2000)
    }
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
          {!isCompleted && deleteState === 'idle' && (
            <button
              type="button"
              aria-label="Delete goal"
              onClick={() => setDeleteState('confirming')}
              className="flex items-center justify-center min-h-[44px] min-w-[44px] -m-3 text-text-tertiary hover:text-red-400 transition-colors"
            >
              <Trash2 size={14} strokeWidth={1.8} />
            </button>
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

      {(deleteState === 'confirming' || deleteState === 'deleting' || deleteState === 'error') && (
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-[rgba(255,255,255,0.04)]">
          <span className="text-[11px] text-text-secondary">
            {deleteState === 'error' ? "Couldn't delete — try again" : 'Delete this goal?'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={deleteState === 'deleting'}
              onClick={() => setDeleteState('idle')}
              className="min-h-[36px] px-3 text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleteState === 'deleting'}
              onClick={handleDelete}
              className="min-h-[36px] px-3 rounded text-[11px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
            >
              {deleteState === 'deleting' ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
