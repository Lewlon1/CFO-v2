import { describe, expect, it, vi } from 'vitest'
import { getPrimaryGoal } from './primary-goal'
import type { SupabaseClient } from '@supabase/supabase-js'

function makeSupabaseStub(
  rows: Array<Record<string, unknown>> | null,
  error: { message: string } | null = null,
) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn(),
  }
  // The query awaits the final .is('deleted_at', null) call.
  builder.is = vi.fn().mockReturnValue(Promise.resolve({ data: rows, error }))
  return {
    from: vi.fn().mockReturnValue(builder),
  } as unknown as SupabaseClient
}

describe('getPrimaryGoal', () => {
  it('returns null when no active goals exist', async () => {
    const supabase = makeSupabaseStub([])
    const result = await getPrimaryGoal(supabase, 'user-1')
    expect(result).toBeNull()
  })

  it('returns null when the query returns null data', async () => {
    const supabase = makeSupabaseStub(null)
    const result = await getPrimaryGoal(supabase, 'user-1')
    expect(result).toBeNull()
  })

  it('returns the single goal when only one exists', async () => {
    const goal = {
      id: 'g1',
      name: 'Emergency fund',
      target_amount: 5000,
      current_amount: 1200,
      target_date: '2026-12-01',
      monthly_required_saving: 600,
      on_track: true,
      priority: 'medium',
      created_at: '2026-05-01T10:00:00Z',
    }
    const supabase = makeSupabaseStub([goal])
    const result = await getPrimaryGoal(supabase, 'user-1')
    expect(result?.id).toBe('g1')
  })

  it('prefers high priority over medium and low', async () => {
    const rows = [
      {
        id: 'low',
        priority: 'low',
        name: 'L',
        target_amount: 1,
        current_amount: 0,
        target_date: null,
        monthly_required_saving: null,
        on_track: null,
        created_at: '2026-05-10T00:00:00Z',
      },
      {
        id: 'med',
        priority: 'medium',
        name: 'M',
        target_amount: 1,
        current_amount: 0,
        target_date: null,
        monthly_required_saving: null,
        on_track: null,
        created_at: '2026-05-11T00:00:00Z',
      },
      {
        id: 'hi',
        priority: 'high',
        name: 'H',
        target_amount: 1,
        current_amount: 0,
        target_date: null,
        monthly_required_saving: null,
        on_track: null,
        created_at: '2026-05-09T00:00:00Z',
      },
    ]
    const supabase = makeSupabaseStub(rows)
    const result = await getPrimaryGoal(supabase, 'user-1')
    expect(result?.id).toBe('hi')
  })

  it('tiebreaks equal priority by newer created_at', async () => {
    const rows = [
      {
        id: 'older',
        priority: 'medium',
        name: 'O',
        target_amount: 1,
        current_amount: 0,
        target_date: null,
        monthly_required_saving: null,
        on_track: null,
        created_at: '2026-05-01T00:00:00Z',
      },
      {
        id: 'newer',
        priority: 'medium',
        name: 'N',
        target_amount: 1,
        current_amount: 0,
        target_date: null,
        monthly_required_saving: null,
        on_track: null,
        created_at: '2026-05-12T00:00:00Z',
      },
    ]
    const supabase = makeSupabaseStub(rows)
    const result = await getPrimaryGoal(supabase, 'user-1')
    expect(result?.id).toBe('newer')
  })

  it('treats null priority as lower than low', async () => {
    const rows = [
      {
        id: 'nullprio',
        priority: null,
        name: 'X',
        target_amount: 1,
        current_amount: 0,
        target_date: null,
        monthly_required_saving: null,
        on_track: null,
        created_at: '2026-05-20T00:00:00Z',
      },
      {
        id: 'low',
        priority: 'low',
        name: 'L',
        target_amount: 1,
        current_amount: 0,
        target_date: null,
        monthly_required_saving: null,
        on_track: null,
        created_at: '2026-05-01T00:00:00Z',
      },
    ]
    const supabase = makeSupabaseStub(rows)
    const result = await getPrimaryGoal(supabase, 'user-1')
    expect(result?.id).toBe('low')
  })

  it('throws on supabase error', async () => {
    const supabase = makeSupabaseStub(null, { message: 'boom' })
    await expect(getPrimaryGoal(supabase, 'user-1')).rejects.toThrow(/boom/)
  })
})
