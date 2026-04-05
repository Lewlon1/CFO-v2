import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { NudgePreferences } from '@/components/settings/NudgePreferences';

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('nudge_preferences')
    .eq('id', user.id)
    .single();

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-xl font-semibold text-foreground mb-6">Settings</h1>

      <section>
        <h2 className="text-sm font-medium text-foreground mb-4">Notifications</h2>
        <NudgePreferences
          initialPreferences={
            (profile?.nudge_preferences as Record<string, { enabled: boolean }>) ?? {}
          }
        />
      </section>
    </div>
  );
}
