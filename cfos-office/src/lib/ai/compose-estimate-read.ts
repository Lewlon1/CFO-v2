/**
 * Estimate Read composition (OB-2).
 *
 * A sibling of compose-first-read.ts, deliberately separate: the first Read
 * fetches a transaction stack (behavioural clusters, levers, hooks, spending
 * breakdown) that does not exist for an estimate-only user. This composer
 * stands entirely on the deterministic derive() engine plus the user's own
 * verdicts and the knows-you score — "the LLM interprets, the system computes".
 *
 * The model writes from pre-computed context with no tool calls. Every figure
 * it is handed is ≈-prefixed (except stated income); inventing a merchant, date,
 * or transaction is the hard failure the prompt guards against.
 */

import { generateText } from 'ai'
import type { SupabaseClient } from '@supabase/supabase-js'

import { bedrock, chatModelId } from '@/lib/ai/provider'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveUserCurrency } from '@/lib/analytics/resolve-user-currency'
import { monthsBetween } from '@/lib/goals/pace'
import {
  deriveEstimates,
  type DerivedEstimates,
} from '@/lib/onboarding-v2/estimates/derive'
import type {
  EstimateBands,
  HousingBandId,
  SubsBandId,
  BillsBandId,
  FoodOutBandId,
  SaveReachBandId,
} from '@/lib/onboarding-v2/estimates/bands'
import { knowsYou, type KnowsYouSignals } from '@/lib/onboarding-v2/knows-you'
import { struggleToFamily } from '@/lib/onboarding-v2/door/door-config'
import {
  ESTIMATE_READ_SYSTEM_PROMPT,
  buildEstimateReadUserPrompt,
  type EstimateReadComposeInput,
  type EstimateReadComposeOutput,
  type EstimateVerdict,
} from './prompts/estimate-read'
import type { FirstReadMetadata } from './prompts/first-read'

const MAX_OUTPUT_TOKENS = 700
const COMPOSE_MODEL = process.env.BEDROCK_COMPOSE_MODEL || chatModelId

/** The completion target the knows-you close line promises checking will pass. */
const STATEMENT_CHECK_FLOOR = 70

type EstimatesRow = {
  currency: string | null
  housing_band: string | null
  subs_band: string | null
  bills_band: string | null
  food_out_band: string | null
  save_reach_band: string | null
  income_monthly: number | null
  top_value: string | null
  verdicts: Record<string, unknown> | null
  derived: unknown
}

type ProfileRow = {
  display_name: string | null
  country: string | null
  primary_currency: string | null
  age_range: string | null
  door_family: string | null
  entry_struggle: string | null
  composite_relate: string | null
  composite_truer_line: string | null
}

type GoalRow = {
  name: string
  target_amount: number | null
  current_amount: number | null
  target_date: string | null
}

/**
 * Compose the estimate Read for a user sitting at estimate_read_pending.
 * Self-contained: loads the estimates row, the profile facts, and the active
 * goal; runs derive() (persisting it to onboarding_estimates.derived if not
 * already stored); computes the knows-you score; and generates the Read.
 */
