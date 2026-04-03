import type { TransactionType } from "@/lib/types/database"
import type { SemanticField } from "./column-detector"

export type ColumnMapping = Record<string, SemanticField>

export type TransformedRow = {
  transaction_date: string
  amount: number
  description: string | null
  merchant: string | null
  type: TransactionType
  currency: string
  raw_category?: string
  parseError?: string
  category_name?: string
  category_id?: string | null
}

/**
 * Transforms a raw CSV row into a shape ready for Supabase insert.
 */
export function transformRow(
  row: Record<string, string>,
  mapping: ColumnMapping,
  defaultCurrency: string
): TransformedRow {
  // Build a reverse lookup: semanticField → raw column value
  const get = (field: SemanticField): string => {
    const col = Object.entries(mapping).find(([, v]) => v === field)?.[0]
    return col ? (row[col]?.trim() ?? "") : ""
  }

  const rawDate = get("date")
  const rawAmount = get("amount")
  const rawType = get("type")

  const transaction_date = parseDate(rawDate)
  const rawAmountNum = parseAmount(rawAmount)
  const type = inferType(rawType, rawAmountNum)

  let parseError: string | undefined
  if (!transaction_date) parseError = `Could not parse date: "${rawDate}"`
  if (isNaN(rawAmountNum)) parseError = `Could not parse amount: "${rawAmount}"`

  const rawCategory = get("category")

  return {
    transaction_date: transaction_date || rawDate,
    amount: Math.abs(rawAmountNum),
    description: get("description") || null,
    merchant: get("merchant") || null,
    type,
    currency: get("currency") || defaultCurrency,
    raw_category: rawCategory || undefined,
    parseError,
  }
}

function parseDate(raw: string): string {
  if (!raw) return ""
  // ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const m = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/)
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
  }
  // MM/DD/YYYY (US format) — try if month > 12 fails
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3]
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`
  }
  return ""
}

function parseAmount(raw: string): number {
  if (!raw) return NaN
  // Remove currency symbols and whitespace
  let cleaned = raw.replace(/[^\d,.\-+]/g, "").trim()
  // Handle European format: 1.234,56 → 1234.56
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".")
  } else {
    // Handle comma as decimal separator: 1234,56 → 1234.56
    cleaned = cleaned.replace(",", ".")
  }
  return parseFloat(cleaned)
}

function inferType(rawType: string, amount: number): TransactionType {
  const lower = rawType.toLowerCase()
  if (
    lower.includes("ingreso") ||
    lower.includes("income") ||
    lower.includes("credit") ||
    lower.includes("abono") ||
    lower.includes("salary") ||
    lower.includes("salario")
  )
    return "income"
  if (
    lower.includes("transferencia") ||
    lower.includes("transfer") ||
    lower.includes("traspaso")
  )
    return "transfer"
  if (
    lower.includes("gasto") ||
    lower.includes("expense") ||
    lower.includes("debit") ||
    lower.includes("cargo") ||
    lower.includes("pago")
  )
    return "expense"
  // Fallback: sign-based inference
  return amount < 0 ? "expense" : "income"
}
