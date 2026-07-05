// Pure, DB-free aggregation for the friends-and-family beta onboarding-funnel
// dashboard (/admin/beta, built in a later task). This module takes
// already-fetched rows (profiles, events, transaction/upgrade flags) and
// computes: funnel drop-off by stage, per-user journeys, upload-vs-declared
// path attribution, conversion/retention metrics, and stuck users.
//
// Deliberately has NO Supabase import and NO I/O — everything here is a
// synchronous function of its inputs, which is what makes it unit-testable
// without mocking a database. The dashboard page owns all fetching; this
// module owns all math.

import type { OnboardingStep } from '@/lib/onboarding-v2/types'

// ---------------------------------------------------------------------------
// 1. Stage ordinals
// ---------------------------------------------------------------------------

/**
 * The 8 stages of the value-first onboarding flow (ordinal 0-7). Legacy /
 * Marcus-era steps are folded to their nearest value-first equivalent — see
 * STEP_ORDINALS below for the exact mapping. Stage 7 ("Completed") is not a
 * step value at all; it's derived from `onboarding_completed_at` being set,
 * and overrides everything else.
 */
export const STAGE_LABELS: readonly string[] = [
  'Signed up',
  'Struggle / goal-chat entered',
  'Goal resolved',
  'Upload done or skipped',
  'Essentials',
  'Confirm',
  'Read delivered',
  'Completed',
] as const

/**
 * Maps every OnboardingStep to its funnel-stage ordinal (0-6; stage 7 is
 * derived separately from onboarding_completed_at, not from a step).
 *
 * `satisfies Record<OnboardingStep, number>` gives a compile error the
 * moment OnboardingStep gains a member this map doesn't cover — keep it,
 * don't loosen it to `Record<string, number>`.
 */
export const STEP_ORDINALS = {
  intro_shown: 0,
  goal_chat_started: 1,
  goal_chat_tentative: 1,
  goal_set: 2,
  goal_skipped: 2,
  upload_pending: 2,
  value_map_started: 2,
  upload_processing: 3,
  essentials_done: 3,
  value_map_done: 3,
  details_pending: 4,
  details_confirmed: 5,
  upload_done: 5,
  archetype_shown: 6,
  first_read_shown: 6,
  first_read_delivered: 6,
  value_map_offered: 6,
  complete: 6,
} satisfies Record<OnboardingStep, number>

/**
 * Legacy onboarding_step values that predate the current OnboardingStep union
 * (i.e. from removed code paths) but still exist on real profile rows.
 * `reality_check_delivered` is from an earlier onboarding mechanism (a
 * "reality-check Read" that predates the current value-first flow) — mapped
 * to the same stage as first_read_delivered/first_read_shown since it's the
 * same "a Read was delivered" milestone under a different, now-removed name.
 * Add new entries here (never to STEP_ORDINALS) if a future audit finds more
 * legacy values — STEP_ORDINALS must stay exhaustive over the CURRENT
 * OnboardingStep union only.
 */
const LEGACY_STEP_ORDINALS: Record<string, number> = {
  reality_check_delivered: 6,
}

/**
 * Resolves a profile's funnel stage from the DB's own onboarding_step
 * column. `onboarding_completed_at` set overrides everything → stage 7.
 * Checks current STEP_ORDINALS first, then LEGACY_STEP_ORDINALS (for step
 * values from removed onboarding mechanisms that still exist on real rows).
 * Unrecognised/null step strings defensively fall back to stage 0 rather
 * than throwing, since DB data isn't statically guaranteed to match
 * OnboardingStep.
 */
export function stageForProfile(profile: {
  onboarding_step: string | null
  onboarding_completed_at: string | null
}): number {
  if (profile.onboarding_completed_at) return 7
  if (!profile.onboarding_step) return 0
  const ordinals = STEP_ORDINALS as Record<string, number>
  return ordinals[profile.onboarding_step] ?? LEGACY_STEP_ORDINALS[profile.onboarding_step] ?? 0
}

// ---------------------------------------------------------------------------
// 2. Stage from events (funnel resilience)
// ---------------------------------------------------------------------------

export type FunnelEvent = {
  event_type: string
  payload: Record<string, unknown> | null
  created_at: string
}

/**
 * Derives the furthest funnel stage reached from the event stream alone.
 * Only `onboarding_completed` (→ 7, wins immediately) and `step_transition`
 * (→ max of every `to_step` ordinal) affect stage — other funnel events
 * matter for path attribution / flags elsewhere in this module, not stage,
 * since step_transition events already transitively capture every step
 * change.
 */
