import type { SemanticField } from './column-detector'

export type ColumnMapping = Record<string, SemanticField>

export type TransformedRow = {
  date: string         // ISO 8601 — "YYYY-MM-DDTHH:mm:ssZ" when source has time, else "YYYY-MM-DDT00:00:00Z" (or raw if unparseable)
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
  const amount = applySign(rawNum, rawType, rawAmount)

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
  // Preserve time-of-day when the source includes it. Required so contextual
  // value rules (e.g. "Aldi after 6pm = Leak") have something to match against.
  // ISO 8601 with time: "2026-01-15 14:23:00" or "2026-01-15T14:23:00" (± seconds)
  const isoWithTime = raw.match(/^(\d{4}-\d{2}-\d{2})[\sT](\d{2}:\d{2}(?::\d{2})?)/)
  if (isoWithTime) {
    const time = isoWithTime[2].length === 5 ? `${isoWithTime[2]}:00` : isoWithTime[2]
    return `${isoWithTime[1]}T${time}Z`
  }
  // ISO date-only
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return `${raw.slice(0, 10)}T00:00:00Z`
  // DD/MM/YYYY (or DD-MM-YYYY / DD.MM.YYYY) optionally followed by HH:mm[:ss]
  const dmy = raw.match(
    /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})(?:[\sT](\d{2}:\d{2}(?::\d{2})?))?/
  )
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]
    const datePart = `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
    if (dmy[4]) {
      const time = dmy[4].length === 5 ? `${dmy[4]}:00` : dmy[4]
      return `${datePart}T${time}Z`
    }
    return `${datePart}T00:00:00Z`
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

function applySign(amount: number, rawType: string, rawAmount: string): number {
  if (isNaN(amount)) return NaN
  const lower = rawType.toLowerCase()
  // Widened keyword set — previous version missed common English variants
  // (withdrawal, outgoing, purchase, deposit, received, sent) which made a
  // populated Type column functionally useless and let debits persist as
  // positive magnitudes downstream.
  const isIncome =
    lower.includes('ingreso') || lower.includes('income') ||
    lower.includes('credit') || lower.includes('abono') ||
    lower.includes('salary') || lower.includes('salario') ||
    lower.includes('deposit') || lower.includes('incoming') ||
    lower.includes('received') || lower.includes('refund') ||
    lower.includes('money in')
  const isExpense =
    lower.includes('gasto') || lower.includes('expense') ||
    lower.includes('debit') || lower.includes('cargo') || lower.includes('pago') ||
    lower.includes('withdrawal') || lower.includes('outgoing') ||
    lower.includes('purchase') || lower.includes('payment') ||
    lower.includes('sent') || lower.includes('money out')
  // CFO convention: debits negative, credits positive.
  if (isIncome) return Math.abs(amount)
  if (isExpense) return -Math.abs(amount)
  // No type hint matched. If the source amount string itself carries an
  // explicit sign (leading '-' or parenthesised accounting notation like
  // "(42.00)"), honour it. parseFloat preserves a leading '-' but strips
  // parentheses, so detect parens separately on the raw string.
  const trimmed = rawAmount.trim()
  const parenNegative = /^\(.*\)$/.test(trimmed)
  if (parenNegative) return -Math.abs(amount)
  // Explicit leading '-' or '+' already flows through parseFloat into
  // `amount`. When neither a type nor a signed amount is available we have
  // no way to infer direction — return as-is and rely on the caller (or a
  // downstream reviewer) to flag the file. CFO convention can't be enforced
  // without at least one of: signed amount column, type column, or split
  // debit/credit columns.
  return amount
}
