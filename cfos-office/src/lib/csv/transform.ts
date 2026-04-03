import type { SemanticField } from './column-detector'

export type ColumnMapping = Record<string, SemanticField>

export type TransformedRow = {
  date: string         // ISO YYYY-MM-DD or raw if unparseable
  amount: number       // SIGNED: negative = expense, positive = income
  description: string  // description or merchant text
  currency: string
  parseError?: string
}

export function transformRow(
  row: Record<string, string>,
  mapping: ColumnMapping,
  defaultCurrency: string
): TransformedRow {
  const get = (field: SemanticField): string => {
    const col = Object.entries(mapping).find(([, v]) => v === field)?.[0]
    return col ? (row[col]?.trim() ?? '') : ''
  }

  const rawDate = get('date')
  const rawAmount = get('amount')
  const rawType = get('type')
  const descText = get('description') || get('merchant') || ''

  const date = parseDate(rawDate)
  const rawNum = parseAmount(rawAmount)
  const amount = applySign(rawNum, rawType)

  let parseError: string | undefined
  if (!date) parseError = `Could not parse date: "${rawDate}"`
  if (isNaN(rawNum)) parseError = `Could not parse amount: "${rawAmount}"`

  return {
    date: date || rawDate,
    amount,
    description: descText,
    currency: get('currency') || defaultCurrency,
    parseError,
  }
}

function parseDate(raw: string): string {
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  const m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/)
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return ''
}

function parseAmount(raw: string): number {
  if (!raw) return NaN
  let cleaned = raw.replace(/[^\d,.\-+]/g, '').trim()
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  } else {
    cleaned = cleaned.replace(',', '.')
  }
  return parseFloat(cleaned)
}

function applySign(amount: number, rawType: string): number {
  if (isNaN(amount)) return NaN
  const lower = rawType.toLowerCase()
  const isIncome =
    lower.includes('ingreso') || lower.includes('income') ||
    lower.includes('credit') || lower.includes('abono') ||
    lower.includes('salary') || lower.includes('salario')
  const isExpense =
    lower.includes('gasto') || lower.includes('expense') ||
    lower.includes('debit') || lower.includes('cargo') || lower.includes('pago')
  if (isIncome) return Math.abs(amount)
  if (isExpense) return -Math.abs(amount)
  return amount
}