export function stageFromEvents(events: FunnelEvent[]): number {
  let max = 0
  for (const e of events) {
    if (e.event_type === 'onboarding_completed') return 7
    if (e.event_type === 'step_transition') {
      const toStep = e.payload?.to_step
      if (typeof toStep === 'string') {
        const ord = (STEP_ORDINALS as Record<string, number>)[toStep] ?? LEGACY_STEP_ORDINALS[toStep]
        if (ord !== undefined) max = Math.max(max, ord)
      }
    }
  }
  return max
}

// ---------------------------------------------------------------------------
// 3. First-path resolution (upload-first vs. declared-first)
// ---------------------------------------------------------------------------

export type FirstPath = 'upload' | 'declared' | 'unknown'

/**
 * Resolves whether a user's first path through onboarding was "upload real
 * statements" or "declared/estimated numbers". Priority order (highest
 * first) is deliberate and must not be reordered:
 *
 *   1. The mode their first Read actually composed in — the authoritative
 *      signal. Only 'value_first' and 'declared' are decisive; a 'default'
 *      mode (e.g. legacy archetype path) doesn't tell us which path they
 *      took, so it falls through to priority 2.
 *   2. Intent events for users who dropped before a Read composed.
 *   3. Pre-instrumentation fallback (events predate this feature, or the
 *      event insert failed) using the upgrade marker / transaction count
 *      fetched by the caller.
 */
export function resolveFirstPath(input: {
  events: FunnelEvent[]
  hasUpgradeMarker: boolean
  hasTransactions: boolean
}): FirstPath {
  const sorted = [...input.events].sort((a, b) => a.created_at.localeCompare(b.created_at))

  // Priority 1: first decisive read_composed mode, in chronological order.
  const firstDecisiveCompose = sorted.find(
    (e) => e.event_type === 'read_composed' && (e.payload?.mode === 'value_first' || e.payload?.mode === 'declared'),
  )
  if (firstDecisiveCompose) {
    return firstDecisiveCompose.payload?.mode === 'value_first' ? 'upload' : 'declared'
  }

  // Priority 2: intent events at the upload beat.
  if (sorted.some((e) => e.event_type === 'upload_skipped')) return 'declared'
  if (sorted.some((e) => e.event_type === 'statements_imported' || e.event_type === 'upload_completed')) return 'upload'

  // Priority 3: pre-instrumentation fallback.
  if (input.hasUpgradeMarker) return 'declared' // upgrading FROM declared implies they started declared
  if (input.hasTransactions) return 'upload'

  return 'unknown'
}

// ---------------------------------------------------------------------------
// 4. Funnel counts
// ---------------------------------------------------------------------------

export type FunnelStageCounts = Array<{
  stage: string
  ordinal: number
  reached: number
  pctOfPrevious: number | null
}>

/**
 * Builds the funnel drop-off table for a given set of users. Deliberately
 * has NO cohort parameter — callers (the dashboard page) invoke this once
 * per cohort (all / upload-first / declared-first) by pre-filtering the
 * input array. Keep this function simple.
 */
export function buildFunnelCounts(usersWithStage: Array<{ stage: number }>): FunnelStageCounts {
  const counts = STAGE_LABELS.map((label, ordinal) => ({
    stage: label,
    ordinal,
    reached: usersWithStage.filter((u) => u.stage >= ordinal).length,
    pctOfPrevious: null as number | null,
  }))
  for (let i = 1; i < counts.length; i++) {
    counts[i].pctOfPrevious = counts[i - 1].reached > 0 ? counts[i].reached / counts[i - 1].reached : null
  }
  return counts
}

// ---------------------------------------------------------------------------
// 5. User journeys
// ---------------------------------------------------------------------------

export type UserJourneyInput = {
  id: string
  email: string
  displayName: string | null
  createdAt: string
  onboardingStep: string | null
  onboardingCompletedAt: string | null
  entryStruggle: string | null
  onboardingRoute: string | null
  events: FunnelEvent[]
  hasTransactions: boolean
  hasUpgradeMarker: boolean
  lastMessageAt: string | null
}

