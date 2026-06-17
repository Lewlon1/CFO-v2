'use server'

// OB-2 — estimates-first onboarding server actions. One action (or one
// progressive save) per beat, mirroring the value-first actions' shape.
// Persistence is progressive (CLAUDE.md pitfall #3): every confirmed value is
// written as it lands, never batched to a final submit.
//
// Step advancement: actions that complete a beat with no intermediate UI both
// persist AND advance the step. Beats with an intermediate screen (the door
// reflection, the income pace) persist here and call advanceStep() from the
// client once the screen is acknowledged.

import { createClient } from '@/lib/supabase/server'
import type { OnboardingStep } from '@/lib/onboarding-v2/types'
import { classifyDoor } from '@/lib/onboarding-v2/door/classify-door'
import {
  DOOR_CONFIG,
  DOOR_FAMILIES,
  familyToStruggle,
  struggleToFamily,
  type DoorFamily,
} from '@/lib/onboarding-v2/door/door-config'
import {
  COMPOSITE_PERSONAS,
  type CompositeCountry,
  type RelateOptionId,
} from '@/lib/onboarding-v2/composite/composite-config'
import {
  ALT_GOALS,
  DEADLINE_OPTIONS,
  GOAL_CONFIG,
  GOAL_DEFAULT_CURRENT_AMOUNT,
  type DeadlineOption,
} from '@/lib/onboarding-v2/goal-config'
import {
  HOUSING_BANDS,
  SUBS_BANDS,
  BILLS_BANDS,
  FOOD_OUT_BANDS,
  SAVE_REACH_BANDS,
} from '@/lib/onboarding-v2/estimates/bands'
import { round10 } from '@/lib/onboarding-v2/estimates/derive'
import { resolveUserCurrency } from '@/lib/analytics/resolve-user-currency'
import { targetDateFromDuration, monthsBetween } from '@/lib/goals/pace'

// ── Shared helpers ───────────────────────────────────────────────────────────

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  return { supabase, userId: user.id }
}

/** Estimate-flow context only offers UK/ES; anything else defaults to GB. */
function toCountry(raw: string | null | undefined): CompositeCountry {
  return raw === 'ES' ? 'ES' : 'GB'
}

// ── Name ─────────────────────────────────────────────────────────────────────

/** Persist the display name (door beat collects it first). No step change. */
export async function saveName(name: string): Promise<void> {
  const trimmed = name.trim()
  if (trimmed.length === 0) return
  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('user_profiles')
    .update({ display_name: trimmed.slice(0, 80) })
    .eq('id', userId)
  if (error) {
    console.error('[estimate-actions] saveName failed', error)
    throw new Error('Failed to save name')
  }
}

// ── Door ─────────────────────────────────────────────────────────────────────

export type DoorSubmitResult =
  | { status: 'classified'; reflection: string }
  | { status: 'needs_chip' }

/**
 * Free-text door. Saves name + raw text, classifies, and — on a confident
 * classification — persists the door (source 'llm') and returns the reflection.
 * Low confidence / parse failure / timeout returns needs_chip; the beat then
 * offers the four situation chips. Does NOT advance the step — the beat shows
 * the reflection, then advances on the user's continue.
 */
export async function submitDoorFreeText(input: {
  displayName: string | null
  freeText: string
}): Promise<DoorSubmitResult> {
  const { supabase, userId } = await requireUser()
  const freeText = input.freeText.trim()

  const baseUpdate: Record<string, unknown> = {
    entry_struggle_text: freeText.slice(0, 2000),
    entry_struggle_at: new Date().toISOString(),
  }
  if (input.displayName && input.displayName.trim()) {
    baseUpdate.display_name = input.displayName.trim().slice(0, 80)
  }
  const { error: baseErr } = await supabase
    .from('user_profiles')
    .update(baseUpdate)
    .eq('id', userId)
  if (baseErr) {
    console.error('[estimate-actions] submitDoorFreeText base update failed', baseErr)
    throw new Error('Failed to save your answer')
  }

  const result = await classifyDoor(freeText)
  if (result.status === 'fallback') {
    return { status: 'needs_chip' }
  }

  // Stamp the door step so a refresh after classification (but before the user
  // taps through the reflection) keeps them on the door beat, where the
  // persisted door_reflection re-shows — rather than the resolver advancing
  // straight past it to the context beat.
  const { error } = await supabase
    .from('user_profiles')
    .update({
      door_family: result.family,
      door_confidence: result.confidence,
      door_reflection: result.reflection,
      door_source: 'llm',
      entry_struggle: familyToStruggle(result.family),
      onboarding_step: 'estimate_door' satisfies OnboardingStep,
    })
    .eq('id', userId)
  if (error) {
    console.error('[estimate-actions] submitDoorFreeText persist failed', error)
    throw new Error('Failed to save door')
  }
  return { status: 'classified', reflection: result.reflection }
}

