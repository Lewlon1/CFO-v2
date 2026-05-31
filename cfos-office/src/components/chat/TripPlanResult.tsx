'use client';

import { formatCurrency } from '@/lib/format/currency';
import { colors, valueColors } from '@/lib/tokens';

// Phase 3b restyle: the trip-budget bars have no dedicated token palette, so each
// category maps to the nearest semantic token (theme-reactive var() strings).
// Flagged no-clean-equivalents: `activities` was pink → accent-cyan; `local_transport`
// was violet → burden warm-grey. No new token invented to preserve a one-off shade.
const BUDGET_COLORS: Record<string, string> = {
  flights: colors.info,
  accommodation: colors.gold,
  food: colors.positive,
  activities: colors.cyan,
  local_transport: valueColors.burden,
  misc: valueColors.unsure,
};

const BUDGET_LABELS: Record<string, string> = {
  flights: 'Flights',
  accommodation: 'Accommodation',
  food: 'Food & dining',
  activities: 'Activities',
  local_transport: 'Local transport',
  misc: 'Misc / buffer',
};

function FeasibilityBadge({ rating }: { rating: string }) {
  // Phase 3b flag: 4-tier feasibility collapses onto the 3 available semantic
  // tokens (positive / accent-gold / negative) — no amber/orange token exists;
  // tight & stretch share gold (the label keeps them distinct). No new token.
  const ratingClasses: Record<string, string> = {
    comfortable: 'bg-positive/15 text-positive',
    tight: 'bg-accent-gold-bg text-accent-gold',
    stretch: 'bg-accent-gold-bg text-accent-gold',
    unrealistic: 'bg-negative/15 text-negative',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${ratingClasses[rating] || 'bg-muted text-muted-foreground'}`}>
      {rating}
    </span>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function TripPlanResult({ result }: { result: any }) {
  if (!result || result.error || result.type !== 'event_plan') return null;

  const budget = result.budget;
  const funding = result.funding;
  const budgetEntries = Object.entries(budget)
    .filter(([k]) => k !== 'total')
    .sort(([, a], [, b]) => (b as number) - (a as number)) as [string, number][];

  const maxAmount = Math.max(...budgetEntries.map(([, v]) => v));

  return (
    <div className="space-y-2 mt-2">
      {/* Budget breakdown */}
      <div className="bg-card border border-border rounded-lg p-3">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-muted-foreground">Budget breakdown</p>
          <p className="text-sm font-semibold text-foreground">{formatCurrency(budget.total, result.currency)}</p>
        </div>

        <div className="space-y-2">
          {budgetEntries.map(([key, val]) => (
            <div key={key}>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-muted-foreground">{BUDGET_LABELS[key] || key}</span>
                <span className="text-foreground">{formatCurrency(val, result.currency)}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(val / maxAmount) * 100}%`,
                    backgroundColor: BUDGET_COLORS[key] || valueColors.unsure,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Funding plan */}
      <div className="bg-card border border-border rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-muted-foreground">Funding plan</p>
          <FeasibilityBadge rating={funding.feasibility} />
        </div>

        <div className="space-y-1">
          {funding.split_note && (
            <div className="flex items-center justify-between py-1">
              <span className="text-xs text-muted-foreground">Split</span>
              <span className="text-xs text-foreground">{funding.split_note}</span>
            </div>
          )}
          <div className="flex items-center justify-between py-1">
            <span className="text-xs text-muted-foreground">Your share</span>
            <span className="text-sm font-medium text-foreground">{formatCurrency(funding.user_share, result.currency)}</span>
          </div>
          {funding.months_until_trip > 0 && (
            <>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-muted-foreground">Months to save</span>
                <span className="text-sm text-foreground">{funding.months_until_trip}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-xs text-muted-foreground">Monthly saving needed</span>
                <span className="text-sm font-medium text-foreground">{formatCurrency(funding.monthly_saving_required, result.currency)}/mo</span>
              </div>
            </>
          )}
          {funding.current_monthly_surplus != null && (
            <div className="flex items-center justify-between py-1">
              <span className="text-xs text-muted-foreground">Current surplus</span>
              <span className="text-sm text-foreground">{formatCurrency(funding.current_monthly_surplus, result.currency)}/mo</span>
            </div>
          )}
        </div>

        {/* Suggested cuts */}
        {funding.suggested_cuts && funding.suggested_cuts.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground mb-1.5">Could free up by cutting:</p>
            {funding.suggested_cuts.map((cut: { category: string; current_monthly: number; suggested_reduction: number }) => (
              <div key={cut.category} className="flex items-center justify-between py-0.5">
                <span className="text-xs text-muted-foreground">{cut.category}</span>
                <span className="text-xs text-positive">+{formatCurrency(cut.suggested_reduction, result.currency)}/mo</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Goal created */}
      {result.goal && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg px-3 py-2">
          <p className="text-xs text-primary">
            Savings goal created: {result.goal.name} — {formatCurrency(result.goal.target, result.currency)}
          </p>
        </div>
      )}
    </div>
  );
}