export type UserJourney = {
  id: string
  email: string
  displayName: string | null
  createdAt: string
  stage: number
  stageLabel: string
  firstPath: FirstPath
  entryStruggle: string | null
  onboardingRoute: string | null
  completedAt: string | null
  uploaded: boolean
  skippedUpload: boolean
  upgraded: boolean
  lastSeenAt: string | null
  timeline: Array<{ eventType: string; createdAt: string; payload: Record<string, unknown> | null }>
}

export function buildUserJourneys(inputs: UserJourneyInput[]): UserJourney[] {
  return inputs.map((input) => {
    const stage = Math.max(
      stageForProfile({ onboarding_step: input.onboardingStep, onboarding_completed_at: input.onboardingCompletedAt }),
      stageFromEvents(input.events),
    )
    const firstPath = resolveFirstPath({
      events: input.events,
      hasUpgradeMarker: input.hasUpgradeMarker,
      hasTransactions: input.hasTransactions,
    })

    let lastEventAt: string | null = null
    for (const e of input.events) {
      if (!lastEventAt || e.created_at > lastEventAt) lastEventAt = e.created_at
    }
    const candidates = [lastEventAt, input.lastMessageAt].filter((v): v is string => Boolean(v))
    const lastSeenAt = candidates.length > 0 ? candidates.sort().at(-1)! : null

    return {
      id: input.id,
      email: input.email,
      displayName: input.displayName,
      createdAt: input.createdAt,
      stage,
      stageLabel: STAGE_LABELS[stage],
      firstPath,
      entryStruggle: input.entryStruggle,
      onboardingRoute: input.onboardingRoute,
      completedAt: input.onboardingCompletedAt,
      uploaded:
        input.hasTransactions ||
        input.events.some((e) => e.event_type === 'statements_imported' || e.event_type === 'upload_completed'),
      skippedUpload: input.events.some((e) => e.event_type === 'upload_skipped'),
      upgraded: input.hasUpgradeMarker || input.events.some((e) => e.event_type === 'declared_upgrade_done'),
      lastSeenAt,
      timeline: [...input.events]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((e) => ({ eventType: e.event_type, createdAt: e.created_at, payload: e.payload })),
    }
  })
}

// ---------------------------------------------------------------------------
// 6. Conversion panel
// ---------------------------------------------------------------------------

export type ConversionMetrics = {
  cohort: 'all' | 'upload' | 'declared'
  totalUsers: number
  completedCount: number
  completedPct: number | null
  returned2PlusCount: number
  returned2PlusPct: number | null
  uploadedOrUpgradedCount: number
  uploadedOrUpgradedPct: number | null
  weeklyActiveWeek2Count: number
  weeklyActiveWeek2EligibleCount: number
  weeklyActiveWeek2Pct: number | null
  weeklyActiveWeek3Count: number
  weeklyActiveWeek3EligibleCount: number
  weeklyActiveWeek3Pct: number | null
}

function utcDayString(d: Date): string {
  return d.toISOString().slice(0, 10) // 'YYYY-MM-DD'
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000)
}

/**
 * Computes conversion/retention metrics for three cohorts: 'all', 'upload'
 * (firstPath === 'upload'), 'declared' (firstPath === 'declared').
 * 'unknown'-path users are included in 'all' only.
 *
 * `activityDaysByUser` maps userId -> distinct UTC calendar-day strings
 * ('YYYY-MM-DD') on which the user had any activity. The caller decides how
 * to build this (session_started events preferred, falling back to any
 * event/message timestamp) — this function just consumes it.
 *
 * `now` defaults to `new Date()` but is injectable, which is what makes the
 * week-2/week-3 eligibility windowing testable without depending on the
 * real wall clock.
 */
