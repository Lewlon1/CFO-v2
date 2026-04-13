import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPredictionMetrics } from '@/lib/prediction/metrics'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const metrics = await getPredictionMetrics(supabase, user.id)
  return NextResponse.json(metrics)
}
