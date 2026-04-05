'use client';

function formatCurrency(amount: number, currency?: string): string {
  const c = currency || 'EUR';
  const symbol = c === 'EUR' ? '€' : c === 'GBP' ? '£' : c === 'USD' ? '$' : c;
  return `${symbol}${Math.abs(amount).toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

const BUDGET_COLORS: Record<string, string> = {
  flights: '#6366F1',
  accommodation: '#E8A84C',
  food: '#10B981',
  activities: '#F472B6',
  local_transport: '#8B5CF6',
  misc: '#6B7280',
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
  const colors: Record<string, string> = {
    comfortable: 'bg-emerald-500/20 text-emerald-400',
    tight: 'bg-amber-500/20 text-amber-400',
    stretch: 'bg-orange-500/20 text-orange-400',
    unrealistic: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[rating] || 'bg-muted text-muted-foreground'}`}>
      {rating}
    </span>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function TripPlanResult({ result }: { result: any }) {
  if (!result || result.error || result.type !== 'trip_plan') return null;

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
                    backgroundColor: BUDGET_COLORS[key] || '#6B7280',
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
                <span className="text-xs text-emerald-400">+{formatCurrency(cut.suggested_reduction, result.currency)}/mo</span>
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
