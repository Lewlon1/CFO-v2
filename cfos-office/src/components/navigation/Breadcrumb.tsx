'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const SEGMENT_LABELS: Record<string, string> = {
  office: '~',
  'cash-flow': 'cash-flow',
  values: 'values',
  'net-worth': 'net-worth',
  scenarios: 'scenarios',
  inbox: 'inbox',
  'monthly-overview': 'monthly-overview',
  'spending-breakdown': 'spending-breakdown',
  trends: 'trends',
  bills: 'bills',
  optimise: 'optimise',
  transactions: 'transactions',
  'value-split': 'value-split',
  'the-gap': 'the-gap',
  portrait: 'portrait',
  export: 'export',
  'balance-sheet': 'balance-sheet',
  assets: 'assets',
  liabilities: 'liabilities',
  'what-if': 'what-if',
  trips: 'trips',
}

export function Breadcrumb() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  const crumbs = segments.map((segment, i) => {
    const href = '/' + segments.slice(0, i + 1).join('/')
    const label = SEGMENT_LABELS[segment] ?? segment
    const isLast = i === segments.length - 1
    return { href, label, isLast }
  })

  return (
    <nav
      className="flex items-center h-9 px-4 font-data text-xs text-office-text-muted border-b border-office-border-subtle shrink-0"
      aria-label="Breadcrumb"
    >
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center">
          {i > 0 && <span className="mx-1 text-office-text-muted">/</span>}
          {crumb.isLast ? (
            <span className="text-office-text-secondary">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="hover:text-office-text transition-colors">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}

export default Breadcrumb
