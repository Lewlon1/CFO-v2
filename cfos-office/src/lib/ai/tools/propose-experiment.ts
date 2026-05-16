// cfos-office/src/lib/ai/tools/propose-experiment.ts
//
// Action tool: the LLM proposes a hypothesis (cut merchant, pause recurring,
// cap a category, etc.) and this tool computes the impact from the user's
// actual 90-day baseline. The LLM never invents projection numbers — they
// come from here.
//
// Every call writes a row to public.proposed_experiments regardless of whether
// the user accepts. The accept-flow UI does not exist yet — this is telemetry
// + grounded numbers the LLM can quote in its closing experiment line.

import { z } from 'zod';
import type { ToolContext } from './types';
import {
  EXCLUDED_FROM_PL_PG_LIST,
  affectsSpendingBreakdown,
} from '@/lib/analytics/categories';
import { normaliseMerchant, absExpense } from '@/lib/analytics/pattern-detectors';

// 90-day baseline window. Anchored on today so the LLM doesn't need to pass dates.
const BASELINE_DAYS = 90;
// Heuristic discount applied to category baseline when consolidating to fewer
// merchants. Deliberately conservative — fragmentation premium estimates are
// in the £1–£2 per under-£5-trip range; 15% off a category total tends to
// match those once the trips are concentrated.
const CONSOLIDATE_REDUCTION_FACTOR = 0.15;
// CV bound below which pause_recurring is willing to call a pattern "recurring".
const RECURRING_MAX_CV = 0.3;
// Minimum occurrences for the pause_recurring decision to be honest about it.
const RECURRING_MIN_COUNT = 3;
// Stable cap_category confidence boundary (CV across 30-day buckets).
const CAP_STABLE_CV = 0.4;
const SAMPLE_AFFECTED_LIMIT = 5;

const experimentTypeEnum = z.enum([
  'reduce_merchant',
  'pause_recurring',
  'consolidate_category',
  'cap_category',
  'redirect_to_goal',
]);

const inputSchema = z.object({
  type: experimentTypeEnum,
  parameters: z.object({
    merchant: z
      .string()
      .optional()
      .describe(
        'For reduce_merchant / pause_recurring: normalised merchant name',
      ),
    reduction_pct: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe(
        'For reduce_merchant: e.g. 100 = cut entirely, 50 = cut by half',
      ),
    category: z
      .string()
      .optional()
      .describe(
        'For consolidate_category / cap_category: category slug',
      ),
    monthly_cap: z
      .number()
      .optional()
      .describe('For cap_category: monthly currency cap'),
    target_trips_per_week: z
      .number()
      .optional()
      .describe(
        'For consolidate_category: e.g. 1 trip/week instead of 4',
      ),
    goal_id: z
      .string()
      .optional()
      .describe('For redirect_to_goal: target goal UUID'),
  }),
  rationale: z
    .string()
    .describe(
      'One-sentence reason the LLM thinks this experiment makes sense for THIS user',
    ),
});

export type ProposeExperimentInput = z.infer<typeof inputSchema>;
export type ExperimentType = z.infer<typeof experimentTypeEnum>;
export type ImpactConfidence = 'high' | 'med' | 'low';

interface DbRow {
  id: string;
  date: string;
  description: string | null;
  amount: number | string;
  category_id: string | null;
}

interface NormalisedRow {
  id: string;
  date: string;
  description: string;
  merchantKey: string;
  amount: number;
  absAmount: number;
  category_id: string;
}

