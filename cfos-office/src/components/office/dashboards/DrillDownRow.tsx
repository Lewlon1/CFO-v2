import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

interface DrillDownRowProps {
  title: string
  subtitle?: string
  href: string
  icon?: string
  accentColor?: string
}

export function DrillDownRow({ title, subtitle, href, icon, accentColor }: DrillDownRowProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 min-h-[48px] px-[14px] py-3 rounded-[10px] border border-[rgba(255,255,255,0.04)] bg-bg-card transition-colors hover:bg-[rgba(255,255,255,0.03)] active:bg-bg-inset"
    >
      {icon && (
        <span
          className="text-[12px] w-4 text-center shrink-0"
          style={{ color: accentColor ?? 'var(--text-tertiary)' }}
        >
          {icon}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <span className="block text-[13px] font-semibold text-text-primary">{title}</span>
        {subtitle && (
          <span className="block text-[11px] text-text-tertiary mt-[2px]">{subtitle}</span>
        )}
      </div>
      <ChevronRight size={14} className="text-text-muted shrink-0" strokeWidth={1.5} />
    </Link>
  )
}

export default DrillDownRow
