'use client'

import { ValuePill } from './ValuePill'
import type { ValueCategory } from '@/lib/tokens'

// ============================================================
// MonthSelector
// ============================================================
interface MonthSelectorProps {
  label: string
  onPrev?: () => void
  onNext?: () => void
}

export function MonthSelector({ label, onPrev, onNext }: MonthSelectorProps) {
  const chevronBtn = 'w-7 h-7 rounded-[6px] flex items-center justify-center text-[rgba(245,245,240,0.3)]'
  return (
    <div className="flex items-center justify-center gap-3.5 mb-3">
      <button
        onClick={onPrev}
        className={chevronBtn}
        style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
          <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span className="font-data text-[11px] text-[rgba(245,245,240,0.6)] min-w-[70px] text-center">
        {label}
      </span>
      <button
        onClick={onNext}
        className={chevronBtn}
        style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}

// ============================================================
// CategoryBar
// ============================================================
interface CategoryBarProps {
  icon: string
  name: string
  amount: string
  percentage: string
  barWidth: number
  color?: string
}

export function CategoryBar({ icon, name, amount, percentage, barWidth, color = '#22C55E' }: CategoryBarProps) {
  return (
    <div
      className="flex items-center gap-2 py-2"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
    >
      <div className="w-4 text-center text-[13px] shrink-0">{icon}</div>
      <div className="flex-1">
        <div className="text-[11px] font-semibold">{name}</div>
        <div
          className="h-[5px] rounded-[2.5px] mt-[3px] overflow-hidden"
          style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
        >
          <div
            className="h-full rounded-[2.5px]"
            style={{ width: `${barWidth}%`, backgroundColor: color }}
          />
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-data text-[11px] font-medium">{amount}</div>
        <div className="font-data text-[8px] text-[rgba(245,245,240,0.3)]">{percentage}</div>
      </div>
    </div>
  )
}

// ============================================================
// TransactionRow
// ============================================================
interface TransactionRowProps {
  icon: string
  iconBg: string
  iconColor: string
  merchant: string
  time: string
  category: string
  amount: string
  valueCategory: ValueCategory
  onValueChange?: (newCategory: ValueCategory) => void
}

export function TransactionRow({
  icon, iconBg, iconColor, merchant, time, category,
  amount, valueCategory, onValueChange,
}: TransactionRowProps) {
  return (
    <div
      className="flex items-center gap-2 py-2.5"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
    >
      <div
        className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[12px] shrink-0"
        style={{ backgroundColor: iconBg, color: iconColor }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium truncate">{merchant}</div>
        <div className="font-data text-[8px] text-[rgba(245,245,240,0.22)] mt-[2px]">
          {time} · {category}
        </div>
      </div>
      <div className="text-right">
        <div className="font-data text-[12px] font-medium">{amount}</div>
        <ValuePill category={valueCategory} onChange={onValueChange} />
      </div>
    </div>
  )
}

// ============================================================
// FilterPills
// ============================================================
interface FilterPillsProps {
  options: { id: string; label: string }[]
  activeId: string
  onChange?: (id: string) => void
}

export function FilterPills({ options, activeId, onChange }: FilterPillsProps) {
  return (
    <div className="flex gap-[5px] mb-2.5 overflow-x-auto pb-[2px]">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange?.(opt.id)}
          className={`font-data text-[9px] py-[5px] px-[9px] rounded-xl whitespace-nowrap cursor-pointer transition-colors ${
            opt.id === activeId
              ? 'bg-[rgba(255,255,255,0.06)] text-[#F5F5F0]'
              : 'bg-transparent text-[rgba(245,245,240,0.4)]'
          }`}
          style={{ border: `1px solid ${opt.id === activeId ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)'}` }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ============================================================
// ProvenanceLine
// ============================================================
interface ProvenanceLineProps {
  text: string
}

export function ProvenanceLine({ text }: ProvenanceLineProps) {
  return (
    <div className="font-data text-[7px] text-[rgba(245,245,240,0.14)] flex items-center gap-[3px] mt-1">
      <div className="w-[3px] h-[3px] rounded-full bg-[rgba(245,245,240,0.1)]" />
      {text}
    </div>
  )
}

// ============================================================
// FileRow
// ============================================================
interface FileRowProps {
  icon: string
  label: string
  type: string
  color: string
  onClick?: () => void
}

export function FileRow({ icon, label, type, color, onClick }: FileRowProps) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-2.5 p-3 rounded-[10px] mb-1.5 min-h-[48px] cursor-pointer active:bg-[rgba(255,255,255,0.03)] transition-colors"
      style={{ border: '1px solid rgba(255,255,255,0.04)' }}
    >
      <div className="w-4 text-center text-[12px] shrink-0" style={{ color }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold">{label}</div>
        <div className="font-data text-[8px] text-[rgba(245,245,240,0.25)] mt-[1px]">{type}</div>
      </div>
      <div className="text-[rgba(245,245,240,0.12)] text-[13px]">&rsaquo;</div>
    </div>
  )
}

// ============================================================
// GapCard
// ============================================================
interface GapCardProps {
  belief: string
  reality: string
  status: 'aligned' | 'gap' | 'eliminated' | 'partial'
}

const statusStyles = {
  aligned:    { bg: 'rgba(34,197,94,0.12)', color: '#22C55E', cardBg: 'rgba(34,197,94,0.02)' },
  gap:        { bg: 'rgba(243,63,94,0.12)', color: '#F43F5E', cardBg: 'rgba(243,63,94,0.02)' },
  eliminated: { bg: 'rgba(34,197,94,0.12)', color: '#22C55E', cardBg: 'rgba(34,197,94,0.02)' },
  partial:    { bg: 'rgba(232,168,76,0.12)', color: '#E8A84C', cardBg: 'rgba(232,168,76,0.02)' },
}

export function GapCard({ belief, reality, status }: GapCardProps) {
  const s = statusStyles[status]
  return (
    <div
      className="rounded-[10px] p-3 mb-2"
      style={{ backgroundColor: s.cardBg, border: '1px solid rgba(255,255,255,0.04)' }}
    >
      <div className="text-[11px] text-[rgba(245,245,240,0.45)] mb-[5px] leading-[1.5]">
        {belief}
      </div>
      <div className="text-[12px] leading-[1.55] text-[rgba(245,245,240,0.7)]">
        {reality}
      </div>
      <span
        className="font-data text-[7px] px-[7px] py-[3px] rounded tracking-[0.06em] uppercase inline-block mt-1.5"
        style={{ backgroundColor: s.bg, color: s.color }}
      >
        {status}
      </span>
    </div>
  )
}

// ============================================================
// SectionTitle
// ============================================================
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold text-[rgba(245,245,240,0.25)] tracking-[0.04em] uppercase mt-3 mb-1.5">
      {children}
    </div>
  )
}
