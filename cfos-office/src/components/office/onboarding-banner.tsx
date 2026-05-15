import { createClient } from '@/lib/supabase/server'
import { OnboardingBannerCard } from './onboarding-banner-card'

/**
 * Server-fetched banner that pulls onboarding-v2 users back into the next
 * unfinished step. Renders nothing for users who have completed both the
 * Value Map and uploaded transactions, or who haven't entered the v2 flow.
 */
export async function OnboardingBanner() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('entry_struggle, onboarding_step, onboarding_completed_at')
    .eq('id', user.id)
    .single()
  if (!profile?.entry_struggle) return null
  if (profile.onboarding_completed_at) return null

  const [{ count: vmCount }, { count: txCount }] = await Promise.all([
    supabase
      .from('value_map_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', user.id)
      .is('deleted_at', null),
    supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('deleted_at', null),
  ])

  const hasValueMap = (vmCount ?? 0) > 0
  const hasTransactions = (txCount ?? 0) > 0
  if (hasValueMap && hasTransactions) return null

  const variant: 'value_map' | 'upload' = hasValueMap ? 'upload' : 'value_map'
  return <OnboardingBannerCard variant={variant} />
}
