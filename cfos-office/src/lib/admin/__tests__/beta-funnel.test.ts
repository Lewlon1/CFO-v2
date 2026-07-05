import { describe, expect, it } from 'vitest'
import {
  STAGE_LABELS,
  STEP_ORDINALS,
  stageForProfile,
  stageFromEvents,
  resolveFirstPath,
  buildFunnelCounts,
  buildUserJourneys,
  computeConversionPanel,
  computeUpgradeRate,
  findStuckUsers,
  type FunnelEvent,
  type UserJourney,
  type UserJourneyInput,
} from '../beta-funnel'

const ALL_ONBOARDING_STEPS = [
  'intro_shown',
  'goal_chat_started',
  'goal_chat_tentative',
  'goal_set',
  'goal_skipped',
  'essentials_done',
  'upload_pending',
  'upload_processing',
  'details_pending',
  'details_confirmed',
  'value_map_started',
  'value_map_done',
  'upload_done',
  'archetype_shown',
  'first_read_shown',
  'first_read_delivered',
  'value_map_offered',
  'complete',
] as const

describe('STEP_ORDINALS exhaustiveness', () => {
  it('has exactly one entry per OnboardingStep member, 18 total', () => {
    expect(Object.keys(STEP_ORDINALS).sort()).toEqual([...ALL_ONBOARDING_STEPS].sort())
    expect(Object.keys(STEP_ORDINALS)).toHaveLength(18)
  })

  it('stageForProfile returns a sane ordinal (0-6) for every step, never throwing/undefined', () => {
    for (const step of ALL_ONBOARDING_STEPS) {
      const stage = stageForProfile({ onboarding_step: step, onboarding_completed_at: null })
      expect(stage).not.toBeUndefined()
      expect(Number.isNaN(stage)).toBe(false)
      expect(stage).toBeGreaterThanOrEqual(0)
      expect(stage).toBeLessThanOrEqual(6)
    }
  })
})

describe('stageForProfile', () => {
  it('returns 0 when onboarding_step is null', () => {
    expect(stageForProfile({ onboarding_step: null, onboarding_completed_at: null })).toBe(0)
  })

  it('returns 7 when onboarding_completed_at is set, regardless of step', () => {
    expect(
      stageForProfile({ onboarding_step: 'intro_shown', onboarding_completed_at: '2026-01-01T00:00:00Z' }),
    ).toBe(7)
    expect(stageForProfile({ onboarding_step: null, onboarding_completed_at: '2026-01-01T00:00:00Z' })).toBe(7)
  })

  it('falls back to 0 for an unrecognized step string', () => {
    expect(stageForProfile({ onboarding_step: 'some_future_step', onboarding_completed_at: null })).toBe(0)
  })

  it('maps a known step to its expected ordinal', () => {
    expect(stageForProfile({ onboarding_step: 'details_confirmed', onboarding_completed_at: null })).toBe(5)
  })
})

describe('stageFromEvents', () => {
  it('returns 0 for empty events', () => {
    expect(stageFromEvents([])).toBe(0)
  })

  it('returns the ordinal for a single step_transition event', () => {
    const events: FunnelEvent[] = [
      { event_type: 'step_transition', payload: { to_step: 'details_confirmed' }, created_at: '2026-01-01T00:00:00Z' },
    ]
    expect(stageFromEvents(events)).toBe(5)
  })

  it('returns 7 for onboarding_completed even if other events suggest a lower stage', () => {
    const events: FunnelEvent[] = [
      { event_type: 'step_transition', payload: { to_step: 'goal_set' }, created_at: '2026-01-01T00:00:00Z' },
      { event_type: 'onboarding_completed', payload: {}, created_at: '2026-01-02T00:00:00Z' },
    ]
    expect(stageFromEvents(events)).toBe(7)
  })

  it('takes the MAX across multiple step_transition events, not the last', () => {
    const events: FunnelEvent[] = [
      { event_type: 'step_transition', payload: { to_step: 'details_confirmed' }, created_at: '2026-01-01T00:00:00Z' },
      { event_type: 'step_transition', payload: { to_step: 'goal_set' }, created_at: '2026-01-02T00:00:00Z' },
    ]
    expect(stageFromEvents(events)).toBe(5)
  })

  it('ignores non-decisive event types and malformed payloads', () => {
    const events: FunnelEvent[] = [
      { event_type: 'struggle_submitted', payload: { to_step: 'complete' }, created_at: '2026-01-01T00:00:00Z' },
      { event_type: 'step_transition', payload: null, created_at: '2026-01-02T00:00:00Z' },
      { event_type: 'step_transition', payload: { to_step: 123 }, created_at: '2026-01-03T00:00:00Z' },
    ]
    expect(stageFromEvents(events)).toBe(0)
  })
})

