// User declines an experiment proposal. Sets status='declined', responded_at,
// and stashes any reason in user_note. The novelty filter (90 days) will keep
// this template out of the next round of proposals automatically.

import { z } from 'zod';
import type { ToolContext } from './types';

const inputSchema = z.object({
  experiment_id: z.string().uuid().describe('Id of the proposed experiment row'),
  reason: z
    .string()
    .max(500)
    .optional()
    .describe('Optional short reason — e.g. "too soon", "wrong category"'),
});

export type DeclineExperimentInput = z.infer<typeof inputSchema>;

export function createDeclineExperimentTool(ctx: ToolContext) {
  return {
    description:
      'Mark a proposed experiment as declined. Call when the user picks "Not right now" or "Pick a different one". For "Pick a different one", also call propose_catalog_experiment with the next alternative immediately after.',
    inputSchema,
    execute: async ({ experiment_id, reason }: DeclineExperimentInput) => {
      try {
        const { data: row, error: fetchError } = await ctx.supabase
          .from('proposed_experiments')
          .select('id, user_id, status, title')
          .eq('id', experiment_id)
          .is('deleted_at', null)
          .maybeSingle();

        if (fetchError) {
          console.error('[tool:decline_experiment] fetch error:', fetchError);
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
            error: `Experiment is already in status "${row.status}" — cannot decline.`,
          };
        }

        const { data: updated, error: updateError } = await ctx.supabase
          .from('proposed_experiments')
          .update({
            status: 'declined',
            responded_at: new Date().toISOString(),
            user_note: reason ?? null,
          })
          .eq('id', experiment_id)
          .eq('user_id', ctx.userId)
          .eq('status', 'proposed')
          .select('id, title, status')
          .single();

        if (updateError || !updated) {
          console.error('[tool:decline_experiment] update error:', updateError);
          return { error: 'Could not decline the experiment. Please try again.' };
        }

        return {
          success: true,
          experiment_id: updated.id,
          status: updated.status,
          message: `Declined "${updated.title}".`,
        };
      } catch (err) {
        console.error('[tool:decline_experiment] unexpected error:', err);
        return { error: 'Something went wrong declining the experiment. Please try again.' };
      }
    },
  };
}
