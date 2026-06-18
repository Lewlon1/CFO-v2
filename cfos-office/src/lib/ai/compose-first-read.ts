/**
 * First Read composition orchestrator.
 *
 * Pulls Layer 2 (Value Profile), Layer 3 (behavioural features for top clusters),
 * and Layer 5 (active goal). Composes a one-shot LLM generation via Bedrock.
 * Returns the composed message plus metadata describing what the composition
 * actually cited — Session C's wow_assessment plumbing reads this metadata.
 *
 * No tool calls during composition: the model writes from the pre-computed
 * context. The behavioural tools are for ongoing chat, not this one-shot.
 */

import { generateText } from 'ai';
import type { SupabaseClient } from '@supabase/supabase-js';

import { bedrock, chatModelId } from '@/lib/ai/provider';
import { createServiceClient } from '@/lib/supabase/service';
import { buildUserValueProfile } from '@/lib/value-map/value-profile';
import { getClusterBehaviour } from '@/lib/analytics/cluster-behaviour';
import { getDataWindowEnd, getDataWindowCoverage } from '@/lib/analytics/cluster-behaviour/queries';
import type { ClusterBehaviour } from '@/lib/analytics/cluster-behaviour/types';
import { normaliseMerchantDescription } from '@/lib/analytics/merchant-normalise';
import { deriveLevers, type LeverPackage } from '@/lib/analytics/levers';
import {
  reconcileFixedCosts,
  type ReconciledBill,
} from '@/lib/analytics/reconcile-fixed-costs';
import { resolveUserCurrency } from '@/lib/analytics/resolve-user-currency';
import { formatBenchmarkObservation } from '@/lib/analytics/benchmark/format';
import {
  selectHookCandidates,
  type HookCandidate,
} from '@/lib/ai/compose-first-read-hooks';
import { getSpendingBreakdown, type SpendingBreakdown } from '@/lib/analytics/spending-breakdown';
import { categoryLabel } from '@/lib/analytics/categories';
import { selectReadRecipe, type ReadRecipe } from '@/lib/ai/first-read-recipe';
import { monthsBetween } from '@/lib/goals/pace';
import { requiredMonthlyBand, INVESTMENT_DEFAULT_RATE_PCT } from '@/lib/finance/compound-growth';
import { formatMoney } from '@/lib/format/money';

import {
  FIRST_READ_SYSTEM_PROMPT,
  FIRST_READ_SYSTEM_PROMPT_VALUE_FIRST,
  FIRST_READ_SYSTEM_PROMPT_RECOMPOSE,
  FIRST_READ_SYSTEM_PROMPT_DECLARED,
  FIRST_READ_SYSTEM_PROMPT_DECLARED_UPGRADE,
  buildFirstReadUserPrompt,
  buildDeclaredUserPrompt,
  type FirstReadComposeOutput,
  type FirstReadMetadata,
  type PriorReadSummary,
} from './prompts/first-read';

const WINDOW_DAYS = 90;
const DAYS_PER_MONTH = 30.44;
const TOP_CLUSTER_LIMIT = 10;
const MIN_DATA_COMPLETENESS = 0.3;
const MAX_OUTPUT_TOKENS = 700;

// The declared Read is 70–130 words (it stands on two numbers, not 90 days of
// data), so it gets a tighter ceiling than the transaction Read — generous
// enough to never truncate the CTA/sign-off, tight enough to cap a runaway.
const DECLARED_MAX_OUTPUT_TOKENS = 400;

const COMPOSE_MODEL = process.env.BEDROCK_COMPOSE_MODEL || chatModelId;

export type ComposeFirstReadMode =
  | 'default'
  | 'value_first'
  | 'value_first_recompose'
  | 'declared'
  | 'declared_upgrade';

export type { PriorReadSummary };

/**
 * Decline-on-thin predicate for the declared_upgrade path. The upgrade is a
 * real-transaction Read — if the upload produced no usable clusters OR no hook
 * candidates, there is no spending picture to sharpen the declared Read with, so
 * the route must NOT call the LLM (it would either hallucinate or just re-state
 * the declared numbers). Pure so it can be unit-tested without Bedrock.
 */
