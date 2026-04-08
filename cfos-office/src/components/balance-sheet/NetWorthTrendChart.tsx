'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  CartesianGrid,
} from 'recharts'
import { formatCurrency, formatShortMonth } from '@/lib/constants/dashboard'
import type { TrendPoint } from '@/app/api/balance-sheet/route'

type Props = {
  trend: TrendPoint[]
  currency?: string
}

export function NetWorthTrendChart({ trend, currency = 'EUR' }: Props) {
  if (trend.length <= 1) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Net Worth Trend</h3>
        <p className="text-sm text-muted-foreground text-center py-8">
          Add more data over time to see your net worth trend.
        </p>
      </div>
    )
  }

  const data = trend.map((p) => ({
    month: formatShortMonth(p.month),
    net_worth: p.net_worth,
    total_assets: p.total_assets,
    total_liabilities: p.total_liabilities,
  }))

  return (
    <div className="rounded-lg border border-border bg-card p-4" aria-label="Net worth trend chart">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Net Worth Trend</h3>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
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
            tickFormatter={(v) => `${Math.round(v / 1000)}k`}
            width={48}
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
              formatCurrency(Number(value), currency),
              name === 'net_worth'
                ? 'Net Worth'
                : name === 'total_assets'
                  ? 'Assets'
                  : 'Liabilities',
            ]}
          />
          <Area type="monotone" dataKey="net_worth" fill="#3B82F620" stroke="none" />
          <Line
            type="monotone"
            dataKey="net_worth"
            stroke="#3B82F6"
            strokeWidth={2.5}
            dot={{ fill: '#3B82F6', r: 4 }}
            activeDot={{ r: 6 }}
          />
          <Line
            type="monotone"
            dataKey="total_assets"
            stroke="#10B981"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="total_liabilities"
            stroke="#EF4444"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex justify-center gap-4 mt-2 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-blue-500" />
          <span className="text-muted-foreground">Net Worth</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 border-t border-dashed border-emerald-500" />
          <span className="text-muted-foreground">Assets</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 border-t border-dashed border-red-500" />
          <span className="text-muted-foreground">Liabilities</span>
        </div>
      </div>
    </div>
  )
}