interface ImpactBlock {
  monthly_impact: { amount: number; currency: string; confidence: ImpactConfidence };
  annualised_impact: { amount: number; currency: string };
  description: string;
  affected: NormalisedRow[];
  baselinePattern: { count_per_month: number; avg_amount: number; consistency_score: number };
  feasibilityNote: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// Coefficient of variation: stdDev / mean. Returns 0 if mean is 0 or input is too small.
function coefficientOfVariation(amounts: number[]): number {
  if (amounts.length === 0) return 0;
  const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
  if (mean === 0) return 0;
  const variance =
    amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
  const stdDev = Math.sqrt(variance);
  return stdDev / mean;
}

function baselinePatternFor(rows: NormalisedRow[], nDays: number) {
  const amounts = rows.map((r) => r.absAmount);
  const totalCount = amounts.length;
  const mean = totalCount > 0 ? amounts.reduce((s, a) => s + a, 0) / totalCount : 0;
  const cv = totalCount > 0 ? coefficientOfVariation(amounts) : 0;
  const consistency = mean > 0 ? clamp01(1 - cv) : 0;
  const countPerMonth = nDays > 0 ? totalCount / (nDays / 30) : 0;
  return {
    count_per_month: round2(countPerMonth),
    avg_amount: round2(mean),
    consistency_score: round2(consistency),
  };
}

function sampleAffected(rows: NormalisedRow[], limit: number): NormalisedRow[] {
  // Bias toward recent + representative: sort by date desc, take first `limit`.
  return rows
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, limit);
}

// Confidence rule for reduce_merchant (per task spec):
//   high if ≥10 occurrences AND CV<0.3; med if 4–9; low if <4.
function reduceMerchantConfidence(count: number, cv: number): ImpactConfidence {
  if (count >= 10 && cv < 0.3) return 'high';
  if (count >= 4) return 'med';
  return 'low';
}

interface ValidationOk {
  ok: true;
}
interface ValidationErr {
  ok: false;
  error: string;
}

function validate(input: ProposeExperimentInput): ValidationOk | ValidationErr {
  const { type, parameters } = input;
  switch (type) {
    case 'reduce_merchant': {
      if (!parameters.merchant || parameters.reduction_pct === undefined) {
        return {
          ok: false,
          error:
            'reduce_merchant requires both merchant and reduction_pct in parameters',
        };
      }
      return { ok: true };
    }
    case 'pause_recurring': {
      if (!parameters.merchant) {
        return {
          ok: false,
          error: 'pause_recurring requires merchant in parameters',
        };
      }
      return { ok: true };
    }
    case 'consolidate_category': {
      if (!parameters.category) {
        return {
          ok: false,
          error: 'consolidate_category requires category in parameters',
        };
      }
      return { ok: true };
    }
    case 'cap_category': {
      if (!parameters.category || parameters.monthly_cap === undefined) {
        return {
          ok: false,
          error:
            'cap_category requires both category and monthly_cap in parameters',
        };
      }
      return { ok: true };
    }
    case 'redirect_to_goal': {
      if (!parameters.goal_id) {
        return {
          ok: false,
          error: 'redirect_to_goal requires goal_id in parameters',
        };
      }
      return { ok: true };
    }
  }
}

// --- Per-type compute ---

function computeReduceMerchant(
  rows: NormalisedRow[],
  merchant: string,
  reductionPct: number,
  currency: string,
  nDays: number,
): ImpactBlock {
  const targetKey = normaliseMerchant(merchant);
  const matched = rows.filter((r) => r.merchantKey === targetKey);
  const baselineTotal = matched.reduce((sum, r) => sum + r.absAmount, 0);
  const monthlyImpact = (baselineTotal / nDays) * 30 * (reductionPct / 100);
  const amounts = matched.map((r) => r.absAmount);
  const cv = coefficientOfVariation(amounts);
  const confidence = reduceMerchantConfidence(matched.length, cv);

  const description =
    reductionPct >= 100
      ? `Cut ${merchant} entirely for 30 days`
      : `Cut spend at ${merchant} by ${Math.round(reductionPct)}% for 30 days`;

  return {
    monthly_impact: {
      amount: round2(monthlyImpact),
      currency,
      confidence,
    },
    annualised_impact: {
      amount: round2(monthlyImpact * 12),
      currency,
    },
    description,
    affected: sampleAffected(matched, SAMPLE_AFFECTED_LIMIT),
    baselinePattern: baselinePatternFor(matched, nDays),
    feasibilityNote:
      matched.length === 0
        ? `No transactions matched "${merchant}" in the last ${nDays} days — impact estimate is 0.`
        : confidence === 'low'
          ? `Only ${matched.length} occurrence${matched.length === 1 ? '' : 's'} in the baseline — the impact figure is directional, not reliable.`
          : `Based on ${matched.length} transactions over ${nDays} days at ${merchant}.`,
  };
}

