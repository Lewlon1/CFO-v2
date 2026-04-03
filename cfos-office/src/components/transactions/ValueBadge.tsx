const VALUE_CONFIG: Record<string, { label: string; classes: string }> = {
  foundation: { label: 'Foundation', classes: 'bg-blue-100 text-blue-800' },
  investment: { label: 'Investment', classes: 'bg-green-100 text-green-800' },
  leak: { label: 'Leak', classes: 'bg-red-100 text-red-800' },
  burden: { label: 'Burden', classes: 'bg-amber-100 text-amber-800' },
  unsure: { label: 'Unsure', classes: 'bg-gray-100 text-gray-500' },
}

type Props = {
  valueCategory: string | null
  className?: string
}

export function ValueBadge({ valueCategory, className = '' }: Props) {
  const config = VALUE_CONFIG[valueCategory ?? 'unsure'] ?? VALUE_CONFIG.unsure
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.classes} ${className}`}
    >
      {config.label}
    </span>
  )
}
