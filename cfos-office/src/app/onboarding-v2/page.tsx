import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { StruggleQuestion } from '@/components/onboarding-v2/struggle-question'

export const dynamic = 'force-dynamic'

export default async function OnboardingV2Page() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('entry_struggle, display_name')
    .eq('id', user.id)
    .single()

  if (profile?.entry_struggle) {
    redirect('/office')
  }

  return (
    <StruggleQuestion
      userId={user.id}
      firstName={profile?.display_name ?? null}
    />
  )
}
