import { SupabaseClient } from '@supabase/supabase-js';
import {
  PROFILE_QUESTIONS,
  ProfileQuestion,
  ProfileQuestionCondition,
} from './question-registry';

// ── Profile completeness (weighted) ───────────────────────────────────────────

export function calculateProfileCompleteness(
  profile: Record<string, unknown>
): number {
  let filledWeight = 0;
  let totalWeight = 0;

  for (const q of PROFILE_QUESTIONS) {
    totalWeight += q.weight;
    const val = profile[q.field];
    if (val !== null && val !== undefined && val !== '') {
      filledWeight += q.weight;
    }
  }

  if (totalWeight === 0) return 0;
  return Math.round((filledWeight / totalWeight) * 100);
}

// ── Condition evaluator ───────────────────────────────────────────────────────

function evaluateCondition(
  condition: ProfileQuestionCondition,
  profile: Record<string, unknown>
): boolean {
  const val = profile[condition.field];

  switch (condition.operator) {
    case 'exists':
      return val !== null && val !== undefined && val !== '';

    case 'equals':
      return String(val) === String(condition.value);

    case 'not_equals':
      return String(val) !== String(condition.value);

    case 'in':
      if (!Array.isArray(condition.value)) return false;
      return condition.value.includes(String(val));

    default:
      return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getConversationCount(
  userId: string,
  supabase: SupabaseClient
): Promise<number> {
  const { count } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  return count ?? 0;
}

async function getRecentlyAskedFields(
  userId: string,
  supabase: SupabaseClient
): Promise<Set<string>> {
  // Get the last 3 conversation IDs for this user
  const { data: recentConvs } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(3);

  if (!recentConvs || recentConvs.length === 0) return new Set();

  const recentIds = recentConvs.map((c) => c.id);

  // Find fields asked in those conversations that weren't answered
  const { data: asked } = await supabase
    .from('profiling_queue')
    .select('field')
    .eq('user_id', userId)
    .eq('status', 'asked')
    .in('conversation_id', recentIds);

  return new Set((asked ?? []).map((a) => a.field));
}

// ── Core engine ───────────────────────────────────────────────────────────────

export async function getNextQuestions(
  userId: string,
  supabase: SupabaseClient
): Promise<ProfileQuestion[]> {
  // Load profile
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (!profile) return [];

  // Count conversations for phase eligibility
  const conversationCount = await getConversationCount(userId, supabase);

  // Get recently asked (to suppress)
  const recentlyAsked = await getRecentlyAskedFields(userId, supabase);

  // Load Value Map for priority boosting
  const { data: valueMap } = await supabase
    .from('value_map_results')
    .select('conflict_areas')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const conflictAreas: string[] = valueMap?.conflict_areas ?? [];

  // Phase thresholds
  const phaseThresholds: Record<number, number> = {
    1: 0,
    2: 1,
    3: 2,
    4: 4,
  };

  // Filter eligible questions
  const eligible: Array<{ question: ProfileQuestion; score: number }> = [];

  for (const q of PROFILE_QUESTIONS) {
    // Skip if field is already filled
    const val = profile[q.field];
    if (val !== null && val !== undefined && val !== '') continue;

    // Skip if phase not reached
    const threshold = phaseThresholds[q.phase] ?? 0;
    if (conversationCount < threshold) continue;

    // Skip if min_conversations not met
    if (q.min_conversations && conversationCount < q.min_conversations) continue;

    // Skip if dependencies not met
    if (q.dependencies) {
      const depsMet = q.dependencies.every((dep) => {
        const depVal = profile[dep];
        return depVal !== null && depVal !== undefined && depVal !== '';
      });
      if (!depsMet) continue;
    }

    // Skip if condition not met
    if (q.condition && !evaluateCondition(q.condition, profile)) continue;

    // Skip if recently asked and not answered
    if (recentlyAsked.has(q.field)) continue;

    // Calculate score (lower phase = higher priority, then higher weight)
    let score = (5 - q.phase) * 10 + q.weight * 3;

    // Boost if Value Map conflicts relate to this question's keywords
    if (conflictAreas.length > 0 && q.context_keywords) {
      const conflictText = conflictAreas.join(' ').toLowerCase();
      const hasOverlap = q.context_keywords.some((kw) =>
        conflictText.includes(kw.toLowerCase())
      );
      if (hasOverlap) score += 5;
    }

    eligible.push({ question: q, score });
  }

  // Sort by score descending, return top 2
  eligible.sort((a, b) => b.score - a.score);
  return eligible.slice(0, 2).map((e) => e.question);
}
