import { z } from 'zod';
import type { ToolContext } from './types';

// Iteratively amortise a debt month-by-month and capture a schedule.
function amortise(opts: {
  startingBalance: number;
  monthlyRate: number;
  payment: number;
}) {
  const { startingBalance, monthlyRate, payment } = opts;
  const schedule: Array<{
    month: number;
    payment: number;
    interest_portion: number;
    principal_portion: number;
    remaining_balance: number;
  }> = [];

  let balance = startingBalance;
  let totalInterest = 0;
  let month = 0;
  const MAX_MONTHS = 600;

  // Sanity: if payment doesn't cover interest, debt grows forever.
  const firstInterest = balance * monthlyRate;
  if (payment <= firstInterest) {
    return {
      months_to_payoff: null as number | null,
      total_interest_paid: null as number | null,
      total_amount_paid: null as number | null,
      monthly_schedule: [],
      never_paid_off: true,
      first_month_interest: Math.round(firstInterest * 100) / 100,
    };
  }

  while (balance > 0 && month < MAX_MONTHS) {
    month += 1;
    const interest = balance * monthlyRate;
    let principal = payment - interest;
    let actualPayment = payment;

    // Final month — only pay what's left
    if (principal >= balance) {
      principal = balance;
      actualPayment = balance + interest;
    }

    balance = balance - principal;
    totalInterest += interest;

    schedule.push({
      month,
      payment: Math.round(actualPayment * 100) / 100,
      interest_portion: Math.round(interest * 100) / 100,
      principal_portion: Math.round(principal * 100) / 100,
      remaining_balance: Math.round(Math.max(balance, 0) * 100) / 100,
    });

    if (balance <= 0.005) {
      balance = 0;
      break;
    }
  }

  // Trim schedule: first 12 + last 3 months only
  let trimmed = schedule;
  if (schedule.length > 15) {
    trimmed = [...schedule.slice(0, 12), ...schedule.slice(-3)];
  }

  return {
    months_to_payoff: month,
    total_interest_paid: Math.round(totalInterest * 100) / 100,
    total_amount_paid: Math.round((startingBalance + totalInterest) * 100) / 100,
    monthly_schedule: trimmed,
    never_paid_off: false,
  };
}