describe('resolveFirstPath', () => {
  it('read_composed mode value_first -> upload', () => {
    const events: FunnelEvent[] = [
      { event_type: 'read_composed', payload: { mode: 'value_first' }, created_at: '2026-01-01T00:00:00Z' },
    ]
    expect(resolveFirstPath({ events, hasUpgradeMarker: false, hasTransactions: false })).toBe('upload')
  })

  it('read_composed mode declared -> declared', () => {
    const events: FunnelEvent[] = [
      { event_type: 'read_composed', payload: { mode: 'declared' }, created_at: '2026-01-01T00:00:00Z' },
    ]
    expect(resolveFirstPath({ events, hasUpgradeMarker: false, hasTransactions: false })).toBe('declared')
  })

  it('read_composed mode default alone falls through to unknown', () => {
    const events: FunnelEvent[] = [
      { event_type: 'read_composed', payload: { mode: 'default' }, created_at: '2026-01-01T00:00:00Z' },
    ]
    expect(resolveFirstPath({ events, hasUpgradeMarker: false, hasTransactions: false })).toBe('unknown')
  })

  it('upload_skipped with no read_composed -> declared', () => {
    const events: FunnelEvent[] = [
      { event_type: 'upload_skipped', payload: {}, created_at: '2026-01-01T00:00:00Z' },
    ]
    expect(resolveFirstPath({ events, hasUpgradeMarker: false, hasTransactions: false })).toBe('declared')
  })

  it('statements_imported -> upload', () => {
    const events: FunnelEvent[] = [
      { event_type: 'statements_imported', payload: {}, created_at: '2026-01-01T00:00:00Z' },
    ]
    expect(resolveFirstPath({ events, hasUpgradeMarker: false, hasTransactions: false })).toBe('upload')
  })

  it('hasUpgradeMarker true with no matching events -> declared', () => {
    expect(resolveFirstPath({ events: [], hasUpgradeMarker: true, hasTransactions: false })).toBe('declared')
  })

  it('hasTransactions true with no other signals -> upload', () => {
    expect(resolveFirstPath({ events: [], hasUpgradeMarker: false, hasTransactions: true })).toBe('upload')
  })

  it('nothing at all -> unknown', () => {
    expect(resolveFirstPath({ events: [], hasUpgradeMarker: false, hasTransactions: false })).toBe('unknown')
  })

  it('priority: decisive read_composed wins even if upload_skipped is also present', () => {
    const events: FunnelEvent[] = [
      { event_type: 'upload_skipped', payload: {}, created_at: '2026-01-01T00:00:00Z' },
      { event_type: 'read_composed', payload: { mode: 'value_first' }, created_at: '2026-01-02T00:00:00Z' },
    ]
    expect(resolveFirstPath({ events, hasUpgradeMarker: false, hasTransactions: false })).toBe('upload')
  })

  it('sorts by created_at and uses the EARLIER decisive read_composed, not the later differing event', () => {
    // Events supplied out of insertion order to prove the sort is real.
    const events: FunnelEvent[] = [
      { event_type: 'declared_upgrade_done', payload: {}, created_at: '2026-01-03T00:00:00Z' },
      { event_type: 'read_composed', payload: { mode: 'value_first' }, created_at: '2026-01-05T00:00:00Z' },
      { event_type: 'read_composed', payload: { mode: 'declared' }, created_at: '2026-01-01T00:00:00Z' },
    ]
    // Earliest decisive read_composed (2026-01-01) has mode 'declared'.
    expect(resolveFirstPath({ events, hasUpgradeMarker: false, hasTransactions: false })).toBe('declared')
  })
})

