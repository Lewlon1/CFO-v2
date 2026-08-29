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

import { bedrock, composeModelId } from '@/lib/ai/provider';
import { createServiceClient } from '@/lib/supabase/service';
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage';
import { experimentStamp, hashPrompt } from '@/lib/ai/experiment-metadata';
import { buildUserValueProfile } from '@/lib/value-map/value-profile';
import { getClusterBehaviour } from '@/lib/analytics/cluster-behaviour';
import { getDataWindowEnd, getDataWindowCoverage, windowStartISO } from '@/lib/analytics/cluster-behaviour/queries';
import type { ClusterBehaviour } from '@/lib/analytics/cluster-behaviour/types';
import { normaliseMerchantDescription } from '@/lib/analytics/merchant-normalise';
import { deriveLevers, type Lever, type LeverPackage } from '@/lib/analytics/levers';
import {
  reconcileFixedCosts,
  type ReconciledBill,
} from '@/lib/analytics/reconcile-fixed-costs';
import { getFinancialPosition, type FinancialPositionBasis } from '@/lib/finance/financial-position';
import {
  buildCitationAllowlist,
  extractCitedFigures,
  validateCitations,
} from '@/lib/ai/insight-validator';
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
// Whole-currency-unit slack for the Issue 1.4 lever/facts consistency
// assertion — both figures round independently (lever to the nearest whole
// unit, FINANCIAL FACTS to the nearest cent), so a 1-unit gap is rounding
// noise, not a real disagreement.
const LEVER_FACTS_CONSISTENCY_TOLERANCE = 1;

// The declared Read is 70–130 words (it stands on two numbers, not 90 days of
// data), so it gets a tighter ceiling than the transaction Read — generous
// enough to never truncate the CTA/sign-off, tight enough to cap a runaway.
// Exported so the A/B producer (scripts/compare-first-insight.ts) generates
// under the same ceiling as production rather than keeping its own copy — a
// variant that could run longer than the real thing would be rated on an
// advantage the shipped path never has.
export const DECLARED_MAX_OUTPUT_TOKENS = 400;

