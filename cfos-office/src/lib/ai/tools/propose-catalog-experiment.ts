// Catalog-driven experiment proposal. Use this when surfacing one of the 10
// pre-built templates from src/lib/experiments/templates.ts. Enforces capacity
// (dynamic active-experiment limit) and the 90-day novelty window server-side.
// Writes a proposed_experiments row with status='proposed' and the catalog
// metadata (template_id, score, scoring_breakdown, success_criterion, etc.).
//
// For ad-hoc proposals with computed impact bands (cut merchant by 50%, cap
// a category at a specific number, etc.) use propose_experiment instead.

import { z } from 'zod';
import type { ToolContext } from './types';
import { findTemplate } from '@/lib/experiments/templates';
import {
  isCapacityAvailable,
  recentlyProposedTemplateIds,
} from '@/lib/experiments/limit';

const inputSchema = z.object({
  template_id: z
    .string()
    .describe('Catalog template id, e.g. subscription_audit, velocity_brake'),
  source_pattern_id: z
    .string()
    .describe('Canonical detector id that motivated the proposal'),
  proposal_score: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('Optional score from the ranking layer; defaults to 0.5'),
  scoring_breakdown: z
    .object({
      goal_alignment: z.number().min(0).max(1),
      measurability: z.number().min(0).max(1),
      effort: z.number().min(0).max(1),
      reach: z.number().min(0).max(1),
    })
    .optional()
    .describe('Optional per-dimension breakdown from the ranking layer'),
  related_goal_id: z
    .string()
    .uuid()
    .optional()
    .describe("Optional id of the user's active goal this experiment supports"),
});

export type ProposeCatalogExperimentInput = z.infer<typeof inputSchema>;

export function createProposeCatalogExperimentTool(ctx: ToolContext) {
  return {
    description:
      'Propose ONE catalog experiment to the user, in plain language, once they have engaged with the problem it addresses. Use the template\'s own hypothesis — do not bolt on a mismatched claim (a no-spend-days trial does not test a single-merchant habit). Capacity and the 90-day novelty window are enforced server-side — if either fails this call returns an error and you must tell the user they\'re at their limit (or that template was already tried) instead of pushing further. Let the user respond naturally; add an [OPTIONS] block only when accepting/declining is a genuine fork worth a tap (it is not required). Use propose_experiment for ad-hoc hypotheses with custom impact computation.',
    inputSchema,
    execute: async (input: ProposeCatalogExperimentInput) => {
      try {
        const template = findTemplate(input.template_id);
        if (!template) {
          return { error: `No catalog template with id "${input.template_id}".` };
        }

        const [capacity, recent] = await Promise.all([
          isCapacityAvailable(ctx.supabase, ctx.userId),
          recentlyProposedTemplateIds(ctx.supabase, ctx.userId),
        ]);

        if (!capacity.allowed) {
          return {
            error: `User is at the active-experiment limit (${capacity.activeCount}/${capacity.limit}). Acknowledge this and ask about the active ones before proposing a new template.`,
          };
        }

        if (recent.has(template.id)) {
          return {
            error: `Template "${template.id}" was proposed in the last 90 days. Pick a different alternative.`,
          };
        }

        const insertPayload = {
          user_id: ctx.userId,
          conversation_id: ctx.conversationId,
          experiment_type: template.experiment_type,
          parameters: {} as Record<string, unknown>,
          rationale: template.hypothesis,
          computed_impact: {} as Record<string, unknown>,
          template_id: template.id,
          source_pattern_id: input.source_pattern_id,
          title: template.title_template,
          hypothesis: template.hypothesis,
          success_criterion: template.success_criterion_template,
          duration_days: template.duration_days,
          target_metric: { ...template.target_metric } as Record<string, unknown>,
          proposal_score: input.proposal_score ?? 0.5,
          scoring_breakdown: input.scoring_breakdown ?? {
            goal_alignment: 0,
            measurability: 0,
            effort: 0,
            reach: 0,
          },
          related_goal_id: input.related_goal_id ?? null,
          status: 'proposed',
        };

        const { data, error } = await ctx.supabase
          .from('proposed_experiments')
          .insert(insertPayload)
          .select(
            'id, template_id, title, success_criterion, duration_days, status, proposed_at',
          )
          .single();

        if (error) {
          console.error('[tool:propose_catalog_experiment] DB error:', error);
          return { error: 'Could not record the experiment proposal. Please try again.' };
        }

        const expiresAt = new Date(
          new Date(data.proposed_at).getTime() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString();

        return {
          success: true,
          experiment_id: data.id,
          template_id: data.template_id,
          title: data.title,
          success_criterion: data.success_criterion,
          duration_days: data.duration_days,
          status: data.status,
          expires_at: expiresAt,
          message: `Proposed "${data.title}" — ${data.success_criterion}. Awaiting user response.`,
        };
      } catch (err) {
        console.error('[tool:propose_catalog_experiment] unexpected error:', err);
        return { error: 'Something went wrong proposing the experiment. Please try again.' };
      }
    },
  };
}