describe('buildFunnelCounts', () => {
  it('produces monotonically non-increasing reached counts and correct pctOfPrevious', () => {
    const users = [{ stage: 0 }, { stage: 2 }, { stage: 2 }, { stage: 5 }, { stage: 7 }]
    const counts = buildFunnelCounts(users)
    expect(counts).toHaveLength(8)
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i].reached).toBeLessThanOrEqual(counts[i - 1].reached)
    }
    // stage 0: all 5 reached. stage 1: those >=1 -> 3 (2,2,5,7 stages... wait compute directly)
    expect(counts[0].reached).toBe(5) // all users have stage >= 0
    expect(counts[0].pctOfPrevious).toBeNull()
    expect(counts[7].reached).toBe(1) // only the stage-7 user
  })

  it('yields null pctOfPrevious when the previous stage reached count is 0', () => {
    const users: Array<{ stage: number }> = []
    const counts = buildFunnelCounts(users)
    expect(counts[0].reached).toBe(0)
    expect(counts[1].reached).toBe(0)
    expect(counts[1].pctOfPrevious).toBeNull()
  })
})

describe('buildUserJourneys', () => {
  function baseInput(overrides: Partial<UserJourneyInput> = {}): UserJourneyInput {
    return {
      id: 'u1',
      email: 'u1@example.com',
      displayName: 'User One',
      createdAt: '2026-01-01T00:00:00Z',
      onboardingStep: 'goal_set',
      onboardingCompletedAt: null,
      entryStruggle: 'debt',
      onboardingRoute: 'value_first',
      events: [],
      hasTransactions: false,
      hasUpgradeMarker: false,
      lastMessageAt: null,
      ...overrides,
    }
  }

  it('derives stage, firstPath, uploaded, skippedUpload, upgraded, lastSeenAt, timeline correctly', () => {
    const events: FunnelEvent[] = [
      { event_type: 'statements_imported', payload: {}, created_at: '2026-01-02T00:00:00Z' },
      { event_type: 'step_transition', payload: { to_step: 'details_confirmed' }, created_at: '2026-01-03T00:00:00Z' },
    ]
    const input = baseInput({ events, hasTransactions: true, lastMessageAt: '2026-01-02T12:00:00Z' })
    const [journey] = buildUserJourneys([input])

    expect(journey.stage).toBe(5) // from stageFromEvents (details_confirmed)
    expect(journey.stageLabel).toBe(STAGE_LABELS[5])
    expect(journey.firstPath).toBe('upload')
    expect(journey.uploaded).toBe(true)
    expect(journey.skippedUpload).toBe(false)
    expect(journey.upgraded).toBe(false)
    // last event at 2026-01-03, lastMessageAt at 2026-01-02T12:00 -> event wins
    expect(journey.lastSeenAt).toBe('2026-01-03T00:00:00Z')
    expect(journey.timeline.map((e) => e.eventType)).toEqual(['statements_imported', 'step_transition'])
  })

  it('lastSeenAt picks lastMessageAt when it is later than the last event', () => {
    const events: FunnelEvent[] = [{ event_type: 'upload_skipped', payload: {}, created_at: '2026-01-01T00:00:00Z' }]
    const input = baseInput({ events, lastMessageAt: '2026-01-05T00:00:00Z' })
    const [journey] = buildUserJourneys([input])
    expect(journey.lastSeenAt).toBe('2026-01-05T00:00:00Z')
    expect(journey.skippedUpload).toBe(true)
    expect(journey.firstPath).toBe('declared')
  })

  it('lastSeenAt picks the last event when it is later than lastMessageAt', () => {
    const events: FunnelEvent[] = [{ event_type: 'upload_skipped', payload: {}, created_at: '2026-01-10T00:00:00Z' }]
    const input = baseInput({ events, lastMessageAt: '2026-01-05T00:00:00Z' })
    const [journey] = buildUserJourneys([input])
    expect(journey.lastSeenAt).toBe('2026-01-10T00:00:00Z')
  })

  it('lastSeenAt is null when there are no events and no lastMessageAt', () => {
    const [journey] = buildUserJourneys([baseInput({ events: [], lastMessageAt: null })])
    expect(journey.lastSeenAt).toBeNull()
  })

  it('timeline is sorted ascending by created_at regardless of input order', () => {
    const events: FunnelEvent[] = [
      { event_type: 'b', payload: {}, created_at: '2026-01-03T00:00:00Z' },
      { event_type: 'a', payload: {}, created_at: '2026-01-01T00:00:00Z' },
      { event_type: 'c', payload: {}, created_at: '2026-01-02T00:00:00Z' },
    ]
    const [journey] = buildUserJourneys([baseInput({ events })])
    expect(journey.timeline.map((e) => e.eventType)).toEqual(['a', 'c', 'b'])
  })

  it('upgraded is true from declared_upgrade_done event even without hasUpgradeMarker', () => {
    const events: FunnelEvent[] = [{ event_type: 'declared_upgrade_done', payload: {}, created_at: '2026-01-01T00:00:00Z' }]
    const [journey] = buildUserJourneys([baseInput({ events, hasUpgradeMarker: false })])
    expect(journey.upgraded).toBe(true)
  })
})

