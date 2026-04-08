// Shared Zod schema for balance-sheet-document extraction.
//
// Used by both `balance-sheet-screenshot.ts` (image input) and
// `balance-sheet-pdf.ts` (text input). Keeps the shape identical across
// both input modes so the frontend preview can treat them the same way.

import { z } from 'zod'

export const balanceSheetDocumentSchema = z.object({
  document_type: z.enum([
    'investment_holdings',
    'pension_statement',
    'loan_statement',
    'savings_statement',
    'credit_card_statement',
    'unknown',
  ]),
  provider: z.string().nullable().describe('Platform or institution name if visible'),
  account_name: z.string().nullable().describe('Account name or label if visible'),
  currency: z.string().default('GBP').describe('Primary currency shown on the document'),

  holdings: z
    .array(
      z.object({
        name: z.string().describe('Fund, stock, or holding name'),
        ticker: z.string().nullable().describe('Ticker symbol if shown, otherwise null'),
        quantity: z.number().nullable().describe('Number of units/shares'),
        current_value: z.number().nullable().describe('Current market value'),
        cost_basis: z.number().nullable().describe('Amount originally invested'),
        gain_loss_pct: z.number().nullable().describe('Percentage gain/loss as shown'),
      })
    )
    .default([]),

  balance: z
    .object({
      outstanding_balance: z.number().nullable().describe('Current balance or amount owed'),
      interest_rate: z.number().nullable().describe('Interest rate or APR as a percentage'),
      credit_limit: z.number().nullable().describe('Credit limit (credit cards only)'),
      minimum_payment: z.number().nullable().describe('Minimum payment required'),
      monthly_payment: z.number().nullable().describe('Regular periodic payment amount'),
      remaining_term: z
        .string()
        .nullable()
        .describe('Remaining term as free text, e.g. "23 years 4 months"'),
    })
    .default({
      outstanding_balance: null,
      interest_rate: null,
      credit_limit: null,
      minimum_payment: null,
      monthly_payment: null,
      remaining_term: null,
    }),

  total_value: z.number().nullable().describe('Total portfolio/account value if shown as a summary'),

  confidence: z.enum(['high', 'medium', 'low']),
})

export type BalanceSheetDocument = z.infer<typeof balanceSheetDocumentSchema>

export const BALANCE_SHEET_EXTRACTION_PROMPT = `You are extracting financial information from a balance sheet document. This could be a portfolio statement, pension statement, savings account statement, mortgage statement, or credit card statement.

First, determine the document type:
- investment_holdings: portfolio/holdings report with stocks, funds, ETFs, bonds
- pension_statement: pension/retirement account statement
- loan_statement: mortgage or personal loan statement
- savings_statement: savings or deposit account statement
- credit_card_statement: credit card statement or balance summary
- unknown: not a recognisable financial document

For investment or pension documents: extract EACH individual holding into the holdings array.
For savings, loan, or credit card documents: extract the account balance and terms into the balance object and leave holdings empty.

Numeric rules:
- Convert European comma-decimal format to standard: "1.234,56" → 1234.56
- Convert prices expressed in pence to pounds if the context makes that clear
- Strip currency symbols; return bare numbers
- Interest rates are percentages (return 4.5 not 0.045)

If the document is not a financial document, set document_type to "unknown" and leave everything else empty. Set confidence to "low" if the image or text is unclear.`
