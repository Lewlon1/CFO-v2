'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { CATEGORY_COLORS, formatCurrency } from '@/lib/constants/dashboard'
import type { CategorySummary } from '@/app/api/dashboard/summary/route'

type Props = {
  categories: Record<string, CategorySummary>
  onCategoryClick: (slug: string) => void
}

export function SpendingChart({ categories, onCategoryClick }: Props) {
  const data = Object.entries(categories)
    .sort(([, a], [, b]) => b.amount - a.amount)
    .slice(0, 10)
    .map(([slug, cat]) => ({
      slug,
      name: cat.name,
      amount: cat.amount,
      pct: cat.pct,
      color: CATEGORY_COLORS[cat.color] ?? '#6B7280',
    }))

  if (data.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card p-4" aria-label="Spending by category chart">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Spending by Category</h3>
      <ResponsiveContainer width="100%" height={data.length * 44 + 20}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={110}
            tick={{ fill: '#8A8A96', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
            contentStyle={{
              backgroundColor: '#16161A',
              border: '1px solid #2A2A30',
              borderRadius: 8,
              color: '#F2F2F3',
              fontSize: 13,
            }}
            formatter={(value, _name, entry) => [
              `${formatCurrency(Number(value))} (${(entry?.payload as { pct: number })?.pct?.toFixed(1) ?? 0}%)`,
              'Amount',
            ]}
          />
          <Bar
            dataKey="amount"
            radius={[0, 4, 4, 0]}
            cursor="pointer"
            onClick={(_data, index) => { if (typeof index === 'number') onCategoryClick(data[index].slug) }}
          >
            {data.map((entry) => (
              <Cell key={entry.slug} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