describe('computeConversionPanel', () => {
  function journeyWithCompletion(id: string, completedAt: string, firstPath: UserJourney['firstPath']): UserJourney {
    return {
      id,
      email: `${id}@example.com`,
      displayName: null,
      createdAt: '2026-01-01T00:00:00Z',
      stage: 7,
      stageLabel: 'Completed',
      firstPath,
      entryStruggle: null,
      onboardingRoute: null,
      completedAt,
      uploaded: firstPath === 'upload',
      skippedUpload: firstPath === 'declared',
      upgraded: false,
      lastSeenAt: completedAt,
      timeline: [],
    }
  }

  it('a user who returns on exactly 1 distinct day after completion does not count toward returned2PlusCount', () => {
    const completedAt = '2026-01-01T00:00:00Z'
    const journeys = [journeyWithCompletion('u1', completedAt, 'upload')]
    const activityDays = new Map([['u1', ['2026-01-02']]])
    const [all] = computeConversionPanel(journeys, activityDays, new Date('2026-03-01T00:00:00Z'))
    expect(all.returned2PlusCount).toBe(0)
  })

  it('a user who returns on 2 distinct days DOES count', () => {
    const completedAt = '2026-01-01T00:00:00Z'
    const journeys = [journeyWithCompletion('u1', completedAt, 'upload')]
    const activityDays = new Map([['u1', ['2026-01-02', '2026-01-03']]])
    const [all] = computeConversionPanel(journeys, activityDays, new Date('2026-03-01T00:00:00Z'))
    expect(all.returned2PlusCount).toBe(1)
  })

  it('activity on the same UTC day as completion does not count as a return day', () => {
    const completedAt = '2026-01-01T08:00:00Z'
    const journeys = [journeyWithCompletion('u1', completedAt, 'upload')]
    // Same day as completion + one real return day -> only 1 distinct qualifying day, not 2
    const activityDays = new Map([['u1', ['2026-01-01', '2026-01-02']]])
    const [all] = computeConversionPanel(journeys, activityDays, new Date('2026-03-01T00:00:00Z'))
    expect(all.returned2PlusCount).toBe(0)
  })

  it('activity exactly at the 7-day boundary day is excluded (window is < day+7)', () => {
    const completedAt = '2026-01-01T00:00:00Z' // week1End = 2026-01-08
    const journeys = [journeyWithCompletion('u1', completedAt, 'upload')]
    const activityDays = new Map([['u1', ['2026-01-02', '2026-01-08']]])
    const [all] = computeConversionPanel(journeys, activityDays, new Date('2026-03-01T00:00:00Z'))
    // 2026-01-08 excluded (boundary), so only 1 qualifying return day -> not >= 2
    expect(all.returned2PlusCount).toBe(0)
  })

  it('week-2 eligibility gating excludes users whose week-2 window has not fully elapsed', () => {
    const completedAt = '2026-01-01T00:00:00Z' // week2End = 2026-01-15
    const journeys = [journeyWithCompletion('u1', completedAt, 'upload')]
    const activityDays = new Map([['u1', ['2026-01-08']]])
    // now is before week2End (2026-01-15) -> not eligible at all
    const now = new Date('2026-01-10T00:00:00Z')
    const [all] = computeConversionPanel(journeys, activityDays, now)
    expect(all.weeklyActiveWeek2EligibleCount).toBe(0)
    expect(all.weeklyActiveWeek2Count).toBe(0)
  })

  it('week-2 eligibility includes users once the window has elapsed, and counts activity within it', () => {
    const completedAt = '2026-01-01T00:00:00Z' // week2: [01-08, 01-15)
    const journeys = [journeyWithCompletion('u1', completedAt, 'upload')]
    const activityDays = new Map([['u1', ['2026-01-10']]])
    const now = new Date('2026-01-20T00:00:00Z') // window has elapsed
    const [all] = computeConversionPanel(journeys, activityDays, now)
    expect(all.weeklyActiveWeek2EligibleCount).toBe(1)
    expect(all.weeklyActiveWeek2Count).toBe(1)
  })

  it('week-3 eligibility and activity window behave analogously to week-2', () => {
    const completedAt = '2026-01-01T00:00:00Z' // week3: [01-15, 01-22)
    const journeys = [journeyWithCompletion('u1', completedAt, 'upload')]
    const activityDays = new Map([['u1', ['2026-01-16']]])
    const now = new Date('2026-01-25T00:00:00Z')
    const [all] = computeConversionPanel(journeys, activityDays, now)
    expect(all.weeklyActiveWeek3EligibleCount).toBe(1)
    expect(all.weeklyActiveWeek3Count).toBe(1)
  })

  it('cohort filtering: upload/declared cohorts only include matching firstPath; all includes everyone', () => {
    const journeys: UserJourney[] = [
      journeyWithCompletion('u1', '2026-01-01T00:00:00Z', 'upload'),
      journeyWithCompletion('u2', '2026-01-01T00:00:00Z', 'declared'),
      journeyWithCompletion('u3', '2026-01-01T00:00:00Z', 'unknown'),
    ]
    const activityDays = new Map<string, string[]>()
    const now = new Date('2026-03-01T00:00:00Z')
    const [all, upload, declared] = computeConversionPanel(journeys, activityDays, now)
    expect(all.totalUsers).toBe(3)
    expect(upload.totalUsers).toBe(1)
    expect(declared.totalUsers).toBe(1)
    expect(upload.cohort).toBe('upload')
    expect(declared.cohort).toBe('declared')
  })

  it('completedPct and uploadedOrUpgradedPct are null when totalUsers is 0', () => {
    const [, upload] = computeConversionPanel([], new Map(), new Date('2026-01-01T00:00:00Z'))
    expect(upload.totalUsers).toBe(0)
    expect(upload.completedPct).toBeNull()
    expect(upload.uploadedOrUpgradedPct).toBeNull()
  })
})