export function isDeclaredUpgradeInsufficient(
  usableClusters: ClusterBehaviour[],
  hookCandidates: HookCandidate[],
): boolean {
  return usableClusters.length === 0 || hookCandidates.length === 0;
}

/**
 * Builds the decline-on-thin RETURN for the declared_upgrade path: an empty
 * message plus the typed `insufficientData` signal the route keys off to skip
 * appending an upgrade. Pure (no Bedrock/Supabase) so the decline contract —
 * `insufficientData === true`, `composedMessage === ''`, `metadata.mode ===
 * 'declared_upgrade'` — is unit-testable, and so the metadata literal lives in
 * one place instead of being hand-maintained inline.
 */
export function declaredUpgradeDeclineResult(
  readRecipe: ReadRecipe | null,
): FirstReadComposeOutput {
  return {
    composedMessage: '',
    metadata: {
      layers_used: [],
      features_cited: [],
      gap_present: false,
      clusters_referenced: [],
      levers_offered: [],
      blocker_field: null,
      mode: 'declared_upgrade',
      hook_candidates: null,
      read_recipe: readRecipe,
      breakdown_cited: false,
      is_recompose: false,
      repeated_opening: false,
    },
    insufficientData: true,
  };
}

export async function composeFirstRead(params: {
  userId: string;
  supabase?: SupabaseClient;
  mode?: ComposeFirstReadMode;
  /** Present only for value_first_recompose — what the prior Read already said. */
  priorReadSummary?: PriorReadSummary;
  /** The merchant keys the Value Map actually presented (Phase 1 selection), for the recompose payoff context. */
  valueMapCardKeys?: string[];
}): Promise<FirstReadComposeOutput> {
  const supabase = params.supabase ?? createServiceClient();
  const mode = params.mode ?? 'default';
  const isRecompose = mode === 'value_first_recompose';
  const isDeclaredUpgrade = mode === 'declared_upgrade';
  // Both the post-Value-Map recompose and the post-upload declared upgrade carry
  // a PriorReadSummary (the do-not-restate contract). Threading it for the
  // upgrade does NOT light up the Value-Map-sort recompose machinery — the prompt
  // builder branches on the explicit `mode`, not on `priorReadSummary != null`.
  const threadsPrior = isRecompose || isDeclaredUpgrade;

  if (mode === 'declared') {
    return composeDeclaredRead(supabase, params.userId);
  }

  const [valueProfile, topMerchants, goalRow, transactionCountTotal, dataWindowEnd, financialFacts, benchmarkObservation, entry] = await Promise.all([
    buildUserValueProfile(supabase, params.userId),
    getTopMerchantKeys(supabase, params.userId),
    getActiveGoal(supabase, params.userId),
    getTransactionCount(supabase, params.userId, WINDOW_DAYS),
    getDataWindowEnd(supabase, params.userId),
    getFinancialFacts(supabase, params.userId),
    getTopBenchmarkObservation(supabase, params.userId),
    getEntryStruggle(supabase, params.userId),
  ]);

  // The breakdown windows off dataWindowEnd (resolved above), not today —
  // a user whose data ended weeks ago would window into an empty range.
  const spendingBreakdown = await getSpendingBreakdown(
    supabase,
    params.userId,
    WINDOW_DAYS,
    dataWindowEnd,
  );

  // Actual data coverage inside the window. The monthly normaliser and the
  // thin-data caveat both key off REAL coverage, not the fixed 90d window — a
  // one-month upload divided by 90d understated every "/mo" figure ~3x and the
  // Read never flagged that it was reading a single month.
  const coverage = await getDataWindowCoverage(
    supabase,
    params.userId,
    WINDOW_DAYS,
    dataWindowEnd,
  );
  const effectiveMonths = Math.max(1, coverage.coveredDays / DAYS_PER_MONTH);

  // Levers run AFTER the breakdown: the cut lever names the biggest discretionary
  // category from it, so the Read's ONE ACTION and the breakdown refer to the
  // same category (was: a recurring_expenses cut that surfaced essentials/renfe).
  const leverPackage = await deriveLevers({
    supabase,
    userId: params.userId,
    currency: financialFacts.currency,
    spendingBreakdown,
    windowDays: WINDOW_DAYS,
    effectiveMonths,
  });

  // Goal-first precedence, mirroring resolveUserIntent() in insight-engine.ts.
  const readRecipe = selectReadRecipe({
    goal: goalRow,
    entryStruggle: entry?.entry_struggle ?? null,
    entryStruggleText: entry?.entry_struggle_text ?? null,
  });

  // Fetched once, threaded into every cluster lookup. Without this every
  // cluster behaviour call re-queries the same MAX(date), and worse, the
  // dormancy threshold compares against today rather than the user's data
  // window — producing false positives like "supermarket dormant for 42 days"
  // when the user's CSV ended 30 days ago.
  const clusterBehaviours = await Promise.all(
    topMerchants.map((merchantKey) =>
      getClusterBehaviour({
        userId: params.userId,
        clusterType: 'merchant',
        clusterId: merchantKey,
        windowDays: WINDOW_DAYS,
        supabase,
        dataWindowEnd,
      }).catch((err) => {
        console.error('[compose-first-read] cluster behaviour failed:', merchantKey, err);
        return null;
      }),
    ),
  );

  const usableClusters = clusterBehaviours.filter(
    (c): c is ClusterBehaviour => c != null && c.data_completeness >= MIN_DATA_COMPLETENESS,
  );

  const goalSummary = goalRow
    ? buildGoalSummary(goalRow, financialFacts.currency)
    : null;

  const dataAgeDays = dataWindowEnd
    ? Math.max(0, Math.floor((Date.now() - new Date(dataWindowEnd).getTime()) / 86_400_000))
    : null;

  // Value-first AND declared-upgrade close on the HOOK: pre-compute the hook
  // candidates the Read ends on. The candidates are persisted into
  // conversation.metadata by the caller so the Value Map step can run on the same
  // real flagged transactions.
  const usesHook = mode === 'value_first' || isDeclaredUpgrade;
  const hookCandidates: HookCandidate[] = usesHook
    ? selectHookCandidates(usableClusters, valueProfile)
    : [];

  // Decline-on-thin (declared_upgrade only): if the upload is too sparse to
  // produce a real spending picture, do NOT call the LLM. Return a typed signal
  // the route can detect (insufficientData) so it can leave the declared Read as
  // the last word instead of appending an empty or hallucinated upgrade.
  if (isDeclaredUpgrade && isDeclaredUpgradeInsufficient(usableClusters, hookCandidates)) {
    return declaredUpgradeDeclineResult(readRecipe);
  }

  const userPrompt = buildFirstReadUserPrompt({
    userId: params.userId,
    mode,
    valueProfile,
    goalSummary,
    topClusterBehaviours: usableClusters,
    transactionCountTotal,
    windowDays: WINDOW_DAYS,
    dataWindowEnd,
    dataWindowStart: coverage.firstDate,
    dataAgeDays,
    coveredDays: coverage.coveredDays,
    monthsSpanned: coverage.monthsSpanned,
    effectiveMonths,
    levers: leverPackage.levers,
    blocker: leverPackage.blocker,
    financialFacts,
    hookCandidates: usesHook ? hookCandidates : undefined,
    benchmarkObservation,
    spendingBreakdown,
    readRecipe,
    // Recompose carries the delta contract + Value-Map payoff source; the
    // declared upgrade carries the delta contract only (no sort happened).
    priorReadSummary: threadsPrior ? (params.priorReadSummary ?? null) : null,
    valueMapCardKeys: isRecompose ? (params.valueMapCardKeys ?? null) : null,
  });

  const systemPrompt = isRecompose
    ? FIRST_READ_SYSTEM_PROMPT_RECOMPOSE
    : isDeclaredUpgrade
      ? FIRST_READ_SYSTEM_PROMPT_DECLARED_UPGRADE
      : mode === 'value_first' && hookCandidates.length > 0
        ? FIRST_READ_SYSTEM_PROMPT_VALUE_FIRST
        : FIRST_READ_SYSTEM_PROMPT;

  const result = await generateText({
    model: bedrock(COMPOSE_MODEL),
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: 0.5,
    abortSignal: AbortSignal.timeout(20_000),
  });

  const composedMessage = result.text.trim();

  const metadata = extractCompositionMetadata({
    composedMessage,
    usableClusters,
    goalSummary,
    leverPackage,
    mode,
    hookCandidates,
    readRecipe,
    spendingBreakdown,
    priorReadSummary: threadsPrior ? (params.priorReadSummary ?? null) : null,
  });

  return { composedMessage, metadata };
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function getTopMerchantKeys(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('merchant_aggregates')
    .select('merchant_key, transaction_count, last_seen, first_seen')
    .eq('user_id', userId)
    .gte('month_start', since)
    .order('transaction_count', { ascending: false })
    .limit(TOP_CLUSTER_LIMIT * 3);
  if (error) {
    console.error('[compose-first-read] getTopMerchantKeys failed:', error);
    return [];
  }

  const rolled = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ merchant_key: string; transaction_count: number }>) {
    if (!row.merchant_key) continue;
    const key = normaliseMerchantDescription(row.merchant_key);
    rolled.set(key, (rolled.get(key) ?? 0) + row.transaction_count);
  }
  return Array.from(rolled.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_CLUSTER_LIMIT)
    .map(([key]) => key);
}

