import { z } from 'zod';
import type { ToolContext } from './types';
import { computePaceAndOnTrack, targetDateFromDuration } from '@/lib/goals/pace';
import { logContribution } from '@/lib/goals/contributions';

export function createCreateGoalTool(ctx: ToolContext) {
  return {
    description:
      'Create a savings goal for the user. Use when the user wants to set a financial target — e.g. emergency fund, house deposit, big purchase, or any non-event savings goal. When the user states a relative timeframe ("over 5 years", "in 18 months", "by next summer"), pass it via duration_years and/or duration_months — the server will compute the target date deterministically. Do not compute the target date yourself. Only pass target_date when the user names a specific calendar date. Confirm the goal details with the user before calling. For trips, weddings, gifts, or other time-bound events, use plan_event instead.',
    inputSchema: z.object({
      name: z.string().max(200).describe('Goal name, e.g. "Emergency fund" or "House deposit"'),
      description: z.string().max(500).optional().describe('Additional context'),
      target_amount: z.number().positive().describe('Target savings amount'),
      current_amount: z.number().min(0).optional().describe('Amount already saved (default 0)'),
      duration_years: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .describe(
          'Whole years until the goal — use when the user states a relative timeframe like "over 5 years". Combine with duration_months for fractional years (e.g. "2.5 years" → duration_years: 2, duration_months: 6). The server computes target_date from today + duration.',
        ),
      duration_months: z
        .number()
        .int()
        .positive()
        .max(600)
        .optional()
        .describe(
          'Additional months on top of duration_years — use for sub-year timeframes ("in 18 months" → duration_months: 18) or fractional years. The server computes target_date from today + duration.',
        ),
      target_date: z
        .string()
        .optional()
        .refine(
          (val) => {
            if (!val) return true
            const target = new Date(val)
            if (Number.isNaN(target.getTime())) return false
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            return target.getTime() > today.getTime()
          },
          { message: 'target_date must be a valid date in the future (YYYY-MM-DD)' },
        )
        .describe(
          'Exact target date in YYYY-MM-DD format. Only pass this when the user names a specific calendar date. For relative timeframes ("over 5 years"), use duration_years/duration_months instead and leave this unset — the server will compute the date.',
        ),
      priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority level'),
      type: z
        .enum(['debt_clearance', 'savings', 'investment', 'general'])
        .optional()
        .describe(
          'Goal classification: debt_clearance for paying down debt; savings for emergency funds, deposits, trips, big purchases; investment for pension/portfolio/long-term wealth; general otherwise. Pick the closest fit.',
        ),
    }),
    execute: async ({
      name,
      description,
      target_amount,
      current_amount,
      duration_years,
      duration_months,
      target_date,
      priority,
      type,
    }: {
      name: string;
      description?: string;
      target_amount: number;
      current_amount?: number;
      duration_years?: number;
      duration_months?: number;
      target_date?: string;
      priority?: string;
      type?: 'debt_clearance' | 'savings' | 'investment' | 'general';
    }) => {
      try {
        const saved = current_amount ?? 0;

        // Resolve target_date. Duration wins over an LLM-provided target_date:
        // the user-stated duration is the ground truth and the server computes
        // the date deterministically. Stops the LLM hallucinating dates (e.g.
        // "5 years" → 2033 when today is 2026).
        let resolvedTargetDate: string | null = null;
        if (duration_years || duration_months) {
          resolvedTargetDate = targetDateFromDuration({
            durationYears: duration_years ?? 0,
            durationMonths: duration_months ?? 0,
          });
        } else if (target_date) {
          resolvedTargetDate = target_date;
        }

        const pace = await computePaceAndOnTrack(ctx, {
          current_amount: saved,
          target_amount,
          target_date: resolvedTargetDate,
        });

        const { data, error } = await ctx.supabase
          .from('goals')
          .insert({
            user_id: ctx.userId,
            name,
            description: description || null,
            target_amount: Math.round(target_amount),
            current_amount: Math.round(saved),
            target_date: resolvedTargetDate,
            monthly_required_saving: pace.monthly_required_saving,
            on_track: pace.on_track,
            priority: priority || 'medium',
            type: type || 'general',
            status: 'active',
            currency: ctx.currency,
          })
          .select('id, name, target_amount, current_amount, target_date, monthly_required_saving, on_track, currency')
          .single();

        if (error) {
          console.error('[tool:create_goal] DB error:', error);
          return { error: 'Could not create the goal. Please try again.' };
        }

        // Seed contribution row — the immutable starting point. Keeps the
        // invariant current_amount = SUM(contributions) post-recompute.
        // Failure here is logged but not fatal: the goal row already has a
        // correct current_amount, and the defensive guard in the recompute
        // SQL function protects it from being zeroed on the next pass.
        if (saved > 0) {
          try {
            await logContribution(ctx.supabase, ctx.userId, {
              goalId: data.id,
              amount: Math.round(saved),
              kind: 'seed',
              note: 'Starting amount when goal was created',
            });
          } catch (seedErr) {
            console.error('[tool:create_goal] seed contribution failed:', seedErr);
          }
        }

        return {
          success: true,
          goal: data,
          message: `Goal "${name}" created — target ${ctx.currency} ${Math.round(target_amount).toLocaleString()}.`,
        };
      } catch (err) {
        console.error('[tool:create_goal] unexpected error:', err);
        return { error: 'Something went wrong creating the goal. Please try again.' };
      }
    },
  };
}