function computePauseRecurring(
  rows: NormalisedRow[],
  merchant: string,
  currency: string,
  nDays: number,
): ImpactBlock {
  const targetKey = normaliseMerchant(merchant);
  const matched = rows.filter((r) => r.merchantKey === targetKey);
  const baselineTotal = matched.reduce((sum, r) => sum + r.absAmount, 0);
  // Pausing recurring = 100% reduction at the merchant.
  const monthlyImpact = (baselineTotal / nDays) * 30;
  const amounts = matched.map((r) => r.absAmount);
  const cv = coefficientOfVariation(amounts);
  const pattern = baselinePatternFor(matched, nDays);

  const looksRecurring = cv <= RECURRING_MAX_CV && matched.length >= RECURRING_MIN_COUNT;
  const confidence: ImpactConfidence = looksRecurring
    ? matched.length >= 6
      ? 'high'
      : 'med'
    : 'low';

  const feasibilityNote = !looksRecurring
    ? "This doesn't look recurring enough to pause confidently — looks like ad-hoc spending."
    : `Pattern is consistent (${matched.length} hits, consistency ${pattern.consistency_score}). Pausing should recover the full monthly run-rate.`;

  return {
    monthly_impact: {
      amount: round2(monthlyImpact),
      currency,
      confidence,
    },
    annualised_impact: {
      amount: round2(monthlyImpact * 12),
      currency,
    },
    description: `Pause recurring charge at ${merchant}`,
    affected: sampleAffected(matched, SAMPLE_AFFECTED_LIMIT),
    baselinePattern: pattern,
    feasibilityNote,
  };
}

function computeConsolidateCategory(
  rows: NormalisedRow[],
  category: string,
  currency: string,
  nDays: number,
): ImpactBlock {
  const matched = rows.filter((r) => r.category_id === category);
  const baselineTotal = matched.reduce((sum, r) => sum + r.absAmount, 0);

  // Distinct merchants in this category.
  const merchantKeys = new Set<string>();
  for (const r of matched) merchantKeys.add(r.merchantKey);

  if (merchantKeys.size < 5) {
    // Threshold not met: don't promise consolidation savings. Return 0 impact
    // and a clear note so the LLM doesn't quote a saving. We still write the
    // row so the proposal is logged (telemetry-first design).
    return {
      monthly_impact: { amount: 0, currency, confidence: 'low' },
      annualised_impact: { amount: 0, currency },
      description: `Consolidate ${category} spending to fewer merchants`,
      affected: sampleAffected(matched, SAMPLE_AFFECTED_LIMIT),
      baselinePattern: baselinePatternFor(matched, nDays),
      feasibilityNote: `Only ${merchantKeys.size} distinct merchant${merchantKeys.size === 1 ? '' : 's'} in ${category} over the last ${nDays} days — not fragmented enough for consolidation to save much. Threshold is 5+ merchants.`,
    };
  }

  const monthlyImpact =
    (baselineTotal / nDays) * 30 * CONSOLIDATE_REDUCTION_FACTOR;

  return {
    monthly_impact: {
      amount: round2(monthlyImpact),
      currency,
      confidence: 'med',
    },
    annualised_impact: {
      amount: round2(monthlyImpact * 12),
      currency,
    },
    description: `Consolidate ${category} to fewer merchants (${merchantKeys.size} → fewer trips)`,
    affected: sampleAffected(matched, SAMPLE_AFFECTED_LIMIT),
    baselinePattern: baselinePatternFor(matched, nDays),
    feasibilityNote: `Estimate assumes consolidating to fewer trips lops ~${Math.round(CONSOLIDATE_REDUCTION_FACTOR * 100)}% off through bulk + decision discipline. Conservative.`,
  };
}