export type FinancialFacts = {
  net_monthly_income: number | null;
  monthly_rent: number | null;
  total_fixed_costs: number | null;
  free_cash_flow: number | null;
  currency: string;
  /** 'variable' means income swings — surface it instead of a flat monthly figure. */
  income_shape: string | null;
  t3m_income_monthly: number | null;
  /**
   * Where the income figure came from: 'observed' (seen landing), 'declared_unverified'
   * (user stated it, no deposit seen), or 'unknown'. Drives the declared-income hedge.
   */
  income_provenance: string | null;
};

async function getFinancialFacts(
  supabase: SupabaseClient,
  userId: string,
): Promise<FinancialFacts> {
  const [profileRes, snapshotRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('net_monthly_income, monthly_rent, primary_currency, income_shape, t3m_income_monthly, income_provenance, country')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('monthly_snapshots')
      .select('total_fixed_costs')
      .eq('user_id', userId)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const txnRes = await supabase
    .from('transactions')
    .select('currency')
    .eq('user_id', userId)
    .limit(500);
  const income =
    typeof profileRes.data?.net_monthly_income === 'number'
      ? profileRes.data.net_monthly_income
      : null;
  const rent =
    typeof profileRes.data?.monthly_rent === 'number'
      ? profileRes.data.monthly_rent
      : null;
  let totalFixed: number | null =
    typeof snapshotRes.data?.total_fixed_costs === 'number'
      ? snapshotRes.data.total_fixed_costs
      : null;
  // Fallback to a live reconcile when the snapshot has no fixed-cost total.
  // Two scenarios this catches: (1) a fresh user whose first snapshot hasn't
  // been generated yet, and (2) any historical snapshot written before the
  // monthly_snapshots.total_fixed_costs column existed (the Supabase insert
  // silently dropped the field). Without this fallback the Read announces
  // "fixed costs aren't on file" even when reconcile would produce a number.
  if (totalFixed == null) {
    try {
      const { totalFixedCostsMonthly } = await reconcileFixedCosts(supabase, userId);
      totalFixed = totalFixedCostsMonthly ?? null;
    } catch (err) {
      console.error('[compose-first-read] reconcile fallback for fixed costs failed:', err);
      totalFixed = null;
    }
  }
  const freeCashFlow =
    income != null && totalFixed != null
      ? Math.round((income - totalFixed) * 100) / 100
      : null;
  return {
    net_monthly_income: income,
    monthly_rent: rent,
    total_fixed_costs: totalFixed,
    free_cash_flow: freeCashFlow,
    currency: resolveUserCurrency(
      (profileRes.data?.country as string | null) ?? null,
      (profileRes.data?.primary_currency as string | null) ?? null,
      (txnRes.data as Array<{ currency?: string | null }> | null) ?? [],
    ),
    income_shape:
      typeof profileRes.data?.income_shape === 'string' ? profileRes.data.income_shape : null,
    t3m_income_monthly:
      typeof profileRes.data?.t3m_income_monthly === 'number'
        ? profileRes.data.t3m_income_monthly
        : null,
    income_provenance:
      typeof profileRes.data?.income_provenance === 'string'
        ? profileRes.data.income_provenance
        : null,
  };
}

async function getEntryStruggle(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ entry_struggle: string | null; entry_struggle_text: string | null } | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('entry_struggle, entry_struggle_text')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('[compose-first-read] getEntryStruggle failed:', error);
    return null;
  }
  return data
    ? {
        entry_struggle: (data.entry_struggle as string | null) ?? null,
        entry_struggle_text: (data.entry_struggle_text as string | null) ?? null,
      }
    : null;
}

