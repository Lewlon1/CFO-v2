import { createClient } from '@/lib/supabase/server';
import { ScenariosClient } from '@/components/scenarios/ScenariosClient';

export default async function ScenariosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: recentScenarios } = await supabase
    .from('conversations')
    .select('id, title, updated_at, metadata')
    .eq('user_id', user!.id)
    .eq('type', 'scenario')
    .order('updated_at', { ascending: false })
    .limit(5);

  return <ScenariosClient recentScenarios={recentScenarios ?? []} />;
}
