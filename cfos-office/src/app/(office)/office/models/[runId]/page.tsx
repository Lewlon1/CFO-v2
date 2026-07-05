import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RunClient } from './RunClient'

export default async function ModelRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: run } = await supabase
    .from('model_runs')
    .select('id, decision_type, status, assumptions, messages, caveats')
    .eq('id', runId)
    .eq('user_id', user.id)
    .single()

  if (!run) notFound()

  const { data: profile } = await supabase
    .from('user_financial_profile')
    .select('default_horizon_years')
    .eq('user_id', user.id)
    .maybeSingle()

  return <RunClient run={run} profile={profile} />
}
