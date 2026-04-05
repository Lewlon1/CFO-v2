import { SupabaseClient } from '@supabase/supabase-js';
import { NudgeType, NUDGE_RULES } from './rules';
import { interpolateTemplate } from './template';
import { canSendNudge } from './cooldown';

interface CreateNudgeParams {
  userId: string;
  type: NudgeType;
  variables: Record<string, string | number>;
  scopeKey?: string;
  scheduledFor?: Date;
}

export async function createNudge(
  supabase: SupabaseClient,
  params: CreateNudgeParams
): Promise<{ created: boolean; nudgeId?: string; reason?: string }> {
  const rule = NUDGE_RULES[params.type];
  if (!rule) return { created: false, reason: 'unknown_nudge_type' };

  const allowed = await canSendNudge(supabase, params.userId, params.type, params.scopeKey);
  if (!allowed) return { created: false, reason: 'cooldown_or_rate_limit' };

  const title = interpolateTemplate(rule.title_template, params.variables);
  const body = interpolateTemplate(rule.body_template, params.variables);
  const actionUrl = interpolateTemplate(rule.action_url, params.variables);

  const { data, error } = await supabase
    .from('nudges')
    .insert({
      user_id: params.userId,
      type: params.type,
      title,
      body,
      action_url: actionUrl,
      trigger_rule: {
        variables: params.variables,
        scope_key: params.scopeKey ?? null,
      },
      status: 'pending',
      scheduled_for: params.scheduledFor?.toISOString() ?? new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.error(`[nudge] Failed to create ${params.type} for ${params.userId}:`, error);
    return { created: false, reason: 'db_error' };
  }

  return { created: true, nudgeId: data.id };
}
