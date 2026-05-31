'use client'

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, CartesianGrid,
} from 'recharts'
import { formatCurrency, formatShortMonth } from '@/lib/constants/dashboard'
import { colors } from '@/lib/tokens'
import type { TrendMonth } from '@/app/api/dashboard/trends/route'

type Props = {
  months: TrendMonth[]
}

export function TrendChart({ months }: Props) {
  if (months.length <= 1) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Spending Trend</h3>
        <p className="text-sm text-muted-foreground text-center py-8">
          Upload more months to see trends.
        </p>
      </div>
    )
  }

  const data = months.map(m => ({
    month: formatShortMonth(m.month),
    spending: m.total_spending,
    income: m.total_income,
  }))

  const hasIncome = data.some(d => d.income > 0)

  return (
    <div className="rounded-lg border border-border bg-card p-4" aria-label="Spending trend chart">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Spending Trend</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.borderVisible} />
          <XAxis
            dataKey="month"
            tick={{ fill: colors.textTertiary, fontSize: 12 }}
            axisLine={{ stroke: colors.borderVisible }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: colors.textTertiary, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${Math.round(v / 1000)}k`}
            width={40}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: colors.bgElevated,
              border: `1px solid ${colors.borderMedium}`,
              borderRadius: 8,
              color: colors.textPrimary,
              fontSize: 13,
            }}
            formatter={(value, name) => [
              formatCurrency(Number(value)),
              name === 'spending' ? 'Spending' : 'Income',
            ]}
          />
          {hasIncome && (
            <Area
              type="monotone"
              dataKey="income"
              fill={colors.positive}
              fillOpacity={0.12}
              stroke="none"
            />
          )}
          <Line
            type="monotone"
            dataKey="spending"
            stroke={colors.gold}
            strokeWidth={2}
            dot={{ fill: colors.gold, r: 4 }}
            activeDot={{ r: 6 }}
          />
          {hasIncome && (
            <Line
              type="monotone"
              dataKey="income"
              stroke={colors.positive}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={{ fill: colors.positive, r: 4 }}
              activeDot={{ r: 6 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