describe('computeUpgradeRate', () => {
  function journey(id: string, firstPath: UserJourney['firstPath'], upgraded: boolean): UserJourney {
    return {
      id,
      email: `${id}@example.com`,
      displayName: null,
      createdAt: '2026-01-01T00:00:00Z',
      stage: 7,
      stageLabel: 'Completed',
      firstPath,
      entryStruggle: null,
      onboardingRoute: null,
      completedAt: '2026-01-01T00:00:00Z',
      uploaded: firstPath === 'upload',
      skippedUpload: false,
      upgraded,
      lastSeenAt: null,
      timeline: [],
    }
  }

  it('only counts declared-path users in the denominator', () => {
    const journeys = [
      journey('u1', 'declared', true),
      journey('u2', 'upload', true),
      journey('u3', 'unknown', true),
    ]
    const result = computeUpgradeRate(journeys)
    expect(result.declaredCount).toBe(1)
  })

  it('a declared-path user who has not upgraded does not count in the numerator', () => {
    const journeys = [journey('u1', 'declared', false)]
    const result = computeUpgradeRate(journeys)
    expect(result.declaredCount).toBe(1)
    expect(result.upgradedCount).toBe(0)
    expect(result.ratePct).toBe(0)
  })

  it('an upload-path user flagged upgraded does not affect this metric (declared-only denominator)', () => {
    const journeys = [journey('u1', 'declared', true), journey('u2', 'upload', true)]
    const result = computeUpgradeRate(journeys)
    expect(result.declaredCount).toBe(1)
    expect(result.upgradedCount).toBe(1)
    expect(result.ratePct).toBe(1)
  })

  it('ratePct is null when there are no declared-path users', () => {
    const result = computeUpgradeRate([journey('u1', 'upload', true)])
    expect(result.declaredCount).toBe(0)
    expect(result.ratePct).toBeNull()
  })
})