/** Chip door (direct tap, or the closest-fit fallback after low-confidence
 *  free text). Persists the door (source 'chip', deterministic reflection).
 *  Does NOT advance the step. */
export async function submitDoorChip(input: {
  displayName: string | null
  family: DoorFamily
}): Promise<{ reflection: string }> {
  if (!DOOR_FAMILIES.includes(input.family)) {
    throw new Error('Invalid door family')
  }
  const { supabase, userId } = await requireUser()
  const reflection = DOOR_CONFIG[input.family].fallbackReflection

  const update: Record<string, unknown> = {
    door_family: input.family,
    door_confidence: null,
    door_reflection: reflection,
    door_source: 'chip',
    entry_struggle: familyToStruggle(input.family),
    entry_struggle_at: new Date().toISOString(),
    onboarding_step: 'estimate_door' satisfies OnboardingStep,
  }
  if (input.displayName && input.displayName.trim()) {
    update.display_name = input.displayName.trim().slice(0, 80)
  }
  const { error } = await supabase.from('user_profiles').update(update).eq('id', userId)
  if (error) {
    console.error('[estimate-actions] submitDoorChip failed', error)
    throw new Error('Failed to save door')
  }
  return { reflection }
}

// ── Context ──────────────────────────────────────────────────────────────────

/** Country + age band. Sets the currency for the whole flow. Advances to the
 *  composite beat. */
export async function saveContextAndAdvance(input: {
  country: CompositeCountry
  ageRange: string
}): Promise<void> {
  const { supabase, userId } = await requireUser()
  const country = toCountry(input.country)
  const currency = resolveUserCurrency(country, null, [])

  const { error: profileErr } = await supabase
    .from('user_profiles')
    .update({
      country,
      age_range: input.ageRange.slice(0, 40),
      primary_currency: currency,
    })
    .eq('id', userId)
  if (profileErr) {
    console.error('[estimate-actions] saveContext profile failed', profileErr)
    throw new Error('Failed to save context')
  }

  await upsertEstimates(supabase, userId, { currency })
  await advance(supabase, userId, 'estimate_composite')
}

// ── Composite ────────────────────────────────────────────────────────────────

/** Persist the composite reaction + (optional) re-pick + truer line, and the
 *  persona key that was shown. Advances to the goal beat. */
export async function saveCompositeAndAdvance(input: {
  relate: RelateOptionId
  /** family the persona card was drawn from (door family, or re-pick). */
  personaFamily: DoorFamily
  /** set only on a not_me re-pick. */
  repickFamily?: DoorFamily | null
  truerLine?: string | null
}): Promise<void> {
  if (
    !DOOR_FAMILIES.includes(input.personaFamily) ||
    (input.repickFamily != null && !DOOR_FAMILIES.includes(input.repickFamily))
  ) {
    throw new Error('Invalid composite family')
  }
  const { supabase, userId } = await requireUser()
  const country = toCountry(await getCountry(supabase, userId))
  const personaKey = COMPOSITE_PERSONAS[input.personaFamily][country].key

  const { error } = await supabase
    .from('user_profiles')
    .update({
      composite_relate: input.relate,
      composite_persona_key: personaKey,
      composite_repick_family: input.repickFamily ?? null,
      composite_truer_line: input.truerLine?.trim()?.slice(0, 500) || null,
    })
    .eq('id', userId)
  if (error) {
    console.error('[estimate-actions] saveComposite failed', error)
    throw new Error('Failed to save composite')
  }
  await advance(supabase, userId, 'estimate_goal')
}

