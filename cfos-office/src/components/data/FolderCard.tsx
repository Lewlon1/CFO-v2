'use client'

import Link from 'next/link'

interface FolderCardProps {
  icon: string
  name: string
  color: string
  subtitle: string
  href: string
  children: React.ReactNode
}

export function FolderCard({ icon, name, color, subtitle, href, children }: FolderCardProps) {
  return (
    <div className="mb-6">
      {/* Tab */}
      <div
        className="inline-flex items-center gap-1.5 py-[5px] px-3 rounded-t-lg text-[13px] font-bold ml-3 mb-[-1px] relative z-[1]"
        style={{ backgroundColor: `${color}12`, color }}
      >
        <span className="text-[14px]">{icon}</span> {name}
      </div>

      {/* Card body */}
      <div
        className="p-3.5 rounded-[4px_14px_14px_14px]"
        style={{
          backgroundColor: 'rgba(255,255,255,0.015)',
          border: '1px solid rgba(255,255,255,0.04)',
          borderLeft: `2px solid ${color}33`,
        }}
      >
        <div className="text-[10px] text-[rgba(245,245,240,0.3)] mb-2.5">
          {subtitle}
        </div>

        {children}

        <Link
          href={href}
          className="flex items-center justify-end gap-1 text-[11px] font-semibold pt-2.5 mt-2.5 no-underline"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.03)',
            color,
          }}
        >
          Open {name} <span style={{ opacity: 0.5 }}>&rsaquo;</span>
        </Link>
      </div>
    </div>
  )
}

export function FolderMetric({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5 mb-1">
      <span
        className="font-data text-[16px] font-extrabold tracking-[-0.03em]"
        style={{ color: color || '#F5F5F0' }}
      >
        {value}
      </span>
      <span className="text-[11px] text-[rgba(245,245,240,0.3)]">{label}</span>
    </div>
  )
}