function computeCapCategory(
  rows: NormalisedRow[],
  category: string,
  monthlyCap: number,
  currency: string,
  nDays: number,
): ImpactBlock {
  const matched = rows.filter((r) => r.category_id === category);
  const baselineTotal = matched.reduce((sum, r) => sum + r.absAmount, 0);
  const currentMonthlyRate = nDays > 0 ? (baselineTotal / nDays) * 30 : 0;
  const monthlyImpact = Math.max(0, currentMonthlyRate - monthlyCap);

  // Per-window CV for confidence: bucket the baseline into ~30-day windows.
  // Anchor windowing on today so the bucket boundaries match the user's
  // current pay-cycle position rather than the earliest matched row.
  const buckets = Math.max(1, Math.floor(nDays / 30));
  const bucketTotals: number[] = new Array(buckets).fill(0);
  if (nDays > 0 && matched.length > 0) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const baselineStart = today.getTime() - nDays * 24 * 60 * 60 * 1000;
    const windowMs = 30 * 24 * 60 * 60 * 1000;
    for (const r of matched) {
      const t = new Date(`${r.date}T00:00:00Z`).getTime();
      if (!Number.isFinite(t)) continue;
      let idx = Math.floor((t - baselineStart) / windowMs);
      if (idx < 0) idx = 0;
      if (idx >= buckets) idx = buckets - 1;
      bucketTotals[idx] += r.absAmount;
    }
  }
  const monthlyCv = coefficientOfVariation(bucketTotals);
  const confidence: ImpactConfidence =
    buckets >= 2 && monthlyCv < CAP_STABLE_CV && monthlyImpact > 0
      ? 'high'
      : 'med';

  return {
    monthly_impact: {
      amount: round2(monthlyImpact),
      currency,
      confidence,
    },
    annualised_impact: {
      amount: round2(monthlyImpact * 12),
      currency,
    },
    description: `Cap monthly ${category} at ${monthlyCap}`,
    affected: sampleAffected(matched, SAMPLE_AFFECTED_LIMIT),
    baselinePattern: baselinePatternFor(matched, nDays),
    feasibilityNote: 'Cap saves money only if current spend reliably exceeds it.',
  };
}

function computeRedirectToGoal(currency: string): ImpactBlock {
  return {
    monthly_impact: { amount: 0, currency, confidence: 'low' },
    annualised_impact: { amount: 0, currency },
    description: 'Redirect savings to goal',
    affected: [],
    baselinePattern: { count_per_month: 0, avg_amount: 0, consistency_score: 0 },
    feasibilityNote:
      'Pair this with a savings-source experiment — the redirect amount comes from there.',
  };
}

