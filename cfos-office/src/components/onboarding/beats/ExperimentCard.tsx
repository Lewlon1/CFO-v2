'use client'

import type { Experiment } from '@/lib/analytics/insight-types'

interface ExperimentCardProps {
  experiment: Experiment
  onAccept: (experiment: Experiment) => void
}

function formatCurrencyBand(low: number, high: number, currency: string): string {
  const symbol =
    currency === 'EUR' ? '€' :
    currency === 'GBP' ? '£' :
    currency === 'USD' ? '$' :
    `${currency} `
  if (low === high) return `${symbol}${low.toLocaleString()}`
  return `${symbol}${low.toLocaleString()}–${symbol}${high.toLocaleString()}`
}

export function ExperimentCard({ experiment, onAccept }: ExperimentCardProps) {
  const monthBand = formatCurrencyBand(
    experiment.monthly_saving_low,
    experiment.monthly_saving_high,
    experiment.currency,
  )
  const annualBand = formatCurrencyBand(
    experiment.annual_saving_low,
    experiment.annual_saving_high,
    experiment.currency,
  )
  const hoursPerYear =
    experiment.annual_minutes_saved !== null && experiment.annual_minutes_saved > 0
      ? Math.round(experiment.annual_minutes_saved / 60)
      : null

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-3 animate-[fade-in_0.4s_ease-out]">
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-1 h-1 rounded-full bg-[var(--accent-gold)]" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-gold)]">
            Experiment
          </span>
        </div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] leading-snug">
          {experiment.title}
        </h3>
        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          {experiment.hypothesis} · {experiment.time_investment}
        </p>
      </div>

      <div className={`grid gap-2 ${hoursPerYear !== null ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-2.5 flex flex-col gap-0.5">
          <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">
            Save / year
          </div>
          <div className="text-base font-semibold text-[var(--text-primary)] tabular-nums leading-tight">
            {annualBand}
          </div>
          <div className="text-[10px] text-[var(--text-tertiary)] leading-tight">
            ≈ {monthBand} / month
          </div>
        </div>
        {hoursPerYear !== null && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-inset)] p-2.5 flex flex-col gap-0.5">
            <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">
              Time back
            </div>
            <div className="text-base font-semibold text-[var(--text-primary)] tabular-nums leading-tight">
              ~{hoursPerYear} hrs
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)] leading-tight">
              over the year
            </div>
          </div>
        )}
      </div>

      <p className="text-[10px] text-[var(--text-tertiary)] italic">
        Estimate · based on your pattern
      </p>

      <button
        onClick={() => onAccept(experiment)}
        className="w-full min-h-[44px] rounded-xl bg-[var(--accent-gold)]
                   text-[var(--bg-base)] text-sm font-semibold
                   transition-all duration-200
                   hover:brightness-110 active:scale-[0.98]"
      >
        {experiment.cta_label}
      </button>
    </div>
  )
}
