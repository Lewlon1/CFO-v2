import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const batchId = searchParams.get('batch_id')

  if (!batchId) {
    return NextResponse.json({ error: 'batch_id required' }, { status: 400 })
  }

  const { count, error } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('import_batch_id', batchId)

  if (error) {
    console.error('[onboarding] csv status check failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    status: (count ?? 0) > 0 ? 'completed' : 'processing',
    transaction_count: count ?? 0,
  })
}
