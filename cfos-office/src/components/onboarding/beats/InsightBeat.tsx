'use client'

import type { OnboardingData } from '@/lib/onboarding/types'
import type {
  FirstInsightCards,
  RecurringCard,
  LeakCard,
  ValueBreakdownCard,
} from '@/lib/analytics/first-insight'

interface InsightBeatProps {
  data: OnboardingData
  insightData?: FirstInsightCards
  loading?: boolean
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' }

function sym(currency: string | undefined): string {
  if (!currency) return '£'
  return CURRENCY_SYMBOLS[currency] ?? currency
}

function fmtMoney(amount: number, currency: string | undefined): string {
  const s = sym(currency)
  const rounded = Math.round(amount)
  return `${s}${rounded.toLocaleString('en-GB')}`
}

function titleCase(s: string): string {
  if (!s) return s
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function humaniseFrequency(freq: string): string {
  const f = (freq ?? '').toLowerCase()
  if (f === 'monthly') return 'monthly'
  if (f === 'weekly') return 'weekly'
  if (f === 'bi-weekly' || f === 'biweekly' || f === 'fortnightly') return 'fortnightly'
  if (f === 'quarterly') return 'quarterly'
  if (f === 'annual' || f === 'yearly') return 'annual'
  if (f === 'bi-monthly' || f === 'bimonthly') return 'bi-monthly'
  if (f === 'irregular') return 'irregular'
  return f || 'recurring'
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function InsightSkeleton() {
  return (
    <div className="px-4 py-2 ml-[40px] animate-[fade-in_0.3s_ease-out] space-y-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 max-w-sm"
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-[var(--bg-inset)] animate-pulse" />
            <div className="h-3 w-20 rounded bg-[var(--bg-inset)] animate-pulse" />
          </div>
          <div className="h-4 w-[80%] rounded bg-[var(--bg-inset)] animate-pulse mb-2" />
          <div className="h-3 w-[60%] rounded bg-[var(--bg-inset)] animate-pulse" />
        </div>
      ))}
    </div>
  )
}

// ── Card chrome ─────────────────────────────────────────────────────────────

function InsightCard({
  label,
  dotColour,
  children,
}: {
  label: string
  dotColour: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 max-w-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dotColour }} />
        <p className="text-[10px] uppercase tracking-widest text-[var(--text-tertiary)]">
          {label}
        </p>
      </div>
      {children}
    </div>
  )
}

// ── Individual cards ────────────────────────────────────────────────────────

function RecurringCardView({ card, currency }: { card: RecurringCard; currency: string }) {
  return (
    <InsightCard label="Recurring Charges" dotColour="#E8A84C">
      <p className="text-base font-semibold text-[var(--text-primary)] mb-1.5">
        {card.count} recurring {card.count === 1 ? 'charge' : 'charges'} ·{' '}
        {fmtMoney(card.totalMonthlyEstimate, currency)}/month
      </p>
      <ul className="space-y-1 mt-2">
        {card.topItems.map((item) => (
          <li
            key={item.merchant}
            className="flex items-baseline justify-between gap-3 text-xs text-[var(--text-secondary)] leading-relaxed"
          >
            <span className="truncate">{titleCase(item.merchant)}</span>
            <span className="tabular-nums shrink-0">
              {fmtMoney(item.amount, currency)} · {humaniseFrequency(item.frequency)}
            </span>
          </li>
        ))}
      </ul>
    </InsightCard>
  )
}

function LeakCardView({ card, currency }: { card: LeakCard; currency: string }) {
  const monthsLabel =
    card.monthsObserved < 1.5
      ? 'in the last month'
      : `over the last ${Math.round(card.monthsObserved)} months`

  return (
    <InsightCard label="Biggest Leak" dotColour="#F43F5E">
      <p className="text-base font-semibold text-[var(--text-primary)] mb-1.5">
        {titleCase(card.merchant)} · {fmtMoney(card.totalSpent, currency)}
      </p>
      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
        {card.transactionCount} {card.transactionCount === 1 ? 'charge' : 'charges'}{' '}
        {monthsLabel} — you flagged this as a Leak in your Value Map.
      </p>
    </InsightCard>
  )
}

const VALUE_COLOURS = {
  foundation: '#22C55E',
  investment: '#3B82F6',
  burden: '#8B5CF6',
  leak: '#F43F5E',
} as const

const VALUE_ORDER: Array<keyof typeof VALUE_COLOURS> = [
  'foundation',
  'investment',
  'burden',
  'leak',
]

function ValueBreakdownCardView({
  card,
  currency,
}: {
  card: ValueBreakdownCard
  currency: string
}) {
  return (
    <InsightCard label="Where It Goes" dotColour="#E8A84C">
      <p className="text-base font-semibold text-[var(--text-primary)] mb-2">
        {fmtMoney(card.totalSpend, currency)} across {card.classifiedCount} classified{' '}
        {card.classifiedCount === 1 ? 'transaction' : 'transactions'}
      </p>
      <div className="flex h-2 w-full rounded-full overflow-hidden bg-[var(--bg-inset)] mb-2.5">
        {VALUE_ORDER.map((key) => {
          const pct = card[key].percentage
          if (pct === 0) return null
          return (
            <div
              key={key}
              className="h-full"
              style={{ width: `${pct}%`, backgroundColor: VALUE_COLOURS[key] }}
            />
          )
        })}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {VALUE_ORDER.map((key) => {
          const pct = card[key].percentage
          if (pct === 0) return null
          return (
            <li key={key} className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: VALUE_COLOURS[key] }}
              />
              <span className="capitalize">{key}</span>
              <span className="tabular-nums ml-auto">{pct.toFixed(0)}%</span>
            </li>
          )
        })}
      </ul>
    </InsightCard>
  )
}

// ── Empty fallback ──────────────────────────────────────────────────────────

function EmptyCard() {
  return (
    <InsightCard label="First Look" dotColour="#E8A84C">
      <p className="text-sm text-[var(--text-primary)] leading-relaxed">
        I&apos;ve logged everything. Your breakdown is building in Cash Flow and Values &amp;
        You — we&apos;ll have more to say once I&apos;ve watched a bit more of your spending.
      </p>
    </InsightCard>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export function InsightBeat({ insightData, loading }: InsightBeatProps) {
  if (loading) return <InsightSkeleton />

  const currency = insightData?.currency ?? 'GBP'
  const hasAny =
    !!insightData &&
    (insightData.recurring !== null ||
      insightData.leak !== null ||
      insightData.valueBreakdown !== null)

  return (
    <div className="px-4 py-2 ml-[40px] animate-[fade-in_0.4s_ease-out] space-y-3">
      {!hasAny && <EmptyCard />}
      {insightData?.recurring && (
        <RecurringCardView card={insightData.recurring} currency={currency} />
      )}
      {insightData?.leak && <LeakCardView card={insightData.leak} currency={currency} />}
      {insightData?.valueBreakdown && (
        <ValueBreakdownCardView card={insightData.valueBreakdown} currency={currency} />
      )}
    </div>
  )
}
