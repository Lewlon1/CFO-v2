'use client'

import { useEffect } from 'react'
import { ArrowRight, CircleDot, Plane } from 'lucide-react'
import { Briefing } from './Briefing'
import { DetailHeader } from './DetailHeader'
import { DrillDownRow } from './DrillDownRow'
import { useTrackEvent } from '@/lib/events/use-track-event'

const ACCENT = '#F43F5E'

function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatTripDates(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const nights = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000))
  return `${s.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} · ${nights} night${nights === 1 ? '' : 's'}`
}

export interface ScenariosDashboardGoal {
  id: string
  name: string
  current_amount: number
  target_amount: number
  on_track: boolean | null
  status: string | null
  target_date: string | null
}

export interface ScenariosDashboardTrip {
  id: string
  name: string
  destination: string | null
  start_date: string
  end_date: string
  total_estimated: number | null
  currency: string
  status: string | null
}

export interface ScenariosDashboardScenario {
  id: string
  title: string | null
  updated_at: string
}

interface ScenariosDashboardProps {
  currency: string
  goals: ScenariosDashboardGoal[]
  trips: ScenariosDashboardTrip[]
  recentScenarios: ScenariosDashboardScenario[]
}

export function ScenariosDashboard({
  currency,
  goals,
  trips,
  recentScenarios,
}: ScenariosDashboardProps) {
  const trackEvent = useTrackEvent()

  useEffect(() => {
    trackEvent('scenarios_dashboard_viewed', 'engagement')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeScenario = recentScenarios[0] ?? null
  const slippingGoal = goals.find((g) => g.on_track === false)

  return (
    <div className="px-3.5 pt-2 pb-24">
      <DetailHeader title="Scenario Planning" color={ACCENT} backHref="/office" />

      <Briefing accentColor={ACCENT}>
        {buildBriefing({ activeScenario, goals, trips, slippingGoal })}
      </Briefing>

      {activeScenario && <ActiveScenarioCard scenario={activeScenario} />}

      {goals.length > 0 && <GoalsSection goals={goals} currency={currency} />}

      {trips.length > 0 && <TripsSection trips={trips} currency={currency} />}

      <div className="flex flex-col gap-2">
        <DrillDownRow
          title="Goals"
          subtitle={goals.length > 0 ? `${goals.length} tracked` : 'track savings toward a target'}
          href="/office/scenarios/goals"
          icon="◎"
          accentColor={ACCENT}
        />
        <DrillDownRow
          title="Trip planning"
          subtitle={trips.length > 0 ? `${trips.length} planned` : 'plan and budget trips'}
          href="/office/scenarios/trips"
          icon="✈"
          accentColor={ACCENT}
        />
        <DrillDownRow
          title="What If"
          subtitle="model a decision · salary, move, switch job"
          href="/office/scenarios/what-if"
          icon="⊗"
          accentColor={ACCENT}
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function buildBriefing({
  activeScenario,
  goals,
  trips,
  slippingGoal,
}: {
  activeScenario: ScenariosDashboardScenario | null
  goals: ScenariosDashboardGoal[]
  trips: ScenariosDashboardTrip[]
  slippingGoal: ScenariosDashboardGoal | undefined
}): string {
  const parts: string[] = []
  if (activeScenario) {
    parts.push(`Your last scenario was ${activeScenario.title ?? 'untitled'}.`)
  } else {
    parts.push(`No scenarios running yet — plenty to explore when you're ready.`)
  }
  if (trips.length > 0) {
    parts.push(
      trips.length === 1 ? `One trip in the diary.` : `${trips.length} trips in the diary.`,
    )
  }
  if (slippingGoal) {
    parts.push(`Your ${slippingGoal.name} goal is off pace — worth a look.`)
  } else if (goals.length > 0) {
    parts.push(
      goals.length === 1 ? `One goal tracking.` : `${goals.length} goals tracking.`,
    )
  }
  return parts.join(' ')
}

// ─────────────────────────────────────────────────────────────────────────────

function ActiveScenarioCard({ scenario }: { scenario: ScenariosDashboardScenario }) {
  const updated = new Date(scenario.updated_at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })

  return (
    <div
      className="rounded-[12px] mb-4 px-[14px] py-[14px]"
      style={{
        background: 'var(--bg-card)',
        border: `0.5px solid ${ACCENT}40`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: ACCENT }}
        >
          Latest scenario
        </div>
        <div
          className="px-[9px] py-[3px] rounded-[10px] text-[10px] font-semibold"
          style={{
            background: `${ACCENT}20`,
            border: `0.5px solid ${ACCENT}40`,
            color: ACCENT,
          }}
        >
          updated {updated}
        </div>
      </div>
      <div
        className="text-[20px] tracking-[-0.01em] text-text-primary"
        style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}
      >
        {scenario.title ?? 'Untitled scenario'}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function GoalsSection({
  goals,
  currency,
}: {
  goals: ScenariosDashboardGoal[]
  currency: string
}) {
  return (
    <div className="mb-4">
      <div className="text-[11px] font-semibold text-text-primary mb-[10px]">
        Goals · {goals.length}
      </div>
      <div className="flex flex-col gap-[10px]">
        {goals.slice(0, 5).map((g) => {
          const target = Number(g.target_amount ?? 0)
          const current = Number(g.current_amount ?? 0)
          const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
          const slipping = g.on_track === false
          const barColor = slipping ? 'var(--negative)' : 'var(--positive)'
          const statusLabel = slipping
            ? 'slipping'
            : pct >= 100
              ? 'done'
              : pct >= 80
                ? 'close'
                : 'on track'
          return (
            <div key={g.id}>
              <div className="flex items-baseline justify-between mb-[5px]">
                <div className="flex items-center gap-[7px]">
                  <CircleDot size={10} style={{ color: barColor }} strokeWidth={2} />
                  <span className="text-[13px] text-text-primary font-medium truncate">
                    {g.name}
                  </span>
                </div>
                <span className="text-[10px] italic" style={{ color: barColor }}>
                  {statusLabel}
                </span>
              </div>
              <div className="h-[5px] bg-bg-inset rounded-[3px] overflow-hidden">
                <div
                  className="h-full"
                  style={{ width: `${Math.max(pct, 2)}%`, background: barColor, opacity: 0.85 }}
                />
              </div>
              <div className="flex justify-between mt-1">
                <span className="font-data text-[10px] text-text-tertiary tabular-nums">
                  {formatCurrency(current, currency)} / {formatCurrency(target, currency)}
                </span>
                {g.target_date && (
                  <span className="text-[10px] text-text-tertiary italic">
                    by {new Date(g.target_date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function TripsSection({
  trips,
  currency,
}: {
  trips: ScenariosDashboardTrip[]
  currency: string
}) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-[10px]">
        <div className="text-[11px] font-semibold text-text-primary">
          Trips · {trips.length}
        </div>
        <a
          href="/office/scenarios/trips"
          className="text-[10px] flex items-center gap-0.5"
          style={{ color: ACCENT }}
        >
          Plan new <ArrowRight size={10} strokeWidth={2} />
        </a>
      </div>
      <div className="flex flex-col gap-2">
        {trips.slice(0, 3).map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-[8px] px-3 py-[11px] bg-bg-card border border-[rgba(255,255,255,0.04)]"
          >
            <Plane size={14} strokeWidth={1.8} style={{ color: ACCENT }} />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-text-primary truncate">
                {t.destination ?? t.name}
              </div>
              <div className="text-[10.5px] text-text-tertiary mt-0.5">
                {formatTripDates(t.start_date, t.end_date)}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-data text-[12px] text-text-primary tabular-nums">
                {formatCurrency(t.total_estimated ?? 0, t.currency || currency)}
              </div>
              <div
                className="text-[9px] italic mt-0.5"
                style={{
                  color: t.status === 'planned' ? 'var(--text-tertiary)' : ACCENT,
                }}
              >
                {t.status ?? 'draft'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default ScenariosDashboard
