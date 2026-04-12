'use client'

// ============================================================
// WeeklyTrend — bar chart with average line
// In production, replace with Recharts BarChart + ReferenceLine
// ============================================================
interface WeeklyTrendProps {
  weeks: { label: string; value: number }[]
  average: number
  color?: string
  formatAvg?: (v: number) => string
}

export function WeeklyTrend({
  weeks,
  average,
  color = '#22C55E',
  formatAvg = (v) => `avg \u20AC${v}/wk`,
}: WeeklyTrendProps) {
  const max = Math.max(...weeks.map((w) => w.value))
  const avgPct = max > 0 ? (average / max) * 100 : 0

  return (
    <div>
      <div className="relative" style={{ height: 70, marginBottom: 4 }}>
        {/* Bars */}
        <div className="flex items-end gap-1 h-full relative z-[2]">
          {weeks.map((w, i) => {
            const pct = max > 0 ? (w.value / max) * 100 : 0
            return (
              <div
                key={i}
                className="flex-1 rounded-t-[3px]"
                style={{
                  height: `${pct}%`,
                  backgroundColor: color,
                  opacity: 0.6 + (pct / 100) * 0.4,
                }}
              />
            )
          })}
        </div>

        {/* Average line */}
        <div
          className="absolute left-0 right-0 z-[3]"
          style={{
            bottom: `${avgPct}%`,
            borderTop: '1.5px dashed rgba(232,168,76,0.4)',
          }}
        />
        <div
          className="absolute right-0 z-[4] font-data text-[8px]"
          style={{
            bottom: `calc(${avgPct}% + 2px)`,
            color: 'rgba(232,168,76,0.5)',
          }}
        >
          {formatAvg(average)}
        </div>
      </div>

      {/* Week labels */}
      <div className="flex gap-1 font-data text-[7px] text-[rgba(245,245,240,0.15)] mb-3.5">
        {weeks.map((w, i) => (
          <span key={i} className="flex-1 text-center">
            {w.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ============================================================
// ValueRing — donut chart for F/B/I/L proportions
// In production, replace with Recharts PieChart
// ============================================================
interface ValueRingProps {
  foundation: number
  investment: number
  leak: number
  burden: number
  centerValue?: string
  centerLabel?: string
  size?: number
}

export function ValueRing({
  foundation,
  investment,
  leak,
  burden,
  centerValue = '',
  centerLabel = '',
  size = 120,
}: ValueRingProps) {
  const total = foundation + investment + leak + burden
  const r = 15.9

  const segments = [
    { pct: (foundation / total) * 100, color: '#22C55E' },
    { pct: (investment / total) * 100, color: '#3B82F6' },
    { pct: (leak / total) * 100, color: '#F43F5E' },
    { pct: (burden / total) * 100, color: '#8B5CF6' },
  ]

  let offset = 25

  return (
    <div style={{ textAlign: 'center' }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 42 42"
        style={{ display: 'block', margin: '0 auto 6px' }}
      >
        {/* Background ring */}
        <circle
          cx={21} cy={21} r={r}
          fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={4}
        />

        {/* Segment rings */}
        {segments.map((seg, i) => {
          const dashArray = `${seg.pct} ${100 - seg.pct}`
          const dashOffset = offset
          offset -= seg.pct
          return (
            <circle
              key={i}
              cx={21} cy={21} r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={4}
              strokeDasharray={dashArray}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
            />
          )
        })}

        {/* Center text */}
        {centerValue && (
          <text
            x={21} y={20} textAnchor="middle"
            fill="rgba(245,245,240,0.6)"
            fontFamily="JetBrains Mono"
            fontSize={4.5} fontWeight={500}
          >
            {centerValue}
          </text>
        )}
        {centerLabel && (
          <text
            x={21} y={25} textAnchor="middle"
            fill="rgba(245,245,240,0.2)"
            fontFamily="JetBrains Mono"
            fontSize={2.5}
          >
            {centerLabel}
          </text>
        )}
      </svg>
    </div>
  )
}
