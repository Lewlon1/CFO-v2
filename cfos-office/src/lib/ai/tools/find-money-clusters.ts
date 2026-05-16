// cfos-office/src/lib/ai/tools/find-money-clusters.ts
//
// Detective tool: find where money piles up. Returns story-shaped candidate
// observations across three dimensions:
//   A. Merchant concentration within a category (single merchant ≥40%)
//   B. Category concentration overall (single category ≥ min_share_pct)
//   C. Recurring same-amount-same-merchant (≥3 occurrences, std dev <10% of mean)
//
// The tool surfaces stories; it does NOT pick a verdict. The LLM chooses
// which (if any) of these to talk through based on the user's brief.

import { z } from 'zod';
import type { ToolContext } from './types';
import {
  EXCLUDED_FROM_PL_PG_LIST,
  affectsSpendingBreakdown,
} from '@/lib/analytics/categories';
import {
  normaliseMerchant,
  formatCurrency,
  absExpense,
} from '@/lib/analytics/pattern-detectors';
import { groupByMerchant } from './helpers/group-by-merchant';
import {
  assessDataConfidence,
  type DataConfidence,
} from './helpers/data-confidence';

// Detector thresholds. Kept here as named constants so future tuning is one
// place rather than a hunt through the body.
const MERCHANT_IN_CATEGORY_MIN_SHARE = 0.40;   // single merchant ≥40% of category
const RECURRING_MIN_OCCURRENCES = 3;
const RECURRING_MAX_CV = 0.10;                  // std dev / mean threshold
const SAMPLE_TRANSACTIONS_LIMIT = 3;
const MERCHANT_LIST_LIMIT = 3;

const inputSchema = z.object({
  date_from: z.string().describe('Start date in YYYY-MM-DD format'),
  date_to: z.string().describe('End date in YYYY-MM-DD format'),
  min_share_pct: z
    .number()
    .min(0)
    .max(100)
    .default(25)
    .describe('Minimum cluster share to surface as a story (default 25%)'),
});

export type FindMoneyClustersInput = z.infer<typeof inputSchema>;

export type ClusterStoryType =
  | 'merchant_in_category'
  | 'dominant_category'
  | 'recurring_merchant';

export interface ClusterStory {
  type: ClusterStoryType;
  headline: string;
  magnitude: {
    amount: number;
    currency: string;
    share_pct: number;
  };
  merchants: string[];
  comparison: string;
  sample_transactions: Array<{
    id: string;
    date: string;
    merchant: string;
    amount: number;
  }>;
  narrative_hint: string;
  data_confidence: DataConfidence | null;
}

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
  rawDescription: string | null;
  merchantKey: string;
  amount: number;          // signed
  absAmount: number;       // absolute spend (refunds → 0 via absExpense)
  category_id: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysBetween(date_from: string, date_to: string): number {
  const from = new Date(date_from);
  const to = new Date(date_to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return 0;
  }
  const DAY_MS = 24 * 60 * 60 * 1000;
  // Inclusive day count: from 2026-04-01 to 2026-04-30 = 30 days.
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1);
}

// Pick up to `limit` representative rows: largest absolute spend first.
function pickSampleTransactions(rows: NormalisedRow[], limit: number) {
  return rows
    .slice()
    .sort((a, b) => b.absAmount - a.absAmount)
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      date: r.date,
      merchant: r.description,
      amount: round2(r.amount),
    }));
}

// Pick top-N merchant names by spend share inside a row set.
function pickTopMerchantNames(rows: NormalisedRow[], limit: number): string[] {
  const groups = groupByMerchant(
    rows.map((r) => ({
      amount: r.amount,
      description: r.rawDescription,
      date: r.date,
      category_id: r.category_id,
    })),
  );
  return groups.slice(0, limit).map((g) => g.merchant);
}

