'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { folderColors } from '@/lib/tokens'

const SEGMENT_LABELS: Record<string, string> = {
  office: 'Home',
  'cash-flow': 'Cash Flow',
  values: 'Values & You',
  'net-worth': 'Net Worth',
  scenarios: 'Scenario Planning',
  inbox: 'Inbox',
  'monthly-overview': 'Monthly overview',
  'spending-breakdown': 'Spending',
  trends: 'Trends',
  bills: 'Bills & Recurring',
  optimise: 'Optimise',
  transactions: 'Transactions',
  'value-split': 'Values breakdown',
  'the-gap': 'The Gap',
  portrait: 'Financial portrait',
  export: 'Export',
  'balance-sheet': 'Balance Sheet',
  assets: 'Assets',
  liabilities: 'Liabilities',
  'what-if': 'What If',
  trips: 'Trips',
}

const FOLDER_COLOR_MAP: Record<string, string> = {
  'cash-flow': folderColors.cashflow,
  values: folderColors.values,
  'net-worth': folderColors.networth,
  scenarios: folderColors.scenarios,
}

function getLabel(segment: string): string {
  return SEGMENT_LABELS[segment] ?? segment.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function getFolderColor(segments: string[]): string {
  const folderSegment = segments[1]
  return FOLDER_COLOR_MAP[folderSegment] ?? 'rgba(245,245,240,0.55)'
}

export function NavigationBar() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  // Home page (/office) — don't render
  if (segments.length <= 1) return null

  const parentPath = '/' + segments.slice(0, -1).join('/')
  const currentLabel = getLabel(segments[segments.length - 1])
  const isFolder = segments.length === 2
  const folderLabel = segments.length >= 2 ? getLabel(segments[1]) : ''
  const color = getFolderColor(segments)

  return (
    <nav
      className="flex items-center px-2.5 h-[42px] gap-1 shrink-0"
      aria-label="Navigation"
    >
      <Link
        href={parentPath}
        className="w-11 h-11 flex items-center justify-center"
        style={{ color }}
        aria-label={`Back to ${isFolder ? 'Home' : folderLabel}`}
      >
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <path
            d="M15 18l-6-6 6-6"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>

      {isFolder ? (
        <span
          className="text-[14px] font-bold tracking-[-0.01em] truncate"
          style={{ color }}
        >
          {currentLabel}
        </span>
      ) : (
        <span
          className="text-[14px] font-bold tracking-[-0.01em] truncate"
          style={{ color }}
        >
          {currentLabel}
        </span>
      )}
    </nav>
  )
}

export default NavigationBar
