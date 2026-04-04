'use client'

import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { VALUE_COLORS, formatShortMonth } from '@/lib/constants/dashboard'
import type { TrendMonth } from '@/app/api/dashboard/trends/route'

type Props = {
  months: TrendMonth[]
}

export function ValuesTrendChart({ months }: Props) {
  if (months.length <= 1) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Values Over Time</h3>
        <p className="text-sm text-muted-foreground text-center py-8">
          Upload more months to see how your values shift over time.
        </p>
      </div>
    )
  }

  const data = months.map(m => {
    const vc = m.spending_by_value_category
    const total = Object.values(vc).reduce((s, v) => s + v, 0)
    if (total === 0) {
      return {
        month: formatShortMonth(m.month),
        foundation: 0,
        investment: 0,
        leak: 0,
        burden: 0,
      }
    }
    return {
      month: formatShortMonth(m.month),
      foundation: Math.round(((vc.foundation ?? 0) / total) * 100),
      investment: Math.round(((vc.investment ?? 0) / total) * 100),
      leak: Math.round(((vc.leak ?? 0) / total) * 100),
      burden: Math.round(((vc.burden ?? 0) / total) * 100),
    }
  })

  return (
    <div className="rounded-lg border border-border bg-card p-4" aria-label="Values trend chart">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Values Over Time</h3>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} stackOffset="expand">
          <CartesianGrid strokeDasharray="3 3" stroke="#2A2A30" />
          <XAxis
            dataKey="month"
            tick={{ fill: '#8A8A96', fontSize: 12 }}
            axisLine={{ stroke: '#2A2A30' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#8A8A96', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
            width={40}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#16161A',
              border: '1px solid #2A2A30',
              borderRadius: 8,
              color: '#F2F2F3',
              fontSize: 13,
            }}
            formatter={(value, name) => [
              `${Math.round(Number(value) * 100)}%`,
              VALUE_COLORS[String(name)]?.label ?? String(name),
            ]}
          />
          <Area type="monotone" dataKey="foundation" stackId="1" fill={VALUE_COLORS.foundation.fill} stroke={VALUE_COLORS.foundation.fill} fillOpacity={0.7} />
          <Area type="monotone" dataKey="investment" stackId="1" fill={VALUE_COLORS.investment.fill} stroke={VALUE_COLORS.investment.fill} fillOpacity={0.7} />
          <Area type="monotone" dataKey="burden" stackId="1" fill={VALUE_COLORS.burden.fill} stroke={VALUE_COLORS.burden.fill} fillOpacity={0.7} />
          <Area type="monotone" dataKey="leak" stackId="1" fill={VALUE_COLORS.leak.fill} stroke={VALUE_COLORS.leak.fill} fillOpacity={0.7} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
