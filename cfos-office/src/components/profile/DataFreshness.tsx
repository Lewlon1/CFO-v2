'use client'

interface DataFreshnessProps {
  monthsCovered: number
  latestMonth: string | null
  totalTransactions: number
}

export function DataFreshness({ monthsCovered, latestMonth, totalTransactions }: DataFreshnessProps) {
  if (totalTransactions === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="w-2 h-2 rounded-full bg-gray-400" />
        <span>No transaction data yet</span>
      </div>
    )
  }

  const freshnessLabel = `Based on ${monthsCovered} month${monthsCovered !== 1 ? 's' : ''} of data`

  const latestLabel = latestMonth
    ? new Date(latestMonth).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : null

  const now = new Date()
  const latestDate = latestMonth ? new Date(latestMonth) : null
  const monthsStale = latestDate
    ? (now.getFullYear() - latestDate.getFullYear()) * 12 + (now.getMonth() - latestDate.getMonth())
    : Infinity

  const dotColor = monthsStale <= 2 ? 'bg-green-500' : monthsStale <= 4 ? 'bg-amber-500' : 'bg-gray-400'

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
      <div className={`w-2 h-2 rounded-full ${dotColor}`} />
      <span>{freshnessLabel}</span>
      {latestLabel && <span>· Latest: {latestLabel}</span>}
      <span>· {totalTransactions.toLocaleString()} transactions</span>
    </div>
  )
}
