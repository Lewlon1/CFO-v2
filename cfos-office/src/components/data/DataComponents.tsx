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
  const chevronBtn = 'w-7 h-7 rounded-control flex items-center justify-center text-text-tertiary'
  return (
    <div className="flex items-center justify-center gap-3.5 mb-3">
      <button
        onClick={onPrev}
        className={chevronBtn}
        style={{ backgroundColor: 'var(--muted)' }}
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
          <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span className="font-data text-[11px] text-text-secondary min-w-[70px] text-center">
        {label}
      </span>
      <button
        onClick={onNext}
        className={chevronBtn}
        style={{ backgroundColor: 'var(--muted)' }}
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none">
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
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
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <div
        className="w-7 h-7 rounded-control flex items-center justify-center text-[12px] shrink-0"
        style={{ backgroundColor: iconBg, color: iconColor }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium truncate">{merchant}</div>
        <div className="font-data text-[8px] text-text-muted mt-[2px]">
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
              ? 'bg-accent text-text-primary'
              : 'bg-transparent text-text-tertiary'
          }`}
          style={{ border: `1px solid ${opt.id === activeId ? 'var(--border)' : 'var(--border-medium)'}` }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ============================================================
// SectionTitle
// ============================================================
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold text-text-muted tracking-[0.04em] uppercase mt-3 mb-1.5">
      {children}
    </div>
  )
}
