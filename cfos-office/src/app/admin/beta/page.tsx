// Beta funnel dashboard — the last piece of the onboarding-observability
// effort. Every prior task (event instrumentation, the pure beta-funnel.ts
// aggregation lib, the assert-admin guard) exists to feed this page: where
// beta users drop off, which path they take (upload real statements vs.
// declared/estimated numbers), and whether they come back.
//
// Mirrors /admin/wow's visual + structural conventions (StatCard/Th/Td local
// helpers, force-dynamic, assertAdmin, createServiceClient for cross-user
// reads) but does NOT share code with it — small enough to duplicate per
// this admin area's existing precedent.

import { adminEmails, assertAdmin } from '@/lib/admin/assert-admin'
import {
  buildFunnelCounts,
  buildUserJourneys,
  computeConversionPanel,
  computeUpgradeRate,
  findStuckUsers,
  type FunnelStageCounts,
  type StuckUser,
  type UserJourney,
  type UserJourneyInput,
} from '@/lib/admin/beta-funnel'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type EventRow = {
  profile_id: string
  event_type: string
  event_category: string
  payload: unknown
  created_at: string | null
}

export default async function AdminBetaPage() {
  await assertAdmin()
  const svc = createServiceClient()
  const adminEmailSet = new Set(adminEmails())

  const now = new Date()
  // Beyond 90 days, older activity drops out of this view entirely — a
  // long-tenured user who's gone quiet won't show any history past this
  // window. Acceptable for a beta-stage funnel view; revisit if the beta
  // runs long enough for that to start hiding real signal.
  const since90d = new Date(now.getTime() - 90 * 86_400_000).toISOString()
  // `messages` is by far the highest-volume table here (one row per chat
  // turn vs. discrete funnel milestones for events) and is only used for the
  // last-seen cross-check + activity-day fallback, which doesn't need more
  // than 30 days — keep its window narrower than user_events's 90 days.
  const since30d = new Date(now.getTime() - 30 * 86_400_000).toISOString()

  // 1. Profiles (non-anonymised only). Deliberately unbounded (no .limit()):
  // at this beta's scale (tens of users) a full scan is cheap, and a limit
  // would silently truncate the per-user journey list rather than degrade
  // gracefully.
  const { data: profileRows, error: profilesErr } = await svc
    .from('user_profiles')
    .select(
      'id, display_name, created_at, onboarding_step, onboarding_completed_at, onboarding_route, entry_struggle, anonymised_at',
    )
    .is('anonymised_at', null)
    .order('created_at', { ascending: false })

  if (profilesErr) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold mb-2">Beta Funnel</h1>
        <pre className="text-sm text-destructive">Query failed: {profilesErr.message}</pre>
      </div>
    )
  }

  const profiles = profileRows ?? []
  const profileIds = profiles.map((p) => p.id)

  // 2. Emails — auth.users has no counterpart in user_profiles, so use the
  // admin API, same pattern as /admin/wow.
  const { data: listResult } = await svc.auth.admin.listUsers({ perPage: 1000 })
  const emailByUserId = new Map<string, string>()
  for (const u of listResult?.users ?? []) {
    if (u.email) emailByUserId.set(u.id, u.email)
  }

  // 3. Events — the categories this observability effort writes to.
  // Deliberately unbounded (no .limit(), unlike /admin/wow's .limit(200)):
  // at this beta's scale (tens of users, 90-day window) row volume stays
  // low, and a limit here would silently drop events mid-window rather than
  // degrade a specific section gracefully.
  const { data: eventRows } = await svc
    .from('user_events')
    .select('profile_id, event_type, event_category, payload, created_at')
    .in('event_category', ['funnel', 'system', 'session', 'upload'])
    .gte('created_at', since90d)
    .order('created_at', { ascending: true })
  const events = (eventRows ?? []) as EventRow[]
  const eventsByProfile = new Map<string, EventRow[]>()
  for (const e of events) {
    const list = eventsByProfile.get(e.profile_id) ?? []
    list.push(e)
    eventsByProfile.set(e.profile_id, list)
  }

  // 4. Transactions — boolean "has uploaded real statements" per user.
  const { data: txnRows } =
    profileIds.length > 0
      ? await svc.from('transactions').select('user_id').in('user_id', profileIds)
      : { data: [] }
  const hasTxnSet = new Set((txnRows ?? []).map((r) => r.user_id))

  // 5. Declared -> actual upgrade marker.
  const { data: upgradeRows } =
    profileIds.length > 0
      ? await svc
          .from('conversations')
          .select('user_id')
          .eq('metadata->>value_first_upgraded', 'true')
          .in('user_id', profileIds)
      : { data: [] }
  const upgradedSet = new Set((upgradeRows ?? []).map((r) => r.user_id))

  // 6. Messages — last-seen cross-check + activity-day fallback source.
  // Narrower 30-day window (not since90d): messages is the highest-volume
  // table here (one row per chat turn), and this data only feeds a last-seen
  // check + activity-day fallback that doesn't need more than 30 days.
  const { data: messageRows } =
    profileIds.length > 0
      ? await svc
          .from('messages')
          .select('user_id, created_at')
          .in('user_id', profileIds)
          .gte('created_at', since30d)
      : { data: [] }
  const lastMessageAtByUser = new Map<string, string>()
  const messageDaysByUser = new Map<string, Set<string>>()
  for (const m of messageRows ?? []) {
    if (!m.user_id || !m.created_at) continue
    const prev = lastMessageAtByUser.get(m.user_id)
    if (!prev || m.created_at > prev) lastMessageAtByUser.set(m.user_id, m.created_at)
    const days = messageDaysByUser.get(m.user_id) ?? new Set<string>()
    days.add(m.created_at.slice(0, 10))
    messageDaysByUser.set(m.user_id, days)
  }

  // 7. Build activityDaysByUser: session_started event days preferred; fall
  // back to (event days + message days) for users with no session_started
  // events at all (pre-instrumentation users, or event insert failures).
  const activityDaysByUser = new Map<string, string[]>()
  for (const id of profileIds) {
    const userEvents = eventsByProfile.get(id) ?? []
    const sessionDays = Array.from(
      new Set(
        userEvents
          .filter((e) => e.event_type === 'session_started' && e.created_at)
          .map((e) => (e.created_at as string).slice(0, 10)),
      ),
    )
    if (sessionDays.length > 0) {
      activityDaysByUser.set(id, sessionDays)
    } else {
      const fallbackDays = new Set<string>()
      for (const e of userEvents) if (e.created_at) fallbackDays.add(e.created_at.slice(0, 10))
      for (const d of messageDaysByUser.get(id) ?? []) fallbackDays.add(d)
      activityDaysByUser.set(id, Array.from(fallbackDays))
    }
  }

  // 8. Assemble UserJourneyInput[] and run it through the pure lib.
  //
  // `payload` and `created_at` come back from Supabase typed as `Json` /
  // `string | null` respectively (generated types), while FunnelEvent expects
  // `Record<string, unknown> | null` / `string`. This is the same narrow-cast
  // pattern already used for jsonb columns elsewhere (e.g.
  // src/app/api/chat/route.ts, src/app/api/cron/wow-aggregate/route.ts) —
  // events with a null created_at (shouldn't happen; DB defaults it) are
  // dropped rather than coerced, so the pure lib's `string` contract holds.
  const journeyInputs: UserJourneyInput[] = profiles.map((p) => ({
    id: p.id,
    email: emailByUserId.get(p.id) ?? p.id,
    displayName: p.display_name,
    createdAt: p.created_at ?? new Date(0).toISOString(),
    onboardingStep: p.onboarding_step,
    onboardingCompletedAt: p.onboarding_completed_at,
    entryStruggle: p.entry_struggle,
    onboardingRoute: p.onboarding_route,
    events: (eventsByProfile.get(p.id) ?? [])
      .filter((e): e is EventRow & { created_at: string } => e.created_at != null)
      .map((e) => ({
        event_type: e.event_type,
        payload: e.payload as Record<string, unknown> | null,
        created_at: e.created_at,
      })),
    hasTransactions: hasTxnSet.has(p.id),
    hasUpgradeMarker: upgradedSet.has(p.id),
    lastMessageAt: lastMessageAtByUser.get(p.id) ?? null,
  }))
  const journeys = buildUserJourneys(journeyInputs)

  // 9. Exclude admin accounts from the dashboard's OWN funnel math (they'd
  // skew tiny beta numbers), but keep them in the raw `journeys` array for
  // the per-user list, where they're rendered greyed-out/flagged instead of
  // hidden.
  const nonAdminJourneys = journeys.filter((j) => !adminEmailSet.has(j.email.toLowerCase()))

  // 10. Run every aggregate through the pure lib.
  const allCounts = buildFunnelCounts(nonAdminJourneys)
  const uploadCounts = buildFunnelCounts(nonAdminJourneys.filter((j) => j.firstPath === 'upload'))
  const declaredCounts = buildFunnelCounts(nonAdminJourneys.filter((j) => j.firstPath === 'declared'))
  const unknownPathCount = nonAdminJourneys.filter((j) => j.firstPath === 'unknown').length
  const conversionByCohort = computeConversionPanel(nonAdminJourneys, activityDaysByUser, now)
  const upgradeRate = computeUpgradeRate(nonAdminJourneys)
  const stuckUsers = findStuckUsers(nonAdminJourneys, now)

  // 11. Recent errors — across ALL events (not journey-filtered), most
  // recent first.
  const recentErrors = events
    .filter((e) => e.event_type === 'onboarding_error' && e.created_at)
    .sort((a, b) => (b.created_at as string).localeCompare(a.created_at as string))
    .slice(0, 50)
    .map((e) => {
      const payload = e.payload as Record<string, unknown> | null
      return {
        email: emailByUserId.get(e.profile_id) ?? e.profile_id,
        createdAt: e.created_at as string,
        surface: (payload?.surface as string | undefined) ?? '—',
        message: (payload?.message as string | undefined) ?? '—',
        reason: (payload?.reason as string | undefined) ?? null,
      }
    })

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Beta Funnel</h1>
        <p className="text-sm text-muted-foreground mt-1">
          n={nonAdminJourneys.length} beta users · {unknownPathCount} with unresolved path
        </p>
      </header>

      {/* (a) Funnel table */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-3">Funnel</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FunnelTable title="All" counts={allCounts} />
          <FunnelTable title="Upload-first" counts={uploadCounts} />
          <FunnelTable title="Declared-first" counts={declaredCounts} />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Legacy Marcus-era onboarding steps are folded to the nearest value-first stage.{' '}
          {unknownPathCount} user{unknownPathCount === 1 ? '' : 's'} not yet resolved to a path (excluded
          from Upload-first / Declared-first, included in All).
        </p>
      </section>

      {/* (d) Conversion panel */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-3">Conversion &amp; retention</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {conversionByCohort.map((c) => (
            <ConversionCard key={c.cohort} metrics={c} />
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Declared → actual upgrade"
            value={fmtPct(upgradeRate.ratePct)}
            hint={`${upgradeRate.upgradedCount} of ${upgradeRate.declaredCount} declared-path users`}
          />
        </div>
      </section>

      {/* (c) Drop-off / stuck users */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-3">Stuck users</h2>
        {stuckUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one is currently stuck — nice.</p>
        ) : (
          <div className="overflow-x-auto border border-border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <Th>Email</Th>
                  <Th>Stage</Th>
                  <Th>Path</Th>
                  <Th>Hours stuck</Th>
                  <Th>Last error</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stuckUsers.map((u) => (
                  <StuckUserRow key={u.id} user={u} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* (b) Per-user journey list */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-3">Per-user journeys</h2>
        <div className="overflow-x-auto border border-border rounded-md">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <Th>User</Th>
                <Th>Signed up</Th>
                <Th>Route / struggle</Th>
                <Th>Path</Th>
                <Th>Stage</Th>
                <Th>Last seen</Th>
                <Th>Flags</Th>
                <Th>Completed</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {journeys.map((j) => (
                <JourneyRow key={j.id} journey={j} isAdmin={adminEmailSet.has(j.email.toLowerCase())} />
              ))}
              {journeys.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted-foreground">
                    No beta users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* (e) Recent errors */}
      <section>
        <h2 className="text-sm font-semibold mb-3">Recent errors</h2>
        {recentErrors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No onboarding errors in the last 90 days.</p>
        ) : (
          <div className="overflow-x-auto border border-border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <Th>When</Th>
                  <Th>User</Th>
                  <Th>Surface</Th>
                  <Th>Message</Th>
                  <Th>Reason</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentErrors.map((e, i) => (
                  <tr key={i} className="hover:bg-muted/30">
                    <Td>{fmtDateTime(e.createdAt)}</Td>
                    <Td>{e.email}</Td>
                    <Td>{e.surface}</Td>
                    <Td className="max-w-md truncate" title={e.message}>
                      {e.message}
                    </Td>
                    <Td>{e.reason ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// ── Section components ──────────────────────────────────────────────────

function FunnelTable({ title, counts }: { title: string; counts: FunnelStageCounts }) {
  return (
    <div className="overflow-x-auto border border-border rounded-md">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <Th colSpan={3}>
              <span className="font-semibold">{title}</span>
            </Th>
          </tr>
          <tr>
            <Th>Stage</Th>
            <Th>Reached</Th>
            <Th>% of prev.</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {counts.map((c) => (
            <tr key={c.ordinal} className="hover:bg-muted/30">
              <Td>{c.stage}</Td>
              <Td>{c.reached}</Td>
              <Td>{fmtPct(c.pctOfPrevious)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ConversionCard({
  metrics,
}: {
  metrics: ReturnType<typeof computeConversionPanel>[number]
}) {
  const cohortLabel = { all: 'All', upload: 'Upload-first', declared: 'Declared-first' }[metrics.cohort]
  return (
    <div className="border border-border rounded-md p-3 bg-card">
      <div className="text-xs font-semibold mb-2">{cohortLabel}</div>
      <dl className="space-y-1 text-xs">
        <ConversionRow label="Total users" value={metrics.totalUsers.toString()} />
        <ConversionRow
          label="Completed"
          value={`${metrics.completedCount} (${fmtPct(metrics.completedPct)})`}
        />
        <ConversionRow
          label="Returned 2+ days, wk 1"
          value={`${metrics.returned2PlusCount} (${fmtPct(metrics.returned2PlusPct)})`}
        />
        <ConversionRow
          label="Uploaded or upgraded"
          value={`${metrics.uploadedOrUpgradedCount} (${fmtPct(metrics.uploadedOrUpgradedPct)})`}
        />
        <ConversionRow
          label="Week-2 weekly active"
          value={`${metrics.weeklyActiveWeek2Count}/${metrics.weeklyActiveWeek2EligibleCount} (${fmtPct(metrics.weeklyActiveWeek2Pct)})`}
        />
        <ConversionRow
          label="Week-3 weekly active"
          value={`${metrics.weeklyActiveWeek3Count}/${metrics.weeklyActiveWeek3EligibleCount} (${fmtPct(metrics.weeklyActiveWeek3Pct)})`}
        />
      </dl>
    </div>
  )
}

function ConversionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums font-medium">{value}</dd>
    </div>
  )
}

function StuckUserRow({ user }: { user: StuckUser }) {
  return (
    <tr className="hover:bg-muted/30">
      <Td>{user.email}</Td>
      <Td>{user.stageLabel}</Td>
      <Td>{user.firstPath}</Td>
      <Td className="text-destructive font-medium">{user.hoursStuck.toFixed(1)}</Td>
      <Td className="max-w-md truncate">
        {user.lastError ? `${user.lastError.eventType}: ${fmtPayloadSummary(user.lastError.payload)}` : '—'}
      </Td>
    </tr>
  )
}

function JourneyRow({ journey, isAdmin }: { journey: UserJourney; isAdmin: boolean }) {
  return (
    <>
      <tr className={`hover:bg-muted/30 ${isAdmin ? 'opacity-50' : ''}`}>
        <Td>
          {journey.displayName ?? journey.email}
          {isAdmin ? ' (admin)' : ''}
        </Td>
        <Td>{fmtDate(journey.createdAt)}</Td>
        <Td>
          {journey.onboardingRoute ?? '—'}
          {journey.entryStruggle ? ` / ${journey.entryStruggle}` : ''}
        </Td>
        <Td>{journey.firstPath}</Td>
        <Td>{journey.stageLabel}</Td>
        <Td>{journey.lastSeenAt ? fmtDateTime(journey.lastSeenAt) : '—'}</Td>
        <Td>
          <JourneyFlags journey={journey} />
        </Td>
        <Td>{journey.completedAt ? fmtDate(journey.completedAt) : '—'}</Td>
      </tr>
      <tr className={isAdmin ? 'opacity-50' : ''}>
        <td colSpan={8} className="px-3 pb-2">
          <details>
            <summary className="cursor-pointer text-muted-foreground text-xs">
              Timeline ({journey.timeline.length})
            </summary>
            <ul className="mt-2 space-y-1 text-xs pl-3 border-l border-border">
              {journey.timeline.map((e, i) => (
                <li key={i} className="font-mono">
                  <span className="text-muted-foreground">{fmtDateTime(e.createdAt)}</span> {e.eventType}
                  {e.payload && (
                    <span className="text-muted-foreground"> {fmtPayloadSummary(e.payload)}</span>
                  )}
                </li>
              ))}
              {journey.timeline.length === 0 && (
                <li className="text-muted-foreground">No events recorded.</li>
              )}
            </ul>
          </details>
        </td>
      </tr>
    </>
  )
}

function JourneyFlags({ journey }: { journey: UserJourney }) {
  const parts: string[] = []
  if (journey.uploaded) parts.push('uploaded')
  if (journey.skippedUpload) parts.push('skipped')
  if (journey.upgraded) parts.push('upgraded')
  return <span>{parts.join(', ') || '—'}</span>
}

// ── Cell / formatting helpers ────────────────────────────────────────────

function Th({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return (
    <th className="px-3 py-2 text-left font-medium whitespace-nowrap" colSpan={colSpan}>
      {children}
    </th>
  )
}

function Td({
  children,
  className,
  title,
}: {
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <td className={`px-3 py-2 whitespace-nowrap ${className ?? ''}`} title={title}>
      {children}
    </td>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-border rounded-md p-3 bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  )
}

function fmtPct(n: number | null): string {
  if (n == null) return '—'
  return Math.round(n * 100) + '%'
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtPayloadSummary(payload: Record<string, unknown> | null): string {
  if (!payload) return ''
  const json = JSON.stringify(payload)
  return json.length > 120 ? json.slice(0, 120) + '…' : json
}