export async function composeEstimateRead(params: {
  userId: string
  supabase?: SupabaseClient
}): Promise<EstimateReadComposeOutput> {
  const supabase = params.supabase ?? createServiceClient()
  const { userId } = params

  const [estimatesRes, profileRes, goalRes] = await Promise.all([
    supabase
      .from('onboarding_estimates')
      .select(
        'currency, housing_band, subs_band, bills_band, food_out_band, save_reach_band, income_monthly, top_value, verdicts, derived',
      )
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('user_profiles')
      .select(
        'display_name, country, primary_currency, age_range, door_family, entry_struggle, composite_relate, composite_truer_line',
      )
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('goals')
      .select('name, target_amount, current_amount, target_date')
      .eq('user_id', userId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const estimates = estimatesRes.data as EstimatesRow | null
  const profile = profileRes.data as ProfileRow | null
  const goal = goalRes.data as GoalRow | null

  if (!estimates) {
    throw new Error('composeEstimateRead: no onboarding_estimates row')
  }

  const bands = toBands(estimates)
  if (!bands) {
    throw new Error('composeEstimateRead: incomplete band sketch — cannot derive')
  }
  if (estimates.income_monthly == null || estimates.income_monthly <= 0) {
    throw new Error('composeEstimateRead: income not on file — cannot derive')
  }

  const currency = resolveUserCurrency(
    profile?.country ?? null,
    estimates.currency ?? profile?.primary_currency ?? null,
    [],
  )

  // Goal pace for derive(). monthsToDeadline is null without a target date —
  // derive() then leaves the pace fields null and the prompt frames "direction".
  const monthsToDeadline =
    goal?.target_date != null
      ? Math.max(0, monthsBetween(new Date(), new Date(goal.target_date)))
      : null

  const derived: DerivedEstimates = deriveEstimates({
    income: estimates.income_monthly,
    bands,
    goal:
      goal?.target_amount != null
        ? {
            targetAmount: goal.target_amount,
            currentAmount: goal.current_amount ?? 0,
            monthsToDeadline,
          }
        : null,
  })

  // Persist derive() output if it isn't already stored. Idempotent — a retry of
  // the estimate-read route re-derives the same numbers (pure engine) and the
  // write only matters the first time.
  if (estimates.derived == null) {
    const { error } = await supabase
      .from('onboarding_estimates')
      .update({ derived })
      .eq('user_id', userId)
    if (error) {
      console.error('[compose-estimate-read] persist derived failed:', error)
      // Non-fatal: the Read can still compose from the in-memory derivation.
    }
  }

  // Knows-you score, computed from actual data presence so the meter (rendered
  // from the same pure function) and this Read always agree.
  const verdictsObj = (estimates.verdicts ?? {}) as Record<string, unknown>
  const signals: KnowsYouSignals = {
    hasName: !!profile?.display_name,
    hasDoor:
      profile?.door_family != null ||
      struggleToFamily(profile?.entry_struggle ?? null) != null,
    hasContext: profile?.age_range != null,
    hasCompositeRelate: profile?.composite_relate != null,
    hasGoal: goal != null,
    hasIncome: estimates.income_monthly != null,
    sketchBandsCount: 5,
    hasTopValue: estimates.top_value != null,
    verdictsCount: Object.keys(verdictsObj).length,
    statementChecked: false,
    valueMapDone: false,
  }
  const knows = knowsYou(signals)
  const knowsYouLine =
    `Right now, I know you about ${knows.pct}%. ` +
    `Checking a real month is what takes that past ${STATEMENT_CHECK_FLOOR}%.`

  const composeInput: EstimateReadComposeInput = {
    currency,
    goal: goal?.target_amount != null
      ? {
          noun: goal.name,
          targetAmount: goal.target_amount,
          deadlineLabel: deadlineLabel(goal.target_date),
        }
      : null,
    derived,
    verdicts: {
      subscriptions: asVerdict(verdictsObj.subscriptions),
      foodOut: asVerdict(verdictsObj.food_out),
      drift: asVerdict(verdictsObj.drift),
    },
    topValue: estimates.top_value,
    truerLine: profile?.composite_truer_line ?? null,
    knowsYouLine,
  }

  const userPrompt = buildEstimateReadUserPrompt(composeInput)

  const result = await generateText({
    model: bedrock(COMPOSE_MODEL),
    system: ESTIMATE_READ_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: 0.5,
    abortSignal: AbortSignal.timeout(20_000),
  })

  const composedMessage = result.text.trim()

  const metadata: FirstReadMetadata = {
    layers_used: ['L1'],
    features_cited: [],
    gap_present: false,
    clusters_referenced: [],
    levers_offered: [derived.actionBranch],
    blocker_field: null,
    mode: 'estimate_first',
    breakdown_cited: false,
    knows_you_pct: knows.pct,
    estimate_action_branch: derived.actionBranch,
  }

  return { composedMessage, metadata }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Map the text band columns to the typed EstimateBands, or null if any is
 *  missing or out of range (the derive engine needs all five). */
function toBands(row: EstimatesRow): EstimateBands | null {
  const housing = row.housing_band
  const subs = row.subs_band
  const bills = row.bills_band
  const foodOut = row.food_out_band
  const saveReach = row.save_reach_band
  if (!housing || !subs || !bills || !foodOut || !saveReach) return null
  if (!isHousing(housing) || !isSubs(subs) || !isBills(bills) || !isFoodOut(foodOut) || !isSaveReach(saveReach)) {
    return null
  }
  return { housing, subs, bills, foodOut, saveReach }
}

const isHousing = (v: string): v is HousingBandId => v === 'a' || v === 'b' || v === 'c' || v === 'd'
const isSubs = (v: string): v is SubsBandId => v === 'low' || v === 'mid' || v === 'high'
const isBills = (v: string): v is BillsBandId => v === 'a' || v === 'b' || v === 'c'
const isFoodOut = (v: string): v is FoodOutBandId => v === 'a' || v === 'b' || v === 'c'
const isSaveReach = (v: string): v is SaveReachBandId => v === 'a' || v === 'b' || v === 'c' || v === 'd'

function asVerdict(v: unknown): EstimateVerdict | null {
  return v === 'worth_it' || v === 'leak' || v === 'unsure' ? v : null
}

/** "by October 2028"-style label from an ISO target date, or null. */
function deadlineLabel(targetDate: string | null): string | null {
  if (!targetDate) return null
  const d = new Date(targetDate)
  if (Number.isNaN(d.getTime())) return null
  return `by ${d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`
}
