import { z } from 'zod';
import type { ToolContext } from './types';
import { updateAssetPortrait } from '@/lib/balance-sheet/portrait';
import { refreshCurrentNetWorthSnapshot } from '@/lib/analytics/net-worth-snapshot';

const LIABILITY_TYPES = [
  'mortgage',
  'student_loan',
  'credit_card',
  'personal_loan',
  'car_finance',
  'bnpl',
  'overdraft',
  'other',
] as const;
type LiabilityType = (typeof LIABILITY_TYPES)[number];

const RATE_TYPES = ['fixed', 'variable', 'tracker'] as const;
const PAYMENT_FREQUENCIES = [
  'monthly',
  'weekly',
  'fortnightly',
  'quarterly',
  'annually',
  'salary_deducted',
] as const;

export function createUpsertLiabilityTool(ctx: ToolContext) {
  return {
    description: `Create or update a liability (something the user owes) when they share information about mortgages, student loans, credit card debt, personal loans, or other debts during conversation.

WHEN TO CALL: When the user mentions a debt balance, loan, mortgage, credit card balance, or any amount they owe — either in response to a direct question or volunteered naturally.

VALID FIELDS:
- liability_id: string (UUID) — optional. Omit for new. Include to update existing.
- liability_type: string — REQUIRED for new liabilities. One of: 'mortgage', 'student_loan', 'credit_card', 'personal_loan', 'car_finance', 'bnpl', 'overdraft', 'other'
- name: string — REQUIRED for new liabilities. Human-readable label. Examples: "Barclays Mortgage", "Plan 2 Student Loan", "Amex Gold", "Klarna"
- provider: string — optional. Lender or card issuer.
- currency: string — optional. ISO 4217 code. Defaults to user's primary_currency.
- outstanding_balance: number — REQUIRED for new. Current amount owed. Must be > 0.
- original_amount: number — optional. What they originally borrowed.
- interest_rate: number — optional. APR as percentage (e.g., 4.5 means 4.5%).
- rate_type: string — optional. One of: 'fixed', 'variable', 'tracker'
- minimum_payment: number — optional. Required monthly minimum.
- actual_payment: number — optional. What they actually pay per period.
- payment_frequency: string — optional. One of: 'monthly', 'weekly', 'fortnightly', 'quarterly', 'annually', 'salary_deducted'. Default 'monthly'.
- start_date: string — optional. ISO date format (YYYY-MM-DD).
- end_date: string — optional. Expected payoff date.
- remaining_term_months: number — optional.
- is_priority: boolean — optional. User wants to pay this off aggressively.
- details: object — optional. Type-specific metadata:
  mortgage:     { property_value: number, ltv_pct: number, is_repayment: boolean, fixed_until: string }
  student_loan: { plan_type: string, threshold: number, repayment_pct: number, is_salary_deducted: boolean, country: string }
  credit_card:  { credit_limit: number, is_zero_pct_period: boolean, zero_pct_ends: string }

AFTER CALLING: Always confirm what you've recorded in natural language. Example: "Got it — £24,000 student loan on Plan 2, deducted from salary. Does that sound right?"`,
    inputSchema: z.object({
      liability_id: z.string().uuid().optional(),
      liability_type: z.enum(LIABILITY_TYPES).optional(),
      name: z.string().min(1).optional(),
      provider: z.string().optional(),
      currency: z.string().length(3).optional(),
      outstanding_balance: z.number().min(0).optional(),
      original_amount: z.number().min(0).optional(),
      interest_rate: z.number().min(0).optional(),
      rate_type: z.enum(RATE_TYPES).optional(),
      minimum_payment: z.number().min(0).optional(),
      actual_payment: z.number().min(0).optional(),
      payment_frequency: z.enum(PAYMENT_FREQUENCIES).optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      remaining_term_months: z.number().int().min(0).optional(),
      is_priority: z.boolean().optional(),
      details: z.record(z.string(), z.any()).optional(),
    }),
    execute: async (params: {
      liability_id?: string;
      liability_type?: LiabilityType;
      name?: string;
      provider?: string;
      currency?: string;
      outstanding_balance?: number;
      original_amount?: number;
      interest_rate?: number;
      rate_type?: (typeof RATE_TYPES)[number];
      minimum_payment?: number;
      actual_payment?: number;
      payment_frequency?: (typeof PAYMENT_FREQUENCIES)[number];
      start_date?: string;
      end_date?: string;
      remaining_term_months?: number;
      is_priority?: boolean;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      details?: Record<string, any>;
    }) => {
      // TODO(session-14): log to user_events
      try {
        const nowIso = new Date().toISOString();

        // UPDATE path
        if (params.liability_id) {
          const { data: existing, error: fetchErr } = await ctx.supabase
            .from('liabilities')
            .select('id')
            .eq('id', params.liability_id)
            .eq('user_id', ctx.userId)
            .maybeSingle();

          if (fetchErr) {
            console.error('[tool:upsert_liability] fetch error:', fetchErr);
            return { error: 'Could not look up that liability. Please try again.' };
          }
          if (!existing) {
            return {
              error: 'Liability not found. It may have been deleted or belong to another user.',
            };
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const updateData: Record<string, any> = { last_updated: nowIso };
          if (params.liability_type !== undefined) updateData.liability_type = params.liability_type;
          if (params.name !== undefined) updateData.name = params.name;
          if (params.provider !== undefined) updateData.provider = params.provider;
          if (params.currency !== undefined) updateData.currency = params.currency.toUpperCase();
          if (params.outstanding_balance !== undefined)
            updateData.outstanding_balance = params.outstanding_balance;
          if (params.original_amount !== undefined) updateData.original_amount = params.original_amount;
          if (params.interest_rate !== undefined) updateData.interest_rate = params.interest_rate;
          if (params.rate_type !== undefined) updateData.rate_type = params.rate_type;
          if (params.minimum_payment !== undefined) updateData.minimum_payment = params.minimum_payment;
          if (params.actual_payment !== undefined) updateData.actual_payment = params.actual_payment;
          if (params.payment_frequency !== undefined)
            updateData.payment_frequency = params.payment_frequency;
          if (params.start_date !== undefined) updateData.start_date = params.start_date;
          if (params.end_date !== undefined) updateData.end_date = params.end_date;
          if (params.remaining_term_months !== undefined)
            updateData.remaining_term_months = params.remaining_term_months;
          if (params.is_priority !== undefined) updateData.is_priority = params.is_priority;
          if (params.details !== undefined) updateData.details = params.details;

          const { data: updated, error: updateErr } = await ctx.supabase
            .from('liabilities')
            .update(updateData)
            .eq('id', params.liability_id)
            .eq('user_id', ctx.userId)
            .select()
            .single();

          if (updateErr) {
            console.error('[tool:upsert_liability] update error:', updateErr);
            return { error: 'Could not update the liability. Please try again.' };
          }

          await updateAssetPortrait(ctx);
          await refreshCurrentNetWorthSnapshot(ctx.supabase, ctx.userId);
          return { action: 'updated', saved: updated };
        }

        // INSERT path
        if (!params.liability_type || !params.name) {
          return { error: 'liability_type and name are required for new liabilities.' };
        }
        if (params.outstanding_balance === undefined || params.outstanding_balance <= 0) {
          return {
            error: 'outstanding_balance is required and must be greater than 0 for new liabilities.',
          };
        }

        // Dedupe: if a liability already exists for this user with the same
        // (liability_type, name) — case-insensitive — treat this call as an
        // update on that row instead of inserting a duplicate.
        const { data: dupe } = await ctx.supabase
          .from('liabilities')
          .select('id')
          .eq('user_id', ctx.userId)
          .eq('liability_type', params.liability_type)
          .ilike('name', params.name)
          .maybeSingle();

        if (dupe?.id) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const updateData: Record<string, any> = { last_updated: nowIso };
          if (params.name !== undefined) updateData.name = params.name;
          if (params.provider !== undefined) updateData.provider = params.provider;
          if (params.currency !== undefined) updateData.currency = params.currency.toUpperCase();
          if (params.outstanding_balance !== undefined)
            updateData.outstanding_balance = params.outstanding_balance;
          if (params.original_amount !== undefined) updateData.original_amount = params.original_amount;
          if (params.interest_rate !== undefined) updateData.interest_rate = params.interest_rate;
          if (params.rate_type !== undefined) updateData.rate_type = params.rate_type;
          if (params.minimum_payment !== undefined) updateData.minimum_payment = params.minimum_payment;
          if (params.actual_payment !== undefined) updateData.actual_payment = params.actual_payment;
          if (params.payment_frequency !== undefined)
            updateData.payment_frequency = params.payment_frequency;
          if (params.start_date !== undefined) updateData.start_date = params.start_date;
          if (params.end_date !== undefined) updateData.end_date = params.end_date;
          if (params.remaining_term_months !== undefined)
            updateData.remaining_term_months = params.remaining_term_months;
          if (params.is_priority !== undefined) updateData.is_priority = params.is_priority;
          if (params.details !== undefined) updateData.details = params.details;

          const { data: merged, error: mergeErr } = await ctx.supabase
            .from('liabilities')
            .update(updateData)
            .eq('id', dupe.id)
            .eq('user_id', ctx.userId)
            .select()
            .single();

          if (mergeErr) {
            console.error('[tool:upsert_liability] dedupe-merge error:', mergeErr);
            return { error: 'Could not update the existing liability. Please try again.' };
          }

          await updateAssetPortrait(ctx);
          await refreshCurrentNetWorthSnapshot(ctx.supabase, ctx.userId);
          return { action: 'updated', saved: merged, deduped: true };
        }

        let currency = params.currency?.toUpperCase() || ctx.currency;
        if (!currency) {
          const { data: profile } = await ctx.supabase
            .from('user_profiles')
            .select('primary_currency')
            .eq('id', ctx.userId)
            .maybeSingle();
          currency = profile?.primary_currency || 'EUR';
        }

        const insertData = {
          user_id: ctx.userId,
          liability_type: params.liability_type,
          name: params.name,
          provider: params.provider ?? null,
          currency,
          outstanding_balance: params.outstanding_balance,
          original_amount: params.original_amount ?? null,
          interest_rate: params.interest_rate ?? null,
          rate_type: params.rate_type ?? null,
          minimum_payment: params.minimum_payment ?? null,
          actual_payment: params.actual_payment ?? null,
          payment_frequency: params.payment_frequency ?? 'monthly',
          start_date: params.start_date ?? null,
          end_date: params.end_date ?? null,
          remaining_term_months: params.remaining_term_months ?? null,
          details: params.details ?? {},
          is_priority: params.is_priority ?? false,
          source: 'chat',
          last_updated: nowIso,
        };

        const { data: inserted, error: insertErr } = await ctx.supabase
          .from('liabilities')
          .insert(insertData)
          .select()
          .single();

        if (insertErr) {
          console.error('[tool:upsert_liability] insert error:', insertErr);
          return { error: 'Could not save the liability. Please try again.' };
        }

        await updateAssetPortrait(ctx);
        await refreshCurrentNetWorthSnapshot(ctx.supabase, ctx.userId);
        return { action: 'created', saved: inserted };
      } catch (err) {
        console.error('[tool:upsert_liability] unexpected error:', err);
        return { error: 'Something went wrong saving the liability. Please try again.' };
      }
    },
  };
}
