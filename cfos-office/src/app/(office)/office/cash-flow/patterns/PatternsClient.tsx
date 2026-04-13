'use client'

type Pattern = {
  id: string
  name: string
  amount: number
  currency: string
  frequency: string | null
  billing_day: number | null
  category_id: string | null
}

function formatCurrency(amount: number, currency?: string): string {
  const c = currency || 'EUR'
  const symbol = c === 'EUR' ? '€' : c === 'GBP' ? '£' : c === 'USD' ? '$' : c
  return `${symbol}${Math.abs(amount).toLocaleString('en', { maximumFractionDigits: 2 })}`
}

function formatFrequency(freq: string | null): string {
  if (!freq) return ''
  const labels: Record<string, string> = {
    weekly: '~weekly',
    'bi-weekly': '~every 2 weeks',
    monthly: '~monthly',
    'bi-monthly': '~every 2 months',
    quarterly: '~quarterly',
    annual: '~annual',
    irregular: 'irregular',
  }
  return labels[freq] || freq
}

function capitaliseName(name: string): string {
  return name
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function PatternsClient({ patterns }: { patterns: Pattern[] }) {
  if (patterns.length === 0) {
    return (
      <div className="p-4 md:p-8 max-w-2xl mx-auto">
        <h1 className="text-xl font-semibold text-foreground mb-1">Spending Patterns</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Merchants you visit regularly
        </p>
        <div className="text-center py-16">
          <p className="text-3xl mb-3">📊</p>
          <p className="text-sm text-muted-foreground">
            No spending patterns detected yet. Upload more transactions to see your habits.
          </p>
        </div>
      </div>
    )
  }

  const monthlyTotal = patterns.reduce((sum, p) => {
    const amt = Math.abs(p.amount)
    if (p.frequency === 'weekly') return sum + amt * 4.33
    if (p.frequency === 'bi-weekly') return sum + amt * 2.17
    if (p.frequency === 'bi-monthly' || p.frequency === 'quarterly') return sum + amt / 2
    if (p.frequency === 'annual') return sum + amt / 12
    return sum + amt
  }, 0)

  const currency = patterns[0]?.currency || 'EUR'

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Spending Patterns</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {patterns.length} regular habit{patterns.length !== 1 ? 's' : ''} totalling ~{formatCurrency(monthlyTotal, currency)}/mo
        </p>
      </div>

      <div className="space-y-2">
        {patterns.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between px-4 py-3 bg-card border border-border rounded-xl"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {capitaliseName(p.name)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatFrequency(p.frequency)}
              </p>
            </div>
            <p className="text-sm font-medium text-foreground flex-shrink-0 ml-3">
              {formatCurrency(p.amount, p.currency)}
            </p>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        These are places you visit regularly — not bills you can switch or cancel.
      </p>
    </div>
  )
}
