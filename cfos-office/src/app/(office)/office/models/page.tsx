import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ModelsListClient } from './ModelsListClient'

export default async function ModelsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: runs } = await supabase
    .from('model_runs')
    .select('id, decision_type, status, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  return <ModelsListClient runs={runs ?? []} />
}