export function createCalculateDebtPayoffTool(ctx: ToolContext) {
  return {
    description: `Calculate how long it will take to pay off a debt and how much interest it will cost, under different payment scenarios.

WHEN TO CALL: When the user asks about paying off a debt, how long a loan will take, how much interest they're paying, or whether they should accelerate repayment.

REQUIRED: liability_id — the specific debt to calculate for. Use get_balance_sheet first if you don't already know the liability_id.

VALID FIELDS:
- liability_id: string (UUID) — the debt to calculate for
- monthly_payment_override: number — optional. Model a different payment amount than the actual payment.
- extra_monthly: number — optional. Additional monthly amount on top of current payment.

RETURNS: Three scenarios (current / accelerated / minimum-only) with payoff timeline, total interest paid, monthly schedule (first 12 + last 3 months), and savings comparison.

If the debt has no interest_rate stored, this tool returns a missing-field error — ask the user for the APR and call upsert_liability before retrying.`,
    inputSchema: z.object({
      liability_id: z.string().uuid().describe('UUID of the liability to calculate for.'),
      monthly_payment_override: z.number().min(0).optional(),
      extra_monthly: z.number().min(0).optional(),
    }),
    execute: async (params: {
      liability_id: string;
      monthly_payment_override?: number;
      extra_monthly?: number;
    }) => {
      try {
        const { data: liability, error } = await ctx.supabase
          .from('liabilities')
          .select('*')
          .eq('id', params.liability_id)
          .eq('user_id', ctx.userId)
          .maybeSingle();

        if (error) {
          console.error('[tool:calculate_debt_payoff] fetch error:', error);
          return { error: 'Could not look up that liability. Please try again.' };
        }
        if (!liability) {
          return { error: 'Liability not found. It may have been deleted.' };
        }

        const balance = Number(liability.outstanding_balance);
        if (!balance || balance <= 0) {
          return {
            error: 'missing_field',
            field: 'outstanding_balance',
            message: `I don't have a current balance for ${liability.name}. What's the outstanding balance?`,
          };
        }

        if (liability.interest_rate == null) {
          return {
            error: 'missing_field',
            field: 'interest_rate',
            message: `I need the APR for your ${liability.name} to calculate this. Do you know the interest rate?`,
          };
        }

        const annualRate = Number(liability.interest_rate);
        const monthlyRate = annualRate / 100 / 12;

        const actualPayment = liability.actual_payment != null ? Number(liability.actual_payment) : null;
        const minimumPayment = liability.minimum_payment != null ? Number(liability.minimum_payment) : null;

        // Determine the "current" payment to use
        const currentPayment = actualPayment ?? minimumPayment;
        if (!currentPayment || currentPayment <= 0) {
          return {
            error: 'missing_field',
            field: 'actual_payment',
            message: `I need to know what you currently pay each month on your ${liability.name}. What's your monthly payment?`,
          };
        }

        // Accelerated payment
        const acceleratedPayment =
          params.monthly_payment_override ??
          (params.extra_monthly != null ? currentPayment + params.extra_monthly : currentPayment);

        const currentResult = amortise({
          startingBalance: balance,
          monthlyRate,
          payment: currentPayment,
        });

        const acceleratedResult =
          acceleratedPayment !== currentPayment
            ? amortise({ startingBalance: balance, monthlyRate, payment: acceleratedPayment })
            : null;

        const minimumResult =
          minimumPayment != null && minimumPayment !== currentPayment
            ? amortise({ startingBalance: balance, monthlyRate, payment: minimumPayment })
            : null;

        // Savings comparisons
        let interestSavedVsCurrent: number | null = null;
        let monthsSavedVsCurrent: number | null = null;
        if (
          acceleratedResult &&
          !acceleratedResult.never_paid_off &&
          !currentResult.never_paid_off &&
          currentResult.total_interest_paid != null &&
          acceleratedResult.total_interest_paid != null &&
          currentResult.months_to_payoff != null &&
          acceleratedResult.months_to_payoff != null
        ) {
          interestSavedVsCurrent =
            Math.round((currentResult.total_interest_paid - acceleratedResult.total_interest_paid) * 100) / 100;
          monthsSavedVsCurrent = currentResult.months_to_payoff - acceleratedResult.months_to_payoff;
        }

        let interestSavedVsMinimum: number | null = null;
        let monthsSavedVsMinimum: number | null = null;
        if (
          minimumResult &&
          !minimumResult.never_paid_off &&
          !currentResult.never_paid_off &&
          minimumResult.total_interest_paid != null &&
          currentResult.total_interest_paid != null &&
          minimumResult.months_to_payoff != null &&
          currentResult.months_to_payoff != null
        ) {
          interestSavedVsMinimum =
            Math.round((minimumResult.total_interest_paid - currentResult.total_interest_paid) * 100) / 100;
          monthsSavedVsMinimum = minimumResult.months_to_payoff - currentResult.months_to_payoff;
        }

        return {
          liability: {
            id: liability.id,
            name: liability.name,
            type: liability.liability_type,
            outstanding_balance: balance,
            interest_rate_pct: annualRate,
            currency: liability.currency || ctx.currency,
          },
          scenarios: {
            current: {
              monthly_payment: currentPayment,
              ...currentResult,
            },
            accelerated: acceleratedResult
              ? {
                  monthly_payment: acceleratedPayment,
                  ...acceleratedResult,
                }
              : null,
            minimum: minimumResult
              ? {
                  monthly_payment: minimumPayment,
                  ...minimumResult,
                }
              : null,
          },
          savings: {
            interest_saved_vs_current: interestSavedVsCurrent,
            months_saved_vs_current: monthsSavedVsCurrent,
            interest_saved_vs_minimum: interestSavedVsMinimum,
            months_saved_vs_minimum: monthsSavedVsMinimum,
          },
          currency: liability.currency || ctx.currency,
        };
      } catch (err) {
        console.error('[tool:calculate_debt_payoff] unexpected error:', err);
        return { error: 'Something went wrong calculating that payoff. Please try again.' };
      }
    },
  };
}
