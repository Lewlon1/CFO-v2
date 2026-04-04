import { createClient } from '@/lib/supabase/server';
import { ProfilePageClient } from '@/components/profile/ProfilePageClient';

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const [profileResult, profilingResult, traitsResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single(),
    supabase
      .from('profiling_queue')
      .select('field, source')
      .eq('user_id', user.id)
      .eq('status', 'answered'),
    supabase
      .from('financial_portrait')
      .select('id, trait_key, trait_value, trait_type, confidence, evidence, source')
      .eq('user_id', user.id)
      .is('dismissed_at', null)
      .order('confidence', { ascending: false }),
  ]);

  const profile = profileResult.data ?? {};
  const profilingEntries = profilingResult.data ?? [];
  const traits = traitsResult.data ?? [];

  return (
    <ProfilePageClient
      profile={profile}
      profilingEntries={profilingEntries}
      traits={traits}
    />
  );
}