async function getActiveGoal(
  supabase: SupabaseClient,
  userId: string,
): Promise<{
  name: string;
  target_amount: number | null;
  current_amount: number | null;
  target_date: string | null;
  type: string | null;
  monthly_required_saving: number | null;
} | null> {
  const { data } = await supabase
    .from('goals')
    .select('name, target_amount, current_amount, target_date, type, monthly_required_saving')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data
    ? {
        name: data.name as string,
        target_amount: data.target_amount as number | null,
        current_amount: data.current_amount as number | null,
        target_date: data.target_date as string | null,
        type: (data.type as string | null) ?? null,
        monthly_required_saving: (data.monthly_required_saving as number | null) ?? null,
      }
    : null;
}

/**
 * Renders the active goal into the GOAL prompt block, in the user's currency.
 * For investment goals it supplies the compound-growth-aware monthly figure
 * AND a rate band so the Read can teach the concept and show a range — rather
 * than the model inventing a flat division (which made achievable long-horizon
 * goals read as impossible) or dropping the already-saved amount.
 */
export function buildGoalSummary(
  goal: {
    name: string;
    target_amount: number | null;
    current_amount: number | null;
    target_date: string | null;
    type: string | null;
    monthly_required_saving: number | null;
  },
  currency: string,
): string {
  const lines: string[] = [];
  // Whole-currency rounding for the Read — cents read like a spreadsheet, not a CFO.
  const m = (v: number) => formatMoney(Math.round(v), currency);
  const head = [
    goal.name,
    goal.target_amount != null ? `target ${m(goal.target_amount)}` : null,
    goal.current_amount != null
      ? `already saved ${m(goal.current_amount)}`
      : null,
    goal.target_date ? `by ${goal.target_date}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  lines.push(head);

  const monthsLeft =
    goal.target_date != null ? monthsBetween(new Date(), new Date(goal.target_date)) : null;

  if (
    goal.type === 'investment' &&
    goal.target_amount != null &&
    monthsLeft != null &&
    monthsLeft > 0
  ) {
    const target = goal.target_amount;
    const current = goal.current_amount ?? 0;
    const band = requiredMonthlyBand({ targetAmount: target, currentAmount: current, months: monthsLeft });
    const bandStr = band
      .map((b) => `${m(b.monthly ?? 0)}/mo at ${b.ratePct}%`)
      .join(', ');
    const base =
      band.find((b) => b.ratePct === INVESTMENT_DEFAULT_RATE_PCT) ?? band[Math.floor(band.length / 2)];
    const baseStr = base ? m(base.monthly ?? 0) : '(n/a)';
    const linear = Math.max(0, (target - current) / monthsLeft);
    lines.push(
      `Monthly contribution needed, accounting for COMPOUND GROWTH (the pot earns returns, ` +
        `so far less than a flat split): ${bandStr}. ` +
        `A naive no-growth split would demand ${m(linear)}/mo — cite the growth-aware figures, not that. ` +
        `PLAN AROUND the ${INVESTMENT_DEFAULT_RATE_PCT}% (middle) case — ${baseStr}/mo — as the working number. ` +
        `Show the full range ONCE so the user sees the options, then commit to the ${INVESTMENT_DEFAULT_RATE_PCT}% figure ` +
        `and size the verdict and any gap against THAT, not the 4% figure. ` +
        `Explain in ONE plain line where the ${INVESTMENT_DEFAULT_RATE_PCT}% comes from: it is the moderate middle of the ` +
        `range — roughly the long-run average a broadly diversified portfolio has returned over a horizon like this — an ` +
        `assumption, not a promise, which is exactly why the 4% case stays in view as the stress test and 10% as the upside. ` +
        `Returns on the ${m(current)} already saved do much of the heavy lifting over this horizon. ` +
        `Give a clear verdict on whether the target is realistic at the ${INVESTMENT_DEFAULT_RATE_PCT}% plan given their free ` +
        `cash flow. If free cash flow already covers the ${INVESTMENT_DEFAULT_RATE_PCT}% number, say so plainly — the goal is ` +
        `funded at plan, so frame the next move as getting there sooner or covering the 4% stress case, never as closing a gap ` +
        `that does not exist at plan.`,
    );
  } else if (goal.monthly_required_saving != null && monthsLeft != null && monthsLeft > 0) {
    lines.push(
      `Monthly contribution needed: ${m(goal.monthly_required_saving)}/mo ` +
        `(straight-line, already nets off the ${m(goal.current_amount ?? 0)} saved).`,
    );
  }

  return lines.join('\n');
}

export interface DeclaredReadFacts {
  income: number
  totalFixedCosts: number
  freeCash: number
  goalName: string | null
  monthlyRequiredSaving: number | null
  percentOfIncome: number | null
  /** Free cash left after the goal contribution — a MODELLED cushion (not observed
   *  spend). null when there's no goal pace to subtract. Computed server-side so the
   *  model cites it verbatim instead of doing the arithmetic itself (Rule 2). */
  unallocated: number | null
  currency: string
}

export function buildDeclaredFacts(input: {
  income: number
  totalFixedCosts: number
  goal: { name: string; monthlyRequiredSaving: number | null } | null
  currency: string
}): DeclaredReadFacts {
  const freeCash = Math.max(0, input.income - input.totalFixedCosts)
  const mrs = input.goal?.monthlyRequiredSaving ?? null
  const percentOfIncome =
    mrs != null && input.income > 0 ? Math.round((mrs / input.income) * 100) : null
  // The cushion left after the goal contribution — computed here so the model
  // never derives it itself (Rule 2). null when there's no pace to subtract.
  const unallocated = mrs != null ? Math.max(0, freeCash - mrs) : null
  return {
    income: input.income,
    totalFixedCosts: input.totalFixedCosts,
    freeCash,
    goalName: input.goal?.name ?? null,
    monthlyRequiredSaving: mrs,
    percentOfIncome,
    unallocated,
    currency: input.currency,
  }
}

/**
 * Declared-numbers Read (skip-upload path). The user reached details_confirmed
 * without importing any transactions, so there is no Layer-1/Layer-3 data to
 * compose from. This Read stands entirely on the figures they declared —
 * income + fixed costs → free cash, plus goal pace — and closes by inviting a
 * real 3-month statement upload to sharpen it. See plan G4.
 */
async function composeDeclaredRead(
  supabase: SupabaseClient,
  userId: string,
): Promise<FirstReadComposeOutput> {
  const [facts, goalRow] = await Promise.all([
    getFinancialFacts(supabase, userId),
    getActiveGoal(supabase, userId),
  ]);

  const declaredFacts = buildDeclaredFacts({
    income: facts.net_monthly_income ?? 0,
    totalFixedCosts: facts.total_fixed_costs ?? 0,
    goal: goalRow
      ? { name: goalRow.name, monthlyRequiredSaving: goalRow.monthly_required_saving }
      : null,
    currency: facts.currency,
  });

  const result = await generateText({
    model: bedrock(COMPOSE_MODEL),
    system: FIRST_READ_SYSTEM_PROMPT_DECLARED,
    messages: [{ role: 'user', content: buildDeclaredUserPrompt(declaredFacts) }],
    maxOutputTokens: DECLARED_MAX_OUTPUT_TOKENS,
    temperature: 0.5,
    abortSignal: AbortSignal.timeout(20_000),
  });

  const metadata: FirstReadMetadata = {
    layers_used: ['declared'],
    features_cited: [],
    gap_present: false,
    clusters_referenced: [],
    levers_offered: [],
    blocker_field: null,
    mode: 'declared',
    hook_candidates: null,
    read_recipe: null,
    breakdown_cited: false,
    is_recompose: false,
    repeated_opening: false,
  };

  return { composedMessage: result.text.trim(), metadata };
}

/**
 * Picks the single most-above-band bill verdict and renders it as a safe
 * observational sentence. The Read narrates at most one benchmark line — more
 * dilutes the headline and pushes us closer to "audit" territory. Returns
 * null when no above-band verdict exists (the silent case is the default).
 *
 * Re-runs reconcileFixedCosts to derive verdicts fresh. The verdicts are
 * not persisted anywhere (reconcile is the source of truth), so this is
 * the read path. Cost: one extra round-trip of small queries against
 * user_profiles + user_declared_fixed_costs + recurring_expenses, plus N
 * benchmark_reference lookups (N = number of confirmed bills, typically
 * 3-7). Bearable for a one-shot composition; do not call hot.
 */
async function getTopBenchmarkObservation(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  let reconciled: { items: ReconciledBill[] }
  try {
    reconciled = await reconcileFixedCosts(supabase, userId)
  } catch (err) {
    console.error('[compose-first-read] reconcile for benchmark failed:', err)
    return null
  }

  const above = reconciled.items
    .filter((b) => b.benchmark_verdict?.verdict === 'above' && !b.superseded)
    .map((b) => ({
      bill: b,
      delta: b.monthly_equivalent - (b.benchmark_verdict!.band_high ?? b.monthly_equivalent),
    }))
    .sort((a, b) => b.delta - a.delta)

  const top = above[0]
  if (!top || !top.bill.benchmark_verdict) return null

  return formatBenchmarkObservation({
    label: top.bill.label,
    monthly_amount: top.bill.monthly_equivalent,
    verdict: top.bill.benchmark_verdict,
  })
}

async function getTransactionCount(
  supabase: SupabaseClient,
  userId: string,
  windowDays: number,
): Promise<number> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const { count } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('date', since);
  return count ?? 0;
}

/** First sentence, lowercased + whitespace-collapsed, for the repeated-opening probe. */
function firstSentenceOf(message: string): string {
  const trimmed = message.trim();
  // Split on sentence-ending punctuation followed by space/newline, or newline.
  const match = trimmed.split(/(?<=[.!?])\s+|\n/)[0] ?? trimmed;
  return match.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function extractCompositionMetadata(args: {
  composedMessage: string;
  usableClusters: ClusterBehaviour[];
  goalSummary: string | null;
  leverPackage?: LeverPackage;
  mode?: ComposeFirstReadMode;
  hookCandidates?: HookCandidate[];
  readRecipe?: ReadRecipe;
  spendingBreakdown?: SpendingBreakdown | null;
  priorReadSummary?: PriorReadSummary | null;
}): FirstReadMetadata {
  const text = args.composedMessage.toLowerCase();
  const isRecompose = args.mode === 'value_first_recompose';
  // Both the recompose and the declared upgrade are DELTAS off a prior Read, so
  // both carry a PriorReadSummary and both must not re-open on the prior's first
  // sentence — the repeated_opening probe is meaningful for either.
  const threadsPrior = isRecompose || args.mode === 'declared_upgrade';

  const layers_used = ['L1', 'L2', 'L3'];
  if (args.goalSummary) layers_used.push('L5');

  const features_cited: string[] = [];
  if (/\b(climb\w*|grew|rising|rose|up\s+\d+%|fall\w*|fell|declin\w*|down\s+\d+%|trend\w*)\b/.test(text)) features_cited.push('trend');
  if (/\b(every\s+\d+|recurring|weekly|monthly|daily|clockwork|regular(ly)?)\b/.test(text)) features_cited.push('recurrence');
  if (/\b(weekday|weekend|morning|evening|sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/.test(text)) features_cited.push('time_pattern');
  if (/\b(first\s+(seen|appeared|hit)|new\s+(in|since)|dormant|last\s+(seen|hit))\b/.test(text)) features_cited.push('lifecycle');
  if (/\b(mean\s+[£$€\d]|range\s+[£$€\d]|consistent|varies|fixed)\b/.test(text)) features_cited.push('amount_profile');

  const gap_present =
    /\bcalled\s+\w+\s+(a\s+|an\s+)?(leak|burden|foundation|investment)\b/i.test(args.composedMessage) ||
    (/\bvalue\s+map\b/i.test(args.composedMessage) && /\b(but|however|though|opposite|climb|grew|trend|diverg)/i.test(args.composedMessage));

  const clusters_referenced = args.usableClusters
    .map((c) => normaliseMerchantDescription(c.cluster_id))
    .filter((key) => {
      const probe = key.split(/\s+/).slice(0, 2).join(' ').toLowerCase();
      return probe.length > 2 && args.composedMessage.toLowerCase().includes(probe);
    });

  const breakdown_cited = detectBreakdownCited(args.composedMessage, args.spendingBreakdown);

  // Repeated-opening probe: a well-formed delta (recompose OR declared upgrade)
  // must NOT open on the prior Read's first sentence. Only meaningful when a
  // prior sentence is on hand.
  const priorFirst = args.priorReadSummary?.firstSentence
    ? args.priorReadSummary.firstSentence.toLowerCase().replace(/\s+/g, ' ').trim()
    : null;
  const repeated_opening = threadsPrior && priorFirst
    ? firstSentenceOf(args.composedMessage) === priorFirst
    : false;

  return {
    layers_used,
    features_cited,
    gap_present,
    clusters_referenced,
    levers_offered: args.leverPackage?.levers.map((l) => l.type) ?? [],
    blocker_field: args.leverPackage?.blocker?.type === 'supply_input' ? args.leverPackage.blocker.field : null,
    mode: args.mode ?? 'default',
    hook_candidates: args.hookCandidates ?? null,
    read_recipe: args.readRecipe ?? null,
    breakdown_cited,
    is_recompose: isRecompose,
    repeated_opening,
  };
}

/**
 * Did the composed Read actually surface the breakdown? True when a top-category
 * name or the biggest-merchant total (whole-number, formatting-agnostic) appears
 * in the prose. A cheap regex probe — not a guarantee, a metadata signal for the
 * judge/eval path, mirroring how clusters_referenced and features_cited work.
 */
function detectBreakdownCited(
  message: string,
  breakdown: SpendingBreakdown | null | undefined,
): boolean {
  if (!breakdown) return false;
  const lower = message.toLowerCase();

  for (const slice of breakdown.top_categories) {
    // Match the raw slug ("dining_out"), its spaced form, or the human label
    // ("eating & drinking out") the Read actually prints.
    const slug = slice.category.toLowerCase();
    const spaced = slug.replace(/_/g, ' ');
    const label = categoryLabel(slice.category).toLowerCase();
    if (slug.length > 2 && (lower.includes(slug) || lower.includes(spaced) || lower.includes(label))) {
      return true;
    }
  }

  const total = breakdown.biggest_merchant?.total;
  if (total != null && message.includes(String(Math.round(total)))) return true;

  const largest = breakdown.largest_transaction?.amount;
  if (largest != null && message.includes(String(Math.round(largest)))) return true;

  return false;
}
