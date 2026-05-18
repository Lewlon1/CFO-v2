// Read-only fetch of the user's open experiments: currently-active ones plus
// any that have ended and are awaiting an outcome report. Used by the LLM at
// the start of a conversation to know what to follow up on.

import { z } from 'zod';
import type { ToolContext } from './types';

const inputSchema = z.object({}).describe('No parameters');

interface ExperimentRow {
  id: string;
  template_id: string | null;
  title: string | null;
  success_criterion: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  outcome_reported_at: string | null;
  proposed_at: string;
}

export function createListActiveExperimentsTool(ctx: ToolContext) {
  return {
    description:
      'List the user\'s open experiments — both currently-active ones and ones whose end-date has passed without an outcome. Use early in a conversation to know what to ask about before opening new threads.',
    inputSchema,
    execute: async (_input: Record<string, never> = {} as Record<string, never>) => {
      try {
        const { data, error } = await ctx.supabase
          .from('proposed_experiments')
          .select(
            'id, template_id, title, success_criterion, status, starts_at, ends_at, outcome_reported_at, proposed_at',
          )
          .eq('user_id', ctx.userId)
          .is('deleted_at', null)
          .in('status', ['accepted', 'active', 'proposed'])
          .order('starts_at', { ascending: false, nullsFirst: false });

        if (error) {
          console.error('[tool:list_active_experiments] DB error:', error);
          return { error: 'Could not load active experiments. Please try again.' };
        }

        const rows = (data ?? []) as ExperimentRow[];
        const nowMs = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;

        const active = rows
          .filter((r) => (r.status === 'active' || r.status === 'accepted') && r.ends_at && new Date(r.ends_at).getTime() > nowMs - ONE_DAY)
          .map((r) => ({
            experiment_id: r.id,
            template_id: r.template_id,
            title: r.title,
            success_criterion: r.success_criterion,
            starts_at: r.starts_at,
            ends_at: r.ends_at,
          }));

        const awaitingOutcome = rows
          .filter(
            (r) =>
              (r.status === 'active' || r.status === 'accepted') &&
              r.outcome_reported_at === null &&
              r.ends_at !== null &&
              new Date(r.ends_at).getTime() < nowMs - ONE_DAY,
          )
          .map((r) => ({
            experiment_id: r.id,
            template_id: r.template_id,
            title: r.title,
            success_criterion: r.success_criterion,
            ended_at: r.ends_at,
          }));

        const openProposals = rows
          .filter((r) => r.status === 'proposed')
          .map((r) => ({
            experiment_id: r.id,
            template_id: r.template_id,
            title: r.title,
            proposed_at: r.proposed_at,
          }));

        return {
          success: true,
          active,
          awaiting_outcome: awaitingOutcome,
          open_proposals: openProposals,
          counts: {
            active: active.length,
            awaiting_outcome: awaitingOutcome.length,
            open_proposals: openProposals.length,
          },
        };
      } catch (err) {
        console.error('[tool:list_active_experiments] unexpected error:', err);
        return { error: 'Something went wrong loading active experiments.' };
      }
    },
  };
}
