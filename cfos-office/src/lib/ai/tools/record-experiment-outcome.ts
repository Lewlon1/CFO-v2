// User self-reports the outcome of an active experiment. Maps yes/partial/no
// onto status succeeded/partial/failed. Verification is self-report only by
// design — no transaction-based auto-checking this session.

import { z } from 'zod';
import type { ToolContext } from './types';

const inputSchema = z.object({
  experiment_id: z.string().uuid().describe('Id of the active experiment row'),
  outcome: z
    .enum(['yes', 'partial', 'no'])
    .describe('User self-report: yes / partial / no'),
  note: z
    .string()
    .max(1000)
    .optional()
    .describe('Optional free-text reason the user gave'),
});

export type RecordExperimentOutcomeInput = z.infer<typeof inputSchema>;

const OUTCOME_TO_STATUS = {
  yes: 'succeeded',
  partial: 'partial',
  no: 'failed',
} as const;

export function createRecordExperimentOutcomeTool(ctx: ToolContext) {
  return {
    description:
      "Record the user's self-reported outcome for an active experiment. Outcomes are yes / partial / no — capture the user's note in `note` if they gave one. Do NOT moralise about partial or no outcomes; just acknowledge and log.",
    inputSchema,
    execute: async ({ experiment_id, outcome, note }: RecordExperimentOutcomeInput) => {
      try {
        const { data: row, error: fetchError } = await ctx.supabase
          .from('proposed_experiments')
          .select('id, user_id, status, title')
          .eq('id', experiment_id)
          .is('deleted_at', null)
          .maybeSingle();

        if (fetchError) {
          console.error('[tool:record_experiment_outcome] fetch error:', fetchError);
          return { error: 'Could not load the experiment. Please try again.' };
        }

        if (!row) {
          return { error: 'No such experiment — it may have been removed.' };
        }
        if (row.user_id !== ctx.userId) {
          return { error: 'This experiment does not belong to the current user.' };
        }
        if (row.status !== 'active' && row.status !== 'accepted') {
          return {
            error: `Experiment is in status "${row.status}" — only active experiments can have an outcome recorded.`,
          };
        }

        const newStatus = OUTCOME_TO_STATUS[outcome];
        const now = new Date().toISOString();

        const { data: updated, error: updateError } = await ctx.supabase
          .from('proposed_experiments')
          .update({
            status: newStatus,
            outcome_self_report: outcome,
            outcome_reported_at: now,
            user_note: note ?? null,
          })
          .eq('id', experiment_id)
          .eq('user_id', ctx.userId)
          .in('status', ['active', 'accepted'])
          .select('id, title, status, outcome_self_report, outcome_reported_at')
          .single();

        if (updateError || !updated) {
          console.error('[tool:record_experiment_outcome] update error:', updateError);
          return { error: 'Could not record the outcome. Please try again.' };
        }

        return {
          success: true,
          experiment_id: updated.id,
          status: updated.status,
          outcome: updated.outcome_self_report,
          message: `Outcome recorded for "${updated.title}": ${updated.outcome_self_report}.`,
        };
      } catch (err) {
        console.error('[tool:record_experiment_outcome] unexpected error:', err);
        return { error: 'Something went wrong recording the outcome. Please try again.' };
      }
    },
  };
}
