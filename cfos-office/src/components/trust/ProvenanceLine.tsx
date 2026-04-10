const SOURCE_LABELS: Record<string, string> = {
  revolut_csv: 'Revolut',
  csv_revolut: 'Revolut',
  csv_santander: 'Santander',
  csv_monzo: 'Monzo',
  csv_starling: 'Starling',
  csv_hsbc: 'HSBC',
  csv_barclays: 'Barclays',
  csv_generic: 'CSV',
  screenshot: 'Screenshot',
  manual: 'Manual',
}

function formatRelativeDate(date: string): string {
  const now = new Date()
  const then = new Date(date)
  const diffMs = now.getTime() - then.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7)
    return `${weeks}w ago`
  }
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

interface ProvenanceLineProps {
  transactionCount: number
  source?: string | null
  uploadDate?: string | null
}

export function ProvenanceLine({ transactionCount, source, uploadDate }: ProvenanceLineProps) {
  const parts: string[] = [`${transactionCount} transactions`]

  if (source) {
    parts.push(SOURCE_LABELS[source] ?? source)
  }

  if (uploadDate) {
    parts.push(`uploaded ${formatRelativeDate(uploadDate)}`)
  }

  return (
    <p className="font-data text-xs text-office-text-muted">
      {parts.join(' \u00b7 ')}
    </p>
  )
}

export default ProvenanceLine
