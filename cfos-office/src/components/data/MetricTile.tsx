'use client'

interface MetricTileProps {
  label: string
  value: string
  color?: string
  trend?: string
  trendColor?: string
}

export function MetricTile({ label, value, color, trend, trendColor }: MetricTileProps) {
  return (
    <div
      className="rounded-lg p-2.5"
      style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}
    >
      <div className="text-[9px] text-[rgba(245,245,240,0.3)] mb-[3px]">
        {label}
      </div>
      <div
        className="font-data text-[16px] font-extrabold tracking-[-0.03em]"
        style={{ color: color || '#F5F5F0' }}
      >
        {value}
      </div>
      {trend && (
        <div
          className="font-data text-[8px] mt-[2px]"
          style={{ color: trendColor || 'rgba(34,197,94,0.5)' }}
        >
          {trend}
        </div>
      )}
    </div>
  )
}
