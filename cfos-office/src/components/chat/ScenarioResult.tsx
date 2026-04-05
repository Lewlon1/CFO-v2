'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatCurrency(amount: number, currency?: string): string {
  const c = currency || 'EUR';
  const symbol = c === 'EUR' ? '€' : c === 'GBP' ? '£' : c === 'USD' ? '$' : c;
  return `${symbol}${Math.abs(amount).toLocaleString('en', { maximumFractionDigits: 0 })}`;
}

function ComparisonCard({
  label,
  current,
  projected,
  currency,
  invertColors,
}: {
  label: string;
  current: number;
  projected: number;
  currency?: string;
  invertColors?: boolean;
}) {
  const delta = projected - current;
  const isPositive = invertColors ? delta < 0 : delta > 0;
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <p className="text-xs text-muted-foreground mb-2">{label}</p>
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">Now</p>
          <p className="text-sm font-semibold text-foreground">{formatCurrency(current, currency)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">After</p>
          <p className="text-sm font-semibold text-foreground">{formatCurrency(projected, currency)}</p>
        </div>
      </div>
      {delta !== 0 && (
        <p className={`text-xs mt-1.5 ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {delta > 0 ? '+' : ''}{formatCurrency(delta, currency)}/mo
        </p>
      )}
    </div>
  );
}

function MetricRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className="text-sm font-medium text-foreground">{value}</span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

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
function SalaryResult({ data }: { data: any }) {
  return (
    <div className="space-y-2">
      <ComparisonCard
        label="Monthly discretionary"
        current={data.current.discretionary}
        projected={data.projected.discretionary}
        currency={data.currency}
      />
      <div className="bg-card border border-border rounded-lg p-3">
        <MetricRow label="Monthly change" value={`${data.impact.monthly_change > 0 ? '+' : ''}${formatCurrency(data.impact.monthly_change, data.currency)}`} />
        <MetricRow label="Annual change" value={`${data.impact.annual_change > 0 ? '+' : ''}${formatCurrency(data.impact.annual_change, data.currency)}`} />
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ExpenseReductionResult({ data }: { data: any }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3 space-y-1">
      <p className="text-xs text-muted-foreground mb-2">Cutting <span className="text-foreground font-medium">{data.category}</span> by {data.reduction_pct}%</p>
      <MetricRow label="Current monthly avg" value={formatCurrency(data.current_monthly_avg, data.currency)} />
      <MetricRow label="Target monthly" value={formatCurrency(data.target_monthly, data.currency)} />
      <MetricRow label="Monthly saving" value={`+${formatCurrency(data.monthly_saving, data.currency)}`} />
      <MetricRow label="Annual saving" value={`+${formatCurrency(data.annual_saving, data.currency)}`} />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PropertyResult({ data }: { data: any }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3 space-y-1">
      <p className="text-xs text-muted-foreground mb-2">Property at {formatCurrency(data.property_price, data.currency)}</p>
      <MetricRow label="Deposit" value={formatCurrency(data.deposit.amount, data.currency)} sub={`${data.deposit.percentage}%`} />
      <MetricRow label="Mortgage" value={formatCurrency(data.mortgage.amount, data.currency)} sub={`${data.mortgage.term_years}yr @ ${data.mortgage.annual_rate_pct}%`} />
      <MetricRow label="Monthly payment" value={formatCurrency(data.mortgage.monthly_payment, data.currency)} />
      {data.vs_current_rent != null && (
        <MetricRow
          label="vs current rent"
          value={`${data.vs_current_rent > 0 ? '+' : ''}${formatCurrency(data.vs_current_rent, data.currency)}/mo`}
        />
      )}
      <MetricRow label="Total interest" value={formatCurrency(data.mortgage.total_interest, data.currency)} />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChildrenResult({ data }: { data: any }) {
  return (
    <div className="space-y-2">
      <div className="bg-card border border-border rounded-lg p-3 space-y-1">
        <p className="text-xs text-muted-foreground mb-2">
          {data.child_count} child{data.child_count > 1 ? 'ren' : ''} — estimated monthly costs
        </p>
        {Object.entries(data.cost_breakdown as Record<string, number>).map(([key, val]) => (
          <MetricRow key={key} label={key.replace(/_/g, ' ')} value={formatCurrency(val, data.currency)} />
        ))}
        <div className="border-t border-border mt-1 pt-1">
          <MetricRow label="Total per child" value={formatCurrency(data.estimated_monthly_cost_per_child, data.currency)} />
        </div>
      </div>
      <ComparisonCard
        label="Monthly surplus"
        current={data.current_surplus}
        projected={data.new_surplus}
        currency={data.currency}
      />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CareerChangeResult({ data }: { data: any }) {
  const transition = data.transition;
  return (
    <div className="space-y-2">
      <div className="bg-card border border-border rounded-lg p-3 space-y-1">
        <p className="text-xs text-muted-foreground mb-2">Transition period — {transition.months_with_no_income} months</p>
        <MetricRow label="Monthly burn rate" value={formatCurrency(transition.monthly_burn_rate, data.currency)} />
        <MetricRow label="Total cost" value={formatCurrency(transition.total_transition_cost, data.currency)} />
        <MetricRow label="Current savings" value={formatCurrency(transition.current_savings, data.currency)} />
        <MetricRow label="Runway" value={`${transition.months_of_runway} months`} />
        <MetricRow
          label="Can survive?"
          value={transition.can_survive_transition ? 'Yes' : `No — ${formatCurrency(transition.shortfall, data.currency)} short`}
        />
      </div>
      <ComparisonCard
        label="Steady-state surplus"
        current={data.steady_state.current_surplus}
        projected={data.steady_state.new_surplus}
        currency={data.currency}
      />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function InvestmentGrowthResult({ data }: { data: any }) {
  const chartData = (data.yearly_breakdown as Array<{ year: number; total_value: number; total_contributed: number }>).map(
    (d) => ({
      year: `Y${d.year}`,
      contributed: d.total_contributed,
      value: d.total_value,
    })
  );

  return (
    <div className="space-y-2">
      <div className="bg-card border border-border rounded-lg p-3 space-y-1">
        <p className="text-xs text-muted-foreground mb-2">
          {formatCurrency(data.monthly_contribution, data.currency)}/mo for {data.years} years @ {data.annual_return_pct}%
        </p>
        <MetricRow label="Total contributed" value={formatCurrency(data.result.total_contributed, data.currency)} />
        <MetricRow label="Total value" value={formatCurrency(data.result.total_future_value, data.currency)} />
        <MetricRow label="Growth" value={`+${formatCurrency(data.result.total_growth, data.currency)} (+${data.result.growth_pct}%)`} />
      </div>

      <div className="bg-card border border-border rounded-lg p-3">
        <p className="text-xs text-muted-foreground mb-3">Growth over time</p>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <XAxis
                dataKey="year"
                tick={{ fontSize: 10, fill: '#8A8A96' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#8A8A96' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1A1A1F',
                  border: '1px solid #2A2A30',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(value) => formatCurrency(Number(value), data.currency)}
              />
              <Area
                type="monotone"
                dataKey="contributed"
                stackId="1"
                stroke="#6366F1"
                fill="#6366F1"
                fillOpacity={0.3}
                name="Contributed"
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#E8A84C"
                fill="#E8A84C"
                fillOpacity={0.15}
                name="Total value"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {data.disclaimer && (
        <p className="text-[10px] text-muted-foreground/60 px-1">{data.disclaimer}</p>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ScenarioResult({ result }: { result: any }) {
  if (!result || result.error) return null;

  switch (result.scenario) {
    case 'salary_increase':
      return <SalaryResult data={result} />;
    case 'expense_reduction':
      return <ExpenseReductionResult data={result} />;
    case 'property_purchase':
      return <PropertyResult data={result} />;
    case 'children':
      return <ChildrenResult data={result} />;
    case 'career_change':
      return <CareerChangeResult data={result} />;
    case 'investment_growth':
      return <InvestmentGrowthResult data={result} />;
    default:
      return null;
  }
}