// --- A. Merchant concentration within a category ---
function detectMerchantInCategory(
  rows: NormalisedRow[],
  currency: string,
  overallConfidence: DataConfidence,
): ClusterStory[] {
  const stories: ClusterStory[] = [];

  // Bucket rows by category.
  const byCategory = new Map<string, NormalisedRow[]>();
  for (const r of rows) {
    const existing = byCategory.get(r.category_id);
    if (existing) existing.push(r);
    else byCategory.set(r.category_id, [r]);
  }

  for (const [category, catRows] of byCategory.entries()) {
    const categoryTotal = catRows.reduce((sum, r) => sum + r.absAmount, 0);
    if (categoryTotal <= 0) continue;

    const groups = groupByMerchant(
      catRows.map((r) => ({
        amount: r.amount,
        description: r.rawDescription,
        date: r.date,
        category_id: r.category_id,
      })),
    );
    if (groups.length === 0) continue;
    const top = groups[0];
    const share = top.total_spend / categoryTotal;
    if (share < MERCHANT_IN_CATEGORY_MIN_SHARE) continue;

    // Pick sample transactions from the top merchant only.
    const topMerchantRows = catRows.filter((r) => r.merchantKey === top.merchant);
    const sample_transactions = pickSampleTransactions(
      topMerchantRows,
      SAMPLE_TRANSACTIONS_LIMIT,
    );

    const sharePct = Math.round(share * 1000) / 10;

    stories.push({
      type: 'merchant_in_category',
      headline: `${top.merchant} is ${sharePct}% of your ${category} spend`,
      magnitude: {
        amount: round2(top.total_spend),
        currency,
        share_pct: sharePct,
      },
      merchants: [top.merchant],
      comparison: 'That single merchant accounts for nearly half of this category.',
      sample_transactions,
      narrative_hint:
        'Single merchant doing most of the work in this category — worth asking what each visit is.',
      data_confidence: overallConfidence,
    });
  }

  return stories;
}

// --- B. Category concentration ---
function detectDominantCategory(
  rows: NormalisedRow[],
  currency: string,
  minSharePct: number,
  overallConfidence: DataConfidence,
): ClusterStory[] {
  const totalSpend = rows.reduce((sum, r) => sum + r.absAmount, 0);
  if (totalSpend <= 0) return [];

  const byCategory = new Map<string, NormalisedRow[]>();
  for (const r of rows) {
    const existing = byCategory.get(r.category_id);
    if (existing) existing.push(r);
    else byCategory.set(r.category_id, [r]);
  }

  const stories: ClusterStory[] = [];
  const threshold = minSharePct / 100;

  for (const [category, catRows] of byCategory.entries()) {
    const categoryTotal = catRows.reduce((sum, r) => sum + r.absAmount, 0);
    const share = categoryTotal / totalSpend;
    if (share < threshold) continue;

    const sharePct = Math.round(share * 1000) / 10;
    const topMerchants = pickTopMerchantNames(catRows, MERCHANT_LIST_LIMIT);
    const sample_transactions = pickSampleTransactions(
      catRows,
      SAMPLE_TRANSACTIONS_LIMIT,
    );

    stories.push({
      type: 'dominant_category',
      headline: `${category} is ${sharePct}% of your total spend (${formatCurrency(categoryTotal, currency)})`,
      magnitude: {
        amount: round2(categoryTotal),
        currency,
        share_pct: sharePct,
      },
      merchants: topMerchants,
      comparison: `This category alone takes up ${sharePct}% of your monthly outflows.`,
      sample_transactions,
      narrative_hint:
        'One category swallowing a meaningful slice of spend — is this where the user wants their money going?',
      data_confidence: overallConfidence,
    });
  }

  return stories;
}

// --- C. Recurring same-amount-same-merchant ---
function detectRecurringMerchant(
  rows: NormalisedRow[],
  currency: string,
  nDays: number,
  overallConfidence: DataConfidence,
): ClusterStory[] {
  // Group by normalised merchant key.
  const byMerchant = new Map<string, NormalisedRow[]>();
  for (const r of rows) {
    const existing = byMerchant.get(r.merchantKey);
    if (existing) existing.push(r);
    else byMerchant.set(r.merchantKey, [r]);
  }

  const stories: ClusterStory[] = [];
  const totalSpend = rows.reduce((sum, r) => sum + r.absAmount, 0);

  for (const [merchant, mRows] of byMerchant.entries()) {
    if (mRows.length < RECURRING_MIN_OCCURRENCES) continue;

    // Compute mean + std dev on absolute amounts. Skip refund-only or zero-spend merchants.
    const amounts = mRows.map((r) => r.absAmount).filter((a) => a > 0);
    if (amounts.length < RECURRING_MIN_OCCURRENCES) continue;
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    if (mean <= 0) continue;
    const variance =
      amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean;
    if (cv >= RECURRING_MAX_CV) continue;

    const merchantTotal = mRows.reduce((sum, r) => sum + r.absAmount, 0);
    const sharePct =
      totalSpend > 0 ? Math.round((merchantTotal / totalSpend) * 1000) / 10 : 0;

    // "X times per month" — normalise occurrence count by window.
    const occurrencesPerMonth =
      nDays > 0 ? Math.round((amounts.length / nDays) * 30 * 10) / 10 : amounts.length;

    const sample_transactions = pickSampleTransactions(
      mRows,
      SAMPLE_TRANSACTIONS_LIMIT,
    );

    // Per-merchant confidence: pattern detection downgrades to 'low' if
    // <3 occurrences, but we've already gated above. Re-run with the
    // occurrence count so the helper has full inputs.
    const perStory = assessDataConfidence({
      n_transactions: amounts.length,
      n_days: nDays,
      expected_recurrence_count: amounts.length,
    });

    stories.push({
      type: 'recurring_merchant',
      headline: `${merchant} hits like clockwork: ${amounts.length}× at ~${formatCurrency(mean, currency)} each`,
      magnitude: {
        amount: round2(merchantTotal),
        currency,
        share_pct: sharePct,
      },
      merchants: [merchant],
      comparison: `~${occurrencesPerMonth} times per month at ${formatCurrency(mean, currency)} each.`,
      sample_transactions,
      narrative_hint:
        'Consistent recurring shape — subscription, fixed bill, or routine?',
      // If the per-story assessment is stricter than the overall, trust it.
      data_confidence:
        perStory.level === 'low' ? 'low' : overallConfidence,
    });
  }

  return stories;
}