export function createProposeExperimentTool(ctx: ToolContext) {
  return {
    description:
      'Propose a concrete experiment (cut merchant, pause recurring, cap category, etc.) and get back system-computed impact based on the user\'s actual baseline. Use ONLY when you want to surface a specific actionable next step in your response — the user-facing prose should say what THIS tool returned, never an invented projection. Every call writes a telemetry row regardless of whether the user accepts.',
    inputSchema,
    execute: async (input: ProposeExperimentInput) => {
      try {
        const validation = validate(input);
        if (!validation.ok) {
          return { error: validation.error };
        }

        // 90-day baseline window. Anchor on UTC midnight today so the window
        // is stable for the duration of the call.
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const dateTo = today.toISOString().slice(0, 10);
        const dateFrom = new Date(
          today.getTime() - BASELINE_DAYS * 24 * 60 * 60 * 1000,
        )
          .toISOString()
          .slice(0, 10);

        // PostgREST builder chain — same `any` convention as sibling tools.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query: any = ctx.supabase
          .from('transactions')
          .select('id, date, description, amount, category_id')
          .eq('user_id', ctx.userId)
          .gte('date', dateFrom)
          .lte('date', dateTo)
          .is('deleted_at', null)
          .not('category_id', 'in', EXCLUDED_FROM_PL_PG_LIST);

        const { data: rawRows, error: txnError } = (await query) as {
          data: DbRow[] | null;
          error: { message: string } | null;
        };

        if (txnError) {
          console.error('[tool:propose_experiment] transactions DB error:', txnError);
          return {
            error: 'Could not fetch transactions for impact calculation. Please try again.',
          };
        }

        // Belt-and-braces: drop NULL category_id rows the server filter missed.
        const filtered = (rawRows ?? []).filter((r) =>
          affectsSpendingBreakdown(r.category_id),
        );

        const rows: NormalisedRow[] = filtered.map((r) => {
          const signed = Number(r.amount);
          const desc = r.description ?? '';
          const normalised = normaliseMerchant(desc);
          return {
            id: r.id,
            date: r.date,
            description: desc || 'Unknown',
            merchantKey: normalised || 'unknown',
            amount: signed,
            absAmount: absExpense(signed),
            category_id: r.category_id as string,
          };
        });

        // Dispatch per type.
        let impact: ImpactBlock;
        switch (input.type) {
          case 'reduce_merchant':
            impact = computeReduceMerchant(
              rows,
              input.parameters.merchant as string,
              input.parameters.reduction_pct as number,
              ctx.currency,
              BASELINE_DAYS,
            );
            break;
          case 'pause_recurring':
            impact = computePauseRecurring(
              rows,
              input.parameters.merchant as string,
              ctx.currency,
              BASELINE_DAYS,
            );
            break;
          case 'consolidate_category':
            impact = computeConsolidateCategory(
              rows,
              input.parameters.category as string,
              ctx.currency,
              BASELINE_DAYS,
            );
            break;
          case 'cap_category':
            impact = computeCapCategory(
              rows,
              input.parameters.category as string,
              input.parameters.monthly_cap as number,
              ctx.currency,
              BASELINE_DAYS,
            );
            break;
          case 'redirect_to_goal':
            impact = computeRedirectToGoal(ctx.currency);
            break;
        }

        // ISO date 30 days from now — suggested re-evaluation moment.
        const nextCheckIn = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString();

        // Write the telemetry row before returning. We still return the
        // computed impact even if the insert fails — but log it loudly so
        // monitoring picks it up.
        const insertPayload = {
          user_id: ctx.userId,
          conversation_id: ctx.conversationId,
          experiment_type: input.type,
          parameters: input.parameters,
          rationale: input.rationale,
          computed_impact: {
            monthly_impact: impact.monthly_impact,
            annualised_impact: impact.annualised_impact,
          },
          affected_transaction_ids: impact.affected.map((t) => t.id),
          feasibility_note: impact.feasibilityNote,
          status: 'proposed',
        };

        const { data: inserted, error: insertError } = await ctx.supabase
          .from('proposed_experiments')
          .insert(insertPayload)
          .select('id')
          .single();

        if (insertError) {
          console.error(
            '[tool:propose_experiment] proposed_experiments insert error:',
            insertError,
          );
          return {
            error:
              'Could not record the experiment. Please try again in a moment.',
          };
        }

        return {
          experiment_id: inserted.id,
          description: impact.description,
          monthly_impact: impact.monthly_impact,
          annualised_impact: impact.annualised_impact,
          affected_transactions: impact.affected.map((t) => ({
            id: t.id,
            date: t.date,
            merchant: t.description,
            amount: round2(t.amount),
          })),
          baseline_pattern: impact.baselinePattern,
          feasibility_note: impact.feasibilityNote,
          next_check_in: nextCheckIn,
        };
      } catch (err) {
        console.error('[tool:propose_experiment] unexpected error:', err);
        return {
          error:
            'Something went wrong proposing the experiment. Please try again.',
        };
      }
    },
  };
}