export function computeConversionPanel(
  journeys: UserJourney[],
  activityDaysByUser: Map<string, string[]>,
  now: Date = new Date(),
): ConversionMetrics[] {
  const cohorts: Array<'all' | 'upload' | 'declared'> = ['all', 'upload', 'declared']
  return cohorts.map((cohort) => {
    const users = cohort === 'all' ? journeys : journeys.filter((j) => j.firstPath === cohort)
    const totalUsers = users.length
    const completed = users.filter((u) => u.completedAt)
    const completedCount = completed.length

    let returned2PlusCount = 0
    let weeklyActiveWeek2Count = 0
    let weeklyActiveWeek2EligibleCount = 0
    let weeklyActiveWeek3Count = 0
    let weeklyActiveWeek3EligibleCount = 0

    for (const u of completed) {
      const completedAt = new Date(u.completedAt as string)
      const days = activityDaysByUser.get(u.id) ?? []
      const completedDay = utcDayString(completedAt)

      // Distinct UTC days with activity strictly after the completion day,
      // within 7 days of completion. Same-day-as-completion never counts.
      const week1End = addDays(completedAt, 7)
      const returnDays = new Set(days.filter((d) => d > completedDay && d < utcDayString(week1End)))
      if (returnDays.size >= 2) returned2PlusCount++

      // Week 2 window: [completedAt+7d, completedAt+14d). Only eligible
      // (counted in the denominator) once that whole window has elapsed.
      const week2Start = addDays(completedAt, 7)
      const week2End = addDays(completedAt, 14)
      if (now >= week2End) {
        weeklyActiveWeek2EligibleCount++
        const active = days.some((d) => d >= utcDayString(week2Start) && d < utcDayString(week2End))
        if (active) weeklyActiveWeek2Count++
      }

      // Week 3 window: [completedAt+14d, completedAt+21d).
      const week3Start = addDays(completedAt, 14)
      const week3End = addDays(completedAt, 21)
      if (now >= week3End) {
        weeklyActiveWeek3EligibleCount++
        const active = days.some((d) => d >= utcDayString(week3Start) && d < utcDayString(week3End))
        if (active) weeklyActiveWeek3Count++
      }
    }

    const uploadedOrUpgraded = users.filter((u) => u.uploaded || u.upgraded).length

    return {
      cohort,
      totalUsers,
      completedCount,
      completedPct: totalUsers > 0 ? completedCount / totalUsers : null,
      returned2PlusCount,
      returned2PlusPct: completedCount > 0 ? returned2PlusCount / completedCount : null,
      uploadedOrUpgradedCount: uploadedOrUpgraded,
      uploadedOrUpgradedPct: totalUsers > 0 ? uploadedOrUpgraded / totalUsers : null,
      weeklyActiveWeek2Count,
      weeklyActiveWeek2EligibleCount,
      weeklyActiveWeek2Pct: weeklyActiveWeek2EligibleCount > 0 ? weeklyActiveWeek2Count / weeklyActiveWeek2EligibleCount : null,
      weeklyActiveWeek3Count,
      weeklyActiveWeek3EligibleCount,
      weeklyActiveWeek3Pct: weeklyActiveWeek3EligibleCount > 0 ? weeklyActiveWeek3Count / weeklyActiveWeek3EligibleCount : null,
    }
  })
}

// ---------------------------------------------------------------------------
// 7. Declared -> actual upgrade rate
// ---------------------------------------------------------------------------

export type UpgradeRate = { declaredCount: number; upgradedCount: number; ratePct: number | null }

/**
 * A distinct, explicitly-requested metric — NOT folded into the 3-cohort
 * conversion table above. Denominator is declared-path users only; an
 * upload-path user flagged `upgraded` (shouldn't normally happen) has no
 * effect on this metric either way.
 */
export function computeUpgradeRate(journeys: UserJourney[]): UpgradeRate {
  const declared = journeys.filter((j) => j.firstPath === 'declared')
  const upgraded = declared.filter((j) => j.upgraded)
  return {
    declaredCount: declared.length,
    upgradedCount: upgraded.length,
    ratePct: declared.length > 0 ? upgraded.length / declared.length : null,
  }
}

// ---------------------------------------------------------------------------
// 8. Stuck users
// ---------------------------------------------------------------------------

const STUCK_THRESHOLD_HOURS = 24

export type StuckUser = UserJourney & {
  hoursStuck: number
  lastError: { eventType: string; createdAt: string; payload: Record<string, unknown> | null } | null
}

/**
 * Users who haven't completed onboarding and haven't been seen in over
 * STUCK_THRESHOLD_HOURS. Sorted most-stuck-first. `now` is injectable for
 * testability, same rationale as computeConversionPanel.
 */
export function findStuckUsers(journeys: UserJourney[], now: Date = new Date()): StuckUser[] {
  return journeys
    .filter((j) => !j.completedAt)
    .map((j) => {
      const lastSeen = j.lastSeenAt ? new Date(j.lastSeenAt) : new Date(j.createdAt)
      const hoursStuck = (now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60)
      const lastError = [...j.timeline].reverse().find((e) => e.eventType === 'onboarding_error') ?? null
      return { ...j, hoursStuck, lastError }
    })
    .filter((j) => j.hoursStuck > STUCK_THRESHOLD_HOURS)
    .sort((a, b) => b.hoursStuck - a.hoursStuck)
}
