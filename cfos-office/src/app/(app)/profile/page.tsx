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

  const [profileResult, profilingResult, traitsResult, snapshotsResult, importsResult] = await Promise.all([
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
    supabase
      .from('monthly_snapshots')
      .select('month, transaction_count')
      .eq('user_id', user.id)
      .order('month', { ascending: false }),
    supabase.rpc('get_import_history', { p_user_id: user.id }),
  ]);

  const profile = profileResult.data ?? {};
  const profilingEntries = profilingResult.data ?? [];
  const traits = traitsResult.data ?? [];
  const snapshots = snapshotsResult.data ?? [];
  const imports = (importsResult.data ?? []) as Array<{
    import_batch_id: string;
    source: string;
    transaction_count: number;
    earliest_date: string;
    latest_date: string;
    imported_at: string;
  }>;

  const dataSummary = {
    monthsCovered: snapshots.length,
    latestMonth: snapshots[0]?.month ?? null,
    totalTransactions: snapshots.reduce((sum, s) => sum + (s.transaction_count ?? 0), 0),
    traitCount: traits.length,
  };

  return (
    <ProfilePageClient
      profile={profile}
      profilingEntries={profilingEntries}
      traits={traits}
      dataSummary={dataSummary}
      imports={imports}
    />
  );
}
