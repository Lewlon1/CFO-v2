import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [snapshotsResult, traitCountResult] = await Promise.all([
    supabase
      .from('monthly_snapshots')
      .select('month, transaction_count')
      .eq('user_id', user.id)
      .order('month', { ascending: false }),
    supabase
      .from('financial_portrait')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('dismissed_at', null),
  ])

  const snapshots = snapshotsResult.data ?? []
  const monthsCovered = snapshots.length
  const latestMonth = snapshots[0]?.month ?? null
  const totalTransactions = snapshots.reduce((sum, s) => sum + (s.transaction_count ?? 0), 0)

  return NextResponse.json({
    monthsCovered,
    latestMonth,
    totalTransactions,
    traitCount: traitCountResult.count ?? 0,
  })
}
