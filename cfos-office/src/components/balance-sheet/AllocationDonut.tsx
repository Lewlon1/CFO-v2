'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { formatCurrency } from '@/lib/constants/dashboard'
import type { AllocationSlice } from '@/app/api/balance-sheet/route'

type Props = {
  allocation: AllocationSlice[]
  totalAssets: number
  currency?: string
}

export function AllocationDonut({ allocation, totalAssets, currency = 'EUR' }: Props) {
  if (allocation.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Asset Allocation</h3>
        <p className="text-sm text-muted-foreground text-center py-8">
          Add an asset to see your allocation.
        </p>
      </div>
    )
  }

  const data = allocation.map((s) => ({
    name: s.label,
    value: s.value,
    pct: s.pct,
    fill: s.color,
    type: s.type,
  }))

  return (
    <div className="rounded-lg border border-border bg-card p-4" aria-label="Asset allocation chart">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Asset Allocation</h3>
      <div className="relative">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={65}
              outerRadius={105}
              paddingAngle={2}
              stroke="none"
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
            >
              {data.map((entry) => (
                <Cell key={entry.type} fill={entry.fill} />
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
                `${formatCurrency(Number(value), currency)} (${
                  (entry?.payload as { pct: number })?.pct?.toFixed(1) ?? 0
                }%)`,
                String(name),
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Total Assets</p>
            <p className="text-base font-semibold text-foreground tabular-nums">
              {formatCurrency(totalAssets, currency)}
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-3">
        {data.map((entry) => (
          <div key={entry.type} className="flex items-center gap-1.5 text-xs">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.fill }} />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="text-foreground font-medium tabular-nums">{entry.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