// ── Goal ─────────────────────────────────────────────────────────────────────

/** Create the goal from pinned config (inferred family, or an alt-goal pick),
 *  with the chosen deadline. Advances to the income beat. */
export async function createEstimateGoalAndAdvance(input: {
  deadlineId: DeadlineOption['id']
  /** set only when the user picks a different goal via the escape hatch. */
  altFamily?: DoorFamily | null
}): Promise<void> {
  const { supabase, userId } = await requireUser()

  // Idempotent: if an active goal already exists (a retry, or a legacy user who
  // already has one), don't create a duplicate — just advance.
  const { data: existingGoal } = await supabase
    .from('goals')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()
  if (existingGoal) {
    await advance(supabase, userId, 'estimate_income')
    return
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('country, primary_currency, door_family, composite_repick_family, entry_struggle')
    .eq('id', userId)
    .maybeSingle()

  const country = toCountry(profile?.country)
  const currency = resolveUserCurrency(country, profile?.primary_currency ?? null, [])

  // Effective family: an explicit alt-goal pick wins, then the composite
  // re-pick, then the door family, then the legacy struggle, then growth.
  const family: DoorFamily =
    (input.altFamily && DOOR_FAMILIES.includes(input.altFamily) ? input.altFamily : null) ??
    (profile?.composite_repick_family as DoorFamily | null) ??
    (profile?.door_family as DoorFamily | null) ??
    struggleToFamily(profile?.entry_struggle ?? null) ??
    'growth'

  const cfg = GOAL_CONFIG[family]
  const alt = input.altFamily ? ALT_GOALS.find((a) => a.family === input.altFamily) : null
  const goalNoun = alt?.goalNoun ?? cfg.goalNoun
  const target = (alt?.defaultTarget ?? cfg.defaultTarget)[country]

  const deadline =
    DEADLINE_OPTIONS.find((d) => d.id === input.deadlineId) ??
    DEADLINE_OPTIONS[DEADLINE_OPTIONS.length - 1]
  const targetDate =
    deadline.months != null
      ? targetDateFromDuration({ durationMonths: deadline.months })
      : null
  const monthsLeft =
    targetDate != null ? Math.max(0, monthsBetween(new Date(), new Date(targetDate))) : 0
  const monthlyRequired =
    monthsLeft > 0 ? Math.round((target - GOAL_DEFAULT_CURRENT_AMOUNT) / monthsLeft) : null

  const { error } = await supabase.from('goals').insert({
    user_id: userId,
    name: goalNoun,
    target_amount: target,
    current_amount: GOAL_DEFAULT_CURRENT_AMOUNT,
    target_date: targetDate,
    monthly_required_saving: monthlyRequired,
    on_track: null,
    priority: 'medium',
    type: 'savings',
    status: 'active',
    currency,
  })
  if (error) {
    console.error('[estimate-actions] createEstimateGoal failed', error)
    throw new Error('Failed to create goal')
  }
  await advance(supabase, userId, 'estimate_income')
}

// ── Income ───────────────────────────────────────────────────────────────────

/** v1 steep-pace threshold (mirrors STEEP_PCT_THRESHOLD in estimates/derive.ts —
 *  the income pace preview must agree with the final Read's derive()). */
const STEEP_PCT_THRESHOLD = 50
const INCOME_MIN = 500
const INCOME_MAX = 50000

export type IncomePace = {
  requiredMonthly: number
  requiredPctOfIncome: number
  paceVerdict: 'steep' | 'doable'
} | null

/** Persist income (estimates + user_profiles) and return the goal pace preview.
 *  No step change — the beat shows the pace, then advances on continue. */
export async function saveIncome(input: { income: number }): Promise<IncomePace> {
  const income = Math.round(input.income)
  if (!Number.isFinite(income) || income < INCOME_MIN || income > INCOME_MAX) {
    throw new Error('Income out of range')
  }
  const { supabase, userId } = await requireUser()

  await supabase.from('user_profiles').update({ net_monthly_income: income }).eq('id', userId)
  await upsertEstimates(supabase, userId, { income_monthly: income })

  const { data: goal } = await supabase
    .from('goals')
    .select('target_amount, current_amount, target_date')
    .eq('user_id', userId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (goal?.target_amount == null || goal.target_date == null) return null
  const monthsLeft = Math.max(0, monthsBetween(new Date(), new Date(goal.target_date)))
  if (monthsLeft <= 0) return null

  const remaining = Math.max(0, goal.target_amount - (goal.current_amount ?? 0))
  const requiredMonthly = round10(remaining / monthsLeft)
  const requiredPctOfIncome = Math.round((requiredMonthly / income) * 100)
  return {
    requiredMonthly,
    requiredPctOfIncome,
    paceVerdict: requiredPctOfIncome > STEEP_PCT_THRESHOLD ? 'steep' : 'doable',
  }
}

// ── Sketch (progressive, one band per call) ──────────────────────────────────

export type SketchBandKey = 'housing' | 'subs' | 'bills' | 'foodOut' | 'saveReach'

const BAND_COLUMN: Record<SketchBandKey, string> = {
  housing: 'housing_band',
  subs: 'subs_band',
  bills: 'bills_band',
  foodOut: 'food_out_band',
  saveReach: 'save_reach_band',
}

const BAND_VALID: Record<SketchBandKey, ReadonlySet<string>> = {
  housing: new Set(Object.keys(HOUSING_BANDS)),
  subs: new Set(Object.keys(SUBS_BANDS)),
  bills: new Set(Object.keys(BILLS_BANDS)),
  foodOut: new Set(Object.keys(FOOD_OUT_BANDS)),
  saveReach: new Set(Object.keys(SAVE_REACH_BANDS)),
}

/** Persist one sketch band. Progressive — no step change; the beat advances
 *  once all five are tapped. */
export async function saveSketchBand(input: {
  band: SketchBandKey
  value: string
}): Promise<void> {
  if (!BAND_VALID[input.band]?.has(input.value)) {
    throw new Error(`Invalid band value for ${input.band}`)
  }
  const { supabase, userId } = await requireUser()
  await upsertEstimates(supabase, userId, { [BAND_COLUMN[input.band]]: input.value })
}

// ── Verdicts ─────────────────────────────────────────────────────────────────

export type EstimateVerdictValue = 'worth_it' | 'leak' | 'unsure'
const VERDICT_VALUES: ReadonlySet<string> = new Set(['worth_it', 'leak', 'unsure'])

/** Persist the top value + the three domain verdicts, then advance to the Read. */
export async function saveVerdictsAndAdvance(input: {
  topValue: string
  verdicts: {
    subscriptions: EstimateVerdictValue
    foodOut: EstimateVerdictValue
    drift: EstimateVerdictValue
  }
}): Promise<void> {
  const { subscriptions, foodOut, drift } = input.verdicts
  for (const v of [subscriptions, foodOut, drift]) {
    if (!VERDICT_VALUES.has(v)) throw new Error('Invalid verdict')
  }
  const { supabase, userId } = await requireUser()
  await upsertEstimates(supabase, userId, {
    top_value: input.topValue.slice(0, 60),
    verdicts: { subscriptions, food_out: foodOut, drift },
  })
  await advance(supabase, userId, 'estimate_read_pending')
}

// ── Low-level ────────────────────────────────────────────────────────────────

type SupabaseLike = Awaited<ReturnType<typeof requireUser>>['supabase']

async function upsertEstimates(
  supabase: SupabaseLike,
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('onboarding_estimates')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
  if (error) {
    console.error('[estimate-actions] upsertEstimates failed', error)
    throw new Error('Failed to save estimate')
  }
}

async function getCountry(supabase: SupabaseLike, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('user_profiles')
    .select('country')
    .eq('id', userId)
    .maybeSingle()
  return (data?.country as string | null) ?? null
}

async function advance(
  supabase: SupabaseLike,
  userId: string,
  next: OnboardingStep,
): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .update({ onboarding_step: next })
    .eq('id', userId)
  if (error) {
    console.error('[estimate-actions] advance failed', { next, error })
    throw new Error('Failed to advance step')
  }
}
