import type { Category } from '@/lib/parsers/types'

const COLOR_CLASSES: Record<string, string> = {
  primary: 'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
  blue: 'bg-sky-100 text-sky-800',
  gold: 'bg-yellow-100 text-yellow-800',
  orange: 'bg-orange-100 text-orange-800',
  teal: 'bg-teal-100 text-teal-800',
  purple: 'bg-purple-100 text-purple-800',
  warning: 'bg-amber-100 text-amber-800',
  pink: 'bg-pink-100 text-pink-800',
}

type Props = {
  category: Category | null
  className?: string
}

export function CategoryBadge({ category, className = '' }: Props) {
  if (!category) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 ${className}`}
      >
        Uncategorised
      </span>
    )
  }

  const colorClass = COLOR_CLASSES[category.color] ?? 'bg-gray-100 text-gray-700'

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colorClass} ${className}`}
    >
      {category.name}
    </span>
  )
}
