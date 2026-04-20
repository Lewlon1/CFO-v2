export interface CsvSummary {
  transactionCount: number
  dateRange: { from: string; to: string }
  incomeTotal: number
  spendingTotal: number
  currency: string
  topMerchants: { description: string; total: number; count: number }[]
  allNumbersMentioned: Set<number>
  asText: () => string
}

interface ParsedRow {
  date: string
  description: string
  amount: number
}

function parseCsv(content: string): ParsedRow[] {
  const lines = content.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  const header = lines[0].toLowerCase().split(',').map((h) => h.trim())
  const dateIdx = header.findIndex((h) => h.includes('date'))
  const descIdx = header.findIndex((h) => h === 'description' || h === 'desc')
  const amountIdx = header.findIndex((h) => h === 'amount')

  if (dateIdx < 0 || descIdx < 0 || amountIdx < 0) {
    // Fall back to positional: type,date,desc,amount,...
    return lines.slice(1).map((line) => {
      const cols = line.split(',').map((c) => c.trim())
      return {
        date: cols[1] ?? '',
        description: cols[2] ?? '',
        amount: Number(cols[3]),
      }
    }).filter((r) => Number.isFinite(r.amount))
  }

  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim())
    return {
      date: cols[dateIdx],
      description: cols[descIdx],
      amount: Number(cols[amountIdx]),
    }
  }).filter((r) => Number.isFinite(r.amount))
}

export function summariseCsv(content: string, currency: string): CsvSummary {
  const rows = parseCsv(content)
  let income = 0
  let spending = 0
  const byMerchant = new Map<string, { total: number; count: number }>()
  const numbers = new Set<number>()

  let minDate = ''
  let maxDate = ''

  for (const r of rows) {
    if (r.amount > 0) income += r.amount
    else spending += Math.abs(r.amount)

    numbers.add(Math.abs(Math.round(r.amount * 100) / 100))

    const key = r.description.trim()
    if (!key) continue
    const current = byMerchant.get(key) ?? { total: 0, count: 0 }
    current.total += Math.abs(r.amount)
    current.count += 1
    byMerchant.set(key, current)

    if (!minDate || r.date < minDate) minDate = r.date
    if (!maxDate || r.date > maxDate) maxDate = r.date
  }

  const topMerchants = Array.from(byMerchant.entries())
    .map(([description, v]) => ({ description, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15)

  return {
    transactionCount: rows.length,
    dateRange: { from: minDate, to: maxDate },
    incomeTotal: Math.round(income * 100) / 100,
    spendingTotal: Math.round(spending * 100) / 100,
    currency,
    topMerchants,
    allNumbersMentioned: numbers,
    asText: () => {
      const lines = [
        `${rows.length} transactions from ${minDate} to ${maxDate}`,
        `Total income: ${currency} ${Math.round(income * 100) / 100}`,
        `Total spending: ${currency} ${Math.round(spending * 100) / 100}`,
        `Top merchants by spend:`,
        ...topMerchants.slice(0, 12).map(
          (m) => `  - ${m.description}: ${currency} ${Math.round(m.total * 100) / 100} across ${m.count} txns`,
        ),
      ]
      return lines.join('\n')
    },
  }
}