export function createFindMoneyClustersTool(ctx: ToolContext) {
  return {
    description:
      'Find where money piles up — single-merchant concentration in a category, a category dominating overall spend, or consistent recurring same-amount transactions. Use when the user\'s brief mentions cash flow concerns or when you need a hypothesis about which corner of their spending matters most. Returns up to several candidate stories the user might want to talk through.',
    inputSchema,
    execute: async (input: FindMoneyClustersInput) => {
      try {
        const { date_from, date_to, min_share_pct } = input;
        const n_days = daysBetween(date_from, date_to);

        // PostgREST builder chain — same `any` convention as sibling tools.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query: any = ctx.supabase
          .from('transactions')
          .select('id, date, description, amount, category_id')
          .eq('user_id', ctx.userId)
          .gte('date', date_from)
          .lte('date', date_to)
          .is('deleted_at', null)
          // Spend rows only — drop income/transfers/debt-repay/savings server-side.
          .not('category_id', 'in', EXCLUDED_FROM_PL_PG_LIST);

        const { data: rawRows, error } = (await query) as {
          data: DbRow[] | null;
          error: { message: string } | null;
        };

        if (error) {
          console.error('[tool:find_money_clusters] DB error:', error);
          return { error: 'Could not fetch transactions. Please try again.' };
        }

        // Belt-and-braces: re-filter on the client to drop anything the server
        // missed (e.g. NULL category_id). Mirrors get-spending-summary.
        const filtered = (rawRows ?? []).filter((r) =>
          affectsSpendingBreakdown(r.category_id),
        );

        // Normalise rows for downstream processing.
        const rows: NormalisedRow[] = filtered.map((r) => {
          const signed = Number(r.amount);
          const desc = r.description ?? '';
          const normalised = normaliseMerchant(desc);
          return {
            id: r.id,
            date: r.date,
            description: desc || 'Unknown',
            rawDescription: r.description,
            merchantKey: normalised || 'unknown',
            amount: signed,
            absAmount: absExpense(signed),
            category_id: r.category_id as string,
          };
        });

        const n_transactions = rows.length;
        const overallConfidence = assessDataConfidence({
          n_transactions,
          n_days,
        });

        const baseReturn = {
          filter: { date_from, date_to, min_share_pct },
          currency: ctx.currency,
          window: { n_transactions, n_days },
          data_confidence: overallConfidence.level,
        };

        if (n_transactions === 0) {
          return { ...baseReturn, stories: [] as ClusterStory[] };
        }

        // Run all three detectors. Each returns 0+ stories.
        const stories: ClusterStory[] = [
          ...detectMerchantInCategory(rows, ctx.currency, overallConfidence.level),
          ...detectDominantCategory(
            rows,
            ctx.currency,
            min_share_pct,
            overallConfidence.level,
          ),
          ...detectRecurringMerchant(
            rows,
            ctx.currency,
            n_days,
            overallConfidence.level,
          ),
        ];

        return { ...baseReturn, stories };
      } catch (err) {
        console.error('[tool:find_money_clusters] unexpected error:', err);
        return {
          error: 'Something went wrong finding money clusters. Please try again.',
        };
      }
    },
  };
}