const COMPOSE_MODEL = composeModelId;

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
  /** declared_upgrade only — the snapshot the declared Read stood on (from
   *  conversation metadata). When present, the compose renders a numeric
   *  DECLARED → ACTUAL block; absent (pre-snapshot conversations), the upgrade
   *  frames the delta qualitatively. */
  declaredPriorFacts?: DeclaredReadFacts | null;
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

  // Resolve the data window end first — the user's latest transaction date. It
  // anchors the cluster-selection and transaction-count windows below (and the
  // breakdown/coverage windows further down) so an upload whose statements end
  // weeks or months ago windows onto its OWN activity rather than an empty
  // [today − 90d, today] range. Anchoring those to today is what declined a
  // genuine 3-month upload as "thin" whenever the data wasn't bang up to date.
  const dataWindowEnd = await getDataWindowEnd(supabase, params.userId);

  const [valueProfile, topMerchants, goalRow, transactionCountTotal, financialFacts, benchmarkObservation, entry] = await Promise.all([
    buildUserValueProfile(supabase, params.userId),
    getTopMerchantKeys(supabase, params.userId, dataWindowEnd),
    getActiveGoal(supabase, params.userId),
    getTransactionCount(supabase, params.userId, WINDOW_DAYS, dataWindowEnd),
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
  const rawLeverPackage = await deriveLevers({
    supabase,
    userId: params.userId,
    currency: financialFacts.currency,
    spendingBreakdown,
    windowDays: WINDOW_DAYS,
    effectiveMonths,
  });

  // Issue 1.4 — compose-time consistency assertion. The lever engine and
  // FINANCIAL FACTS both read the unified financial-position module, but
  // they do so via two independent calls, so this is a load-bearing check,
  // not a nicety: the system must refuse to hand the model two contradicting
  // numbers for the same fact. On mismatch, drop the lever and compose
  // without it rather than risk repeating the dorcas/lewis false-surplus bug.
  const leverPackage = reconcileLeverPackageWithFacts(
    rawLeverPackage,
    financialFacts,
    goalRow,
    params.userId,
  );

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

  // DECLARED → ACTUAL delta (declared_upgrade with a snapshot only). Computed
  // server-side so the model cites both sides verbatim (Rule 2). The reconciled
  // bill list drives the per-band miss reconciliation ("you said X, it's Y");
  // a reconcile failure degrades to the aggregate delta rather than losing the
  // whole upgrade Read.
  let reconciledForDelta: ReconciledBill[] = [];
  if (isDeclaredUpgrade && params.declaredPriorFacts) {
    try {
      reconciledForDelta = (await reconcileFixedCosts(supabase, params.userId)).items;
    } catch (err) {
      console.error('[compose-first-read] reconcile for declared delta failed:', err);
    }
  }
  const declaredDelta =
    isDeclaredUpgrade && params.declaredPriorFacts
      ? buildDeclaredDelta(params.declaredPriorFacts, financialFacts, reconciledForDelta)
      : null;

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
    declaredDelta,
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

  // Usage accounting — composes were previously invisible to llm_usage_log,
  // so the cost guard's first_read_compose daily cap had nothing to count.
  void trackLLMUsage({
    userId: params.userId,
    callType: 'first_read_compose',
    model: COMPOSE_MODEL,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    // The prompt hash makes a compose attributable to the exact prompt that
    // produced it — otherwise an A/B run's rows are indistinguishable, since no
    // prompt text is persisted anywhere.
    metadata: { mode, ...experimentStamp(hashPrompt(systemPrompt)) },
  });

  const composedMessage = result.text.trim();

  // Issue 7.2 — numeric grounding for the compose path (recompose included),
  // not just the chat route. The composer never calls tools (it writes from
  // pre-computed context), so the allowlist is built from the SAME facts the
  // prompt handed the model — FINANCIAL FACTS, the lever package, and the
  // spending breakdown — rather than from tool-call outputs. Catches a
  // number the model assembled or misquoted itself; it cannot catch a wrong
  // number the server handed it verbatim (Issue 1's consistency assertion
  // covers that). Non-blocking for now — logs so a regression is visible in
  // the same way the chat route's citation check does, rather than forcing
  // a regenerate (a bigger behavioural change better proven out via this
  // telemetry first).
  // Hoisted so the citation CHECK and the cited-figure CAPTURE below provably
  // run over the same three bundles — if they ever drifted apart, a report
  // could name a source that never fed this Read.
  const factBundles = [
    { toolName: 'financial_facts', output: financialFacts },
    { toolName: 'levers', output: leverPackage.levers },
    { toolName: 'spending_breakdown', output: spendingBreakdown },
  ];
  const citationCheck = validateCitations(
    composedMessage,
    buildCitationAllowlist(factBundles, {}),
  );
  if (!citationCheck.valid && citationCheck.unmatched.numbers.length > 0) {
    console.error('[compose-first-read] citation check found unmatched numbers', {
      userId: params.userId,
      mode,
      unmatched: citationCheck.unmatched.numbers,
    });
  }

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

  // Which computed figures this Read actually put in front of the user, and
  // which bundle produced each. Rides conversations.metadata.first_read_metadata
  // (no migration); /api/reads/feedback snapshots it onto a report so a beta
  // user's "this number is wrong" traces back to the source that computed it.
  metadata.citation_set = extractCitedFigures(composedMessage, factBundles);

  return { composedMessage, metadata };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Issue 1.4: assert the accelerate lever's `surplusOverRequired` reconciles
 * with FINANCIAL FACTS' free_cash_flow minus the goal's monthly requirement.
 * Both are computed from the unified financial-position module, but via two
 * independent calls (deriveLevers' own loadActiveGoals/loadCurrentBudget
 * round-trip vs getFinancialFacts' direct call) — a silent divergence between
 * them is exactly the "two disagreeing sources of truth for the same fact"
 * failure mode the dorcas/lewis review found. On mismatch, drop the lever
 * (never the fact) and log both values so a regression is diagnosable.
 *
 * Also checks the lever's `goalId` against `goalRow.id`: deriveLevers and
 * getActiveGoal resolve "the" active goal via two separate queries, so a
 * user with 2+ active goals could — before both queries were pinned to the
 * same newest-first ordering — have them disagree on WHICH goal, making the
 * numeric comparison below meaningless (comparing two different goals'
 * figures as if they were one). Belt-and-suspenders: even with matching
 * ordering, a same-instant created_at tie could still diverge.
 */
export function reconcileLeverPackageWithFacts(
  leverPackage: LeverPackage,
  financialFacts: FinancialFacts,
  goalRow: { id: string | null; monthly_required_saving: number | null } | null,
  userId: string,
): LeverPackage {
  const accelerate = leverPackage.levers.find(
    (l): l is Extract<Lever, { type: 'accelerate' }> => l.type === 'accelerate',
  );
  if (!accelerate) return leverPackage;

  if (goalRow?.id != null && accelerate.goalId !== goalRow.id) {
    console.error(
      '[compose-first-read] consistency assertion failed: accelerate lever is for a DIFFERENT goal than the Read — dropping the lever',
      { userId, leverGoalId: accelerate.goalId, readGoalId: goalRow.id },
    );
    return {
      levers: leverPackage.levers.filter((l) => l !== accelerate),
      blocker: leverPackage.blocker,
    };
  }

  if (financialFacts.free_cash_flow == null || goalRow?.monthly_required_saving == null) {
    return leverPackage;
  }

  const expectedSurplusOverRequired =
    financialFacts.free_cash_flow - goalRow.monthly_required_saving;
  const diff = Math.abs(accelerate.surplusOverRequired - expectedSurplusOverRequired);
  if (diff > LEVER_FACTS_CONSISTENCY_TOLERANCE) {
    console.error(
      '[compose-first-read] consistency assertion failed: accelerate lever disagrees with FINANCIAL FACTS — dropping the lever',
      {
        userId,
        leverSurplusOverRequired: accelerate.surplusOverRequired,
        expectedFromFacts: expectedSurplusOverRequired,
        freeCashFlow: financialFacts.free_cash_flow,
        monthlyRequired: goalRow.monthly_required_saving,
      },
    );
    return {
      levers: leverPackage.levers.filter((l) => l !== accelerate),
      blocker: leverPackage.blocker,
    };
  }
  return leverPackage;
}

async function getTopMerchantKeys(
  supabase: SupabaseClient,
  userId: string,
  dataWindowEnd?: string | null,
): Promise<string[]> {
  // Anchor the 90-day merchant window to the data's latest month, not today, so
  // a stale upload's aggregates still fall inside it (a today-anchored window
  // returned zero merchant keys for any dataset ending >90d ago → no usable
  // clusters → the upgrade declined as "thin").
  const since = windowStartISO(WINDOW_DAYS, dataWindowEnd);
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
  /**
   * 'observed' — free_cash_flow nets out real discretionary spending history.
   * 'modelled' — no snapshot history exists yet, so free_cash_flow is only
   * income minus fixed costs (assumes zero day-to-day spending). See
   * FinancialPosition.basis — this is that value, carried through verbatim.
   */
  free_cash_flow_basis: FinancialPositionBasis;
};

async function getFinancialFacts(
  supabase: SupabaseClient,
  userId: string,
): Promise<FinancialFacts> {
  // income / fixed costs / free cash ALL come from the unified financial-position
  // module — this used to read monthly_snapshots.total_fixed_costs directly (with
  // a live-reconcile fallback) and compute free_cash_flow as a bare
  // income-minus-fixed-costs subtraction that never netted out discretionary
  // spend. That divergent formula is exactly what produced the false "spare
  // cash" figures the dorcas/lewis staging review caught — this Read's headline
  // number and the accelerate lever's number must be the SAME number (Rule 8).
  const [profileRes, position] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('income_shape, t3m_income_monthly, country, primary_currency')
      .eq('id', userId)
      .maybeSingle(),
    getFinancialPosition(supabase, userId),
  ]);
  const txnRes = await supabase
    .from('transactions')
    .select('currency')
    .eq('user_id', userId)
    .limit(500);
  return {
    net_monthly_income: position.income,
    monthly_rent: position.monthlyRent,
    total_fixed_costs: position.fixedCostsMonthly,
    free_cash_flow: position.freeCash != null ? Math.round(position.freeCash * 100) / 100 : null,
    free_cash_flow_basis: position.basis,
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
    income_provenance: position.incomeProvenance,
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
  id: string;
  name: string;
  target_amount: number | null;
  current_amount: number | null;
  target_date: string | null;
  type: string | null;
  monthly_required_saving: number | null;
} | null> {
  // Ordered newest-first — MUST match loadActiveGoals' ordering (helpers.ts)
  // so the lever engine and this Read narrate the SAME goal when a user has
  // 2+ active goals. reconcileLeverPackageWithFacts below cross-checks the
  // id as a second line of defence.
  const { data } = await supabase
    .from('goals')
    .select('id, name, target_amount, current_amount, target_date, type, monthly_required_saving')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data
    ? {
        id: data.id as string,
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
  /** Goal anchoring figures — already fetched by getActiveGoal; threading them
   *  here lets the Read cite the target in the user's own terms instead of
   *  name-dropping the goal (all nullable — goals can lack any of them). */
  goalTargetAmount: number | null
  goalCurrentAmount: number | null
  goalTargetDate: string | null
  goalType: string | null
  monthlyRequiredSaving: number | null
  percentOfIncome: number | null
  /** Free cash left after the goal contribution — a MODELLED cushion (not observed
   *  spend). null when there's no goal pace to subtract. Computed server-side so the
   *  model cites it verbatim instead of doing the arithmetic itself (Rule 2). */
  unallocated: number | null
  /** Investment goal whose existing pot reaches the target at the plan rate → £0/mo
   *  needed. Frame as ON TRACK, not "no contribution attached". */
  fundedAtPlan: boolean
  /** Moderate (plan) annual return rate the £0/mo verdict rests on. */
  planRatePct: number | null
  /** Conservative (stress-test) annual return rate. */
  stressRatePct: number | null
  /** Monthly contribution the conservative case would need (server-computed). */
  stressMonthly: number | null
  /** Whether declared free cash covers the conservative-case monthly. */
  stressCovered: boolean | null
  currency: string
}

export function buildDeclaredFacts(input: {
  income: number
  totalFixedCosts: number
  goal: {
    name: string
    monthlyRequiredSaving: number | null
    targetAmount?: number | null
    currentAmount?: number | null
    targetDate?: string | null
    type?: string | null
  } | null
  currency: string
}): DeclaredReadFacts {
  const freeCash = Math.max(0, input.income - input.totalFixedCosts)
  let mrs = input.goal?.monthlyRequiredSaving ?? null
  // Straight-line fallback pace when the goal row carries no stored pace but
  // has a dated target — same netting as computePaceAndOnTrack (pace.ts).
  // NEVER for investment goals: their pace is compound-growth-aware
  // (requiredMonthlyBand); a flat split overstates it on long horizons and
  // would put a second, disagreeing pace source in play (Rule 8).
  if (
    mrs == null &&
    input.goal != null &&
    input.goal.type !== 'investment' &&
    input.goal.targetAmount != null &&
    input.goal.targetDate != null
  ) {
    const monthsLeft = monthsBetween(new Date(), new Date(input.goal.targetDate))
    const remaining = input.goal.targetAmount - (input.goal.currentAmount ?? 0)
    if (monthsLeft > 0 && remaining > 0) {
      mrs = Math.round(remaining / monthsLeft)
    }
  }
  const percentOfIncome =
    mrs != null && input.income > 0 ? Math.round((mrs / input.income) * 100) : null
  // The cushion left after the goal contribution — computed here so the model
  // never derives it itself (Rule 2). null when there's no pace to subtract.
  const unallocated = mrs != null ? Math.max(0, freeCash - mrs) : null

  // Investment goal funded at plan: the existing pot is projected to reach the
  // target on its own at the moderate rate, so monthly_required_saving (compound)
  // came back 0. Frame it as ON TRACK, not "no contribution attached". The stress
  // figures come from the SAME band the post-upload Read uses (Rule 8).
  const goalType = input.goal?.type ?? null
  let fundedAtPlan = false
  let planRatePct: number | null = null
  let stressRatePct: number | null = null
  let stressMonthly: number | null = null
  let stressCovered: boolean | null = null
  if (
    goalType === 'investment' &&
    mrs != null &&
    mrs <= 0 &&
    input.goal?.targetAmount != null &&
    input.goal?.targetDate != null
  ) {
    const monthsLeft = monthsBetween(new Date(), new Date(input.goal.targetDate))
    if (monthsLeft > 0) {
      fundedAtPlan = true
      planRatePct = INVESTMENT_DEFAULT_RATE_PCT
      const band = requiredMonthlyBand({
        targetAmount: input.goal.targetAmount,
        currentAmount: input.goal.currentAmount ?? 0,
        months: monthsLeft,
      })
      const conservative = band.reduce(
        (min, b) => (b.ratePct < min.ratePct ? b : min),
        band[0],
      )
      if (conservative) {
        stressRatePct = conservative.ratePct
        stressMonthly = conservative.monthly != null ? Math.round(conservative.monthly) : null
        stressCovered = stressMonthly != null ? freeCash >= stressMonthly : null
      }
    }
  }

  return {
    income: input.income,
    totalFixedCosts: input.totalFixedCosts,
    freeCash,
    goalName: input.goal?.name ?? null,
    goalTargetAmount: input.goal?.targetAmount ?? null,
    goalCurrentAmount: input.goal?.currentAmount ?? null,
    goalTargetDate: input.goal?.targetDate ?? null,
    goalType,
    monthlyRequiredSaving: mrs,
    percentOfIncome,
    unallocated,
    fundedAtPlan,
    planRatePct,
    stressRatePct,
    stressMonthly,
    stressCovered,
    currency: input.currency,
  }
}

/**
 * Server-computed DECLARED → ACTUAL delta for the declared_upgrade Read: the
 * snapshot taken when the declared Read composed (no transactions existed, so
 * its reconciled fixed costs held only profile rent + user-declared bills) set
 * against the fresh reconciled facts after the upload. Both sides and the
 * signed differences are computed HERE so the model cites every figure
 * verbatim and never derives either side of the delta itself (Rule 2).
 */
/**
 * One named band in the declared→actual reconciliation. Both sides and the
 * signed difference are computed HERE so the Read can name the miss without
 * doing arithmetic (Rule 2).
 */
export interface BandMiss {
  label: string
  declared: number
  observed: number
  /** observed − declared, whole units. Negative = they over-estimated. */
  diff: number
  /** Which way the miss cuts, from the user's point of view. */
  direction: 'overestimated' | 'underestimated'
}

export interface DeclaredActualDelta {
  /** BEFORE — what the declared Read stood on. */
  declaredFixedCosts: number
  declaredFreeCash: number
  /** AFTER — the reconciled picture at upgrade time. */
  actualFixedCosts: number | null
  actualFreeCash: number | null
  /** Signed differences (actual − declared), whole units; null when the actual side is missing. */
  fixedCostsDiff: number | null
  freeCashDiff: number | null
  /**
   * Per-bill misses the statements settled, biggest first. Only bills the user
   * declared AND the statements matched appear here — those are the only ones
   * with two comparable sides.
   */
  bands: BandMiss[]
  /** Declared bills the statements could NOT find — still estimates. */
  unverified: string[]
  /** Committed costs the statements found that the user never declared. */
  undeclared: string[]
  currency: string
}

/** A miss smaller than this is noise, not a finding — don't spend a sentence on it. */
const BAND_MISS_FLOOR = 5

/**
 * Reconcile the user's declared bills against what the statements actually
 * show, per band. Pure over the reconciled item list so it is unit-testable and
 * the Read never derives either side.
 */
export function buildBandReconciliation(items: ReconciledBill[]): Pick<
  DeclaredActualDelta,
  'bands' | 'unverified' | 'undeclared'
> {
  const live = items.filter((b) => !b.superseded)
  const bands: BandMiss[] = []
  const unverified: string[] = []
  const undeclared: string[] = []

  for (const b of live) {
    if (b.source === 'declared') {
      if (b.observed_monthly_equivalent == null) {
        // Declared, but nothing in the statements matched it — still an estimate.
        unverified.push(b.label)
        continue
      }
      const diff = Math.round(b.observed_monthly_equivalent - b.monthly_equivalent)
      if (Math.abs(diff) < BAND_MISS_FLOOR) continue
      bands.push({
        label: b.label,
        declared: Math.round(b.monthly_equivalent),
        observed: Math.round(b.observed_monthly_equivalent),
        diff,
        direction: diff < 0 ? 'overestimated' : 'underestimated',
      })
    } else if (b.source === 'detected') {
      // Found in the statements, never mentioned by the user.
      undeclared.push(b.label)
    }
    // source === 'rent' is the profile's housing line, not a declared bill —
    // it has no estimate/observation pair, so it belongs in neither list.
  }

  bands.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
  return { bands, unverified, undeclared }
}

export function buildDeclaredDelta(
  declared: Pick<DeclaredReadFacts, 'totalFixedCosts' | 'freeCash' | 'currency'>,
  actual: Pick<FinancialFacts, 'total_fixed_costs' | 'free_cash_flow'>,
  reconciledItems: ReconciledBill[] = [],
): DeclaredActualDelta | null {
  const actualFixedCosts = actual.total_fixed_costs ?? null
  const actualFreeCash = actual.free_cash_flow ?? null
  if (actualFixedCosts == null && actualFreeCash == null) return null
  return {
    declaredFixedCosts: declared.totalFixedCosts,
    declaredFreeCash: declared.freeCash,
    actualFixedCosts,
    actualFreeCash,
    fixedCostsDiff:
      actualFixedCosts != null ? Math.round(actualFixedCosts - declared.totalFixedCosts) : null,
    freeCashDiff: actualFreeCash != null ? Math.round(actualFreeCash - declared.freeCash) : null,
    ...buildBandReconciliation(reconciledItems),
    currency: declared.currency,
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
      ? {
          name: goalRow.name,
          monthlyRequiredSaving: goalRow.monthly_required_saving,
          targetAmount: goalRow.target_amount,
          currentAmount: goalRow.current_amount,
          targetDate: goalRow.target_date,
          type: goalRow.type,
        }
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

  // Usage accounting — same first_read_compose bucket as the transaction
  // composes; the mode in metadata distinguishes them.
  void trackLLMUsage({
    userId,
    callType: 'first_read_compose',
    model: COMPOSE_MODEL,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    metadata: {
      mode: 'declared',
      ...experimentStamp(hashPrompt(FIRST_READ_SYSTEM_PROMPT_DECLARED)),
    },
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

  // declaredFacts rides along so the post-upload route can snapshot it into
  // conversation metadata — the upgrade Read's DECLARED side of the delta.
  return { composedMessage: result.text.trim(), metadata, declaredFacts };
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
  dataWindowEnd?: string | null,
): Promise<number> {
  // Count within the same data-anchored window the Read is composed from, so the
  // cited transaction total reflects the upload even when it's stale (a today-
  // anchored count returned ~0 for older statements and the Read undercounted).
  const since = windowStartISO(windowDays, dataWindowEnd);
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
