// User accepts an experiment proposal. Transitions status proposed → active,
// stamps accepted_at, starts_at, and ends_at = starts_at + duration_days.
// Capacity is re-checked here in case the user accepted multiple proposals
// concurrently from different conversations.

import { z } from 'zod';
import type { ToolContext } from './types';
import { isCapacityAvailable } from '@/lib/experiments/limit';

const inputSchema = z.object({
  experiment_id: z.string().uuid().describe('Id of the proposed experiment row'),
});

export type AcceptExperimentInput = z.infer<typeof inputSchema>;

export function createAcceptExperimentTool(ctx: ToolContext) {
  return {
    description:
      'Mark a proposed experiment as accepted. Call when the user picks "Yes, let\'s try it" (or types acceptance). Sets the experiment to status=active and the clock running. If the user has already hit their active-experiment limit since the proposal was created, this returns an error.',
    inputSchema,
    execute: async ({ experiment_id }: AcceptExperimentInput) => {
      try {
        const { data: row, error: fetchError } = await ctx.supabase
          .from('proposed_experiments')
          .select('id, user_id, status, duration_days, title')
          .eq('id', experiment_id)
          .is('deleted_at', null)
          .maybeSingle();

        if (fetchError) {
          console.error('[tool:accept_experiment] fetch error:', fetchError);
          return { error: 'Could not load the experiment proposal. Please try again.' };
        }

        if (!row) {
          return { error: 'No such experiment proposal — it may have been removed.' };
        }
        if (row.user_id !== ctx.userId) {
          return { error: 'This experiment does not belong to the current user.' };
        }
        if (row.status !== 'proposed') {
          return {
            error: `Experiment is already in status "${row.status}" — cannot accept.`,
          };
        }

        const capacity = await isCapacityAvailable(ctx.supabase, ctx.userId);
        if (!capacity.allowed) {
          return {
            error: `Already at active-experiment limit (${capacity.activeCount}/${capacity.limit}). Finish or abandon an active one first.`,
          };
        }

        const now = new Date();
        const durationDays = row.duration_days ?? 7;
        const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

        const { data: updated, error: updateError } = await ctx.supabase
          .from('proposed_experiments')
          .update({
            status: 'active',
            accepted_at: now.toISOString(),
            starts_at: now.toISOString(),
            ends_at: endsAt.toISOString(),
            responded_at: now.toISOString(),
          })
          .eq('id', experiment_id)
          .eq('user_id', ctx.userId)
          .eq('status', 'proposed')
          .select('id, title, success_criterion, duration_days, starts_at, ends_at, status')
          .single();

        if (updateError || !updated) {
          console.error('[tool:accept_experiment] update error:', updateError);
          return { error: 'Could not accept the experiment. Please try again.' };
        }

        return {
          success: true,
          experiment_id: updated.id,
          title: updated.title,
          status: updated.status,
          starts_at: updated.starts_at,
          ends_at: updated.ends_at,
          duration_days: updated.duration_days,
          message: `Experiment "${updated.title}" is now active until ${updated.ends_at?.slice(0, 10) ?? 'TBD'}.`,
        };
      } catch (err) {
        console.error('[tool:accept_experiment] unexpected error:', err);
        return { error: 'Something went wrong accepting the experiment. Please try again.' };
      }
    },
  };
}
