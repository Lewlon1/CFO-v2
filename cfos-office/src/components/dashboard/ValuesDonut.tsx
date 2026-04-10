'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { VALUE_COLORS, formatCurrency } from '@/lib/constants/dashboard'
import type { ValueCategorySummary } from '@/app/api/dashboard/summary/route'

type Props = {
  breakdown: Record<string, ValueCategorySummary>
  totalSpending: number
  currency?: string
}

export function ValuesDonut({ breakdown, totalSpending, currency = 'EUR' }: Props) {
  const order = ['foundation', 'investment', 'leak', 'burden', 'no_idea']
  const data = order
    .filter(vc => breakdown[vc] && breakdown[vc].amount > 0)
    .map(vc => ({
      name: VALUE_COLORS[vc].label,
      value: breakdown[vc].amount,
      pct: breakdown[vc].pct,
      fill: VALUE_COLORS[vc].fill,
      vc,
    }))

  if (data.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card p-4" aria-label="Values breakdown chart">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Your Money By Value</h3>
      <div className="relative">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={110}
              paddingAngle={2}
              stroke="none"
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
            >
              {data.map((entry) => (
                <Cell key={entry.vc} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: '#16161A',
                border: '1px solid #2A2A30',
                borderRadius: 8,
                color: '#F2F2F3',
                fontSize: 13,
              }}
              formatter={(value, name, entry) => [
                `${formatCurrency(Number(value), currency)} (${(entry?.payload as { pct: number })?.pct?.toFixed(1) ?? 0}%)`,
                String(name),
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-semibold text-foreground tabular-nums">
              {formatCurrency(totalSpending, currency)}
            </p>
          </div>
        </div>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2">
        {data.map((entry) => (
          <div key={entry.vc} className="flex items-center gap-1.5 text-xs">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.fill }} />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="text-foreground font-medium tabular-nums">{entry.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