describe('findStuckUsers', () => {
  function journey(overrides: Partial<UserJourney> = {}): UserJourney {
    return {
      id: 'u1',
      email: 'u1@example.com',
      displayName: null,
      createdAt: '2026-01-01T00:00:00Z',
      stage: 3,
      stageLabel: 'Upload done or skipped',
      firstPath: 'upload',
      entryStruggle: null,
      onboardingRoute: null,
      completedAt: null,
      uploaded: true,
      skippedUpload: false,
      upgraded: false,
      lastSeenAt: '2026-01-01T00:00:00Z',
      timeline: [],
      ...overrides,
    }
  }

  it('never includes a completed user regardless of staleness', () => {
    const now = new Date('2026-06-01T00:00:00Z')
    const journeys = [journey({ completedAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-01-01T00:00:00Z' })]
    expect(findStuckUsers(journeys, now)).toHaveLength(0)
  })

  it('includes a user last seen 25 hours ago with correct hoursStuck', () => {
    const now = new Date('2026-01-02T01:00:00Z') // lastSeenAt 2026-01-01T00:00:00Z -> 25h
    const journeys = [journey({ lastSeenAt: '2026-01-01T00:00:00Z' })]
    const stuck = findStuckUsers(journeys, now)
    expect(stuck).toHaveLength(1)
    expect(stuck[0].hoursStuck).toBeCloseTo(25, 5)
  })

  it('does not include a user last seen 23 hours ago', () => {
    const now = new Date('2026-01-01T23:00:00Z')
    const journeys = [journey({ lastSeenAt: '2026-01-01T00:00:00Z' })]
    expect(findStuckUsers(journeys, now)).toHaveLength(0)
  })

  it('lastError picks the MOST RECENT onboarding_error when there are multiple', () => {
    const now = new Date('2026-01-05T00:00:00Z')
    const journeys = [
      journey({
        lastSeenAt: '2026-01-01T00:00:00Z',
        timeline: [
          { eventType: 'onboarding_error', createdAt: '2026-01-01T00:00:00Z', payload: { message: 'first' } },
          { eventType: 'step_transition', createdAt: '2026-01-01T01:00:00Z', payload: null },
          { eventType: 'onboarding_error', createdAt: '2026-01-01T02:00:00Z', payload: { message: 'second' } },
        ],
      }),
    ]
    const [stuck] = findStuckUsers(journeys, now)
    expect(stuck.lastError?.payload).toEqual({ message: 'second' })
  })

  it('a user with no onboarding_error events gets lastError null', () => {
    const now = new Date('2026-01-05T00:00:00Z')
    const journeys = [journey({ lastSeenAt: '2026-01-01T00:00:00Z', timeline: [] })]
    const [stuck] = findStuckUsers(journeys, now)
    expect(stuck.lastError).toBeNull()
  })

  it('falls back to createdAt when lastSeenAt is null', () => {
    const now = new Date('2026-01-05T00:00:00Z')
    const journeys = [journey({ lastSeenAt: null, createdAt: '2026-01-01T00:00:00Z' })]
    const [stuck] = findStuckUsers(journeys, now)
    expect(stuck.hoursStuck).toBeCloseTo(96, 5)
  })

  it('sorts results most-stuck-first', () => {
    const now = new Date('2026-01-10T00:00:00Z')
    const journeys = [
      journey({ id: 'a', lastSeenAt: '2026-01-08T00:00:00Z' }), // 48h
      journey({ id: 'b', lastSeenAt: '2026-01-01T00:00:00Z' }), // 216h
      journey({ id: 'c', lastSeenAt: '2026-01-09T00:00:00Z' }), // 24h -> not included (not > 24)
    ]
    const stuck = findStuckUsers(journeys, now)
    expect(stuck.map((j) => j.id)).toEqual(['b', 'a'])
  })
})
