const VALUE_CONFIG: Record<string, { label: string; classes: string }> = {
  foundation: { label: 'Foundation', classes: 'bg-blue-100 text-blue-800' },
  investment: { label: 'Investment', classes: 'bg-green-100 text-green-800' },
  leak: { label: 'Leak', classes: 'bg-red-100 text-red-800' },
  burden: { label: 'Burden', classes: 'bg-amber-100 text-amber-800' },
  no_idea: { label: 'No Idea', classes: 'bg-gray-100 text-gray-500' },
}

type Props = {
  valueCategory: string | null
  confidence?: number | null
  className?: string
}

export function ValueBadge({ valueCategory, confidence, className = '' }: Props) {
  const config = VALUE_CONFIG[valueCategory ?? 'no_idea'] ?? VALUE_CONFIG.no_idea
  const conf = confidence ?? 0

  // Confidence indicators:
  // >= 0.8 → solid (no indicator)
  // 0.5–0.8 → show "?" suffix
  // < 0.5 → dashed border
  const isUncertain = conf > 0 && conf < 0.8
  const isDashed = conf < 0.5
  const showQuestion = conf >= 0.5 && conf < 0.8

  const borderStyle = isDashed ? 'border border-dashed border-current' : ''

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium ${config.classes} ${borderStyle} ${className}`}
      title={isUncertain ? `Confidence: ${Math.round(conf * 100)}%` : undefined}
    >
      {config.label}
      {showQuestion && <span className="opacity-60">?</span>}
    </span>
  )
}
