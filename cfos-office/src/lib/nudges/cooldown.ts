import { SupabaseClient } from '@supabase/supabase-js';
import { NUDGE_RULES, NudgeType } from './rules';

export async function canSendNudge(
  supabase: SupabaseClient,
  userId: string,
  nudgeType: NudgeType,
  scopeKey?: string
): Promise<boolean> {
  const rule = NUDGE_RULES[nudgeType];
  if (!rule) return false;

  // Check user preferences
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('nudge_preferences')
    .eq('id', userId)
    .single();

  const prefs = profile?.nudge_preferences as Record<string, { enabled: boolean }> | null;
  const isEnabled = prefs?.[nudgeType]?.enabled ?? rule.enabled_by_default;
  if (!isEnabled) return false;

  const now = new Date();
  const cooldownCutoff = new Date(now.getTime() - rule.cooldown_hours * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Check cooldown — has a nudge of this type been sent recently?
  let cooldownQuery = supabase
    .from('nudges')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('type', nudgeType)
    .gte('created_at', cooldownCutoff.toISOString());

  if (scopeKey) {
    cooldownQuery = cooldownQuery.contains('trigger_rule', { scope_key: scopeKey });
  }

  const { count: recentCount } = await cooldownQuery;
  if ((recentCount ?? 0) > 0) return false;

  // Check monthly cap
  const { count: monthCount } = await supabase
    .from('nudges')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('type', nudgeType)
    .gte('created_at', monthStart.toISOString());

  if ((monthCount ?? 0) >= rule.max_per_month) return false;

  return true;
}
