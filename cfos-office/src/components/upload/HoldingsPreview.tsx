'use client'

// Preview + confirm UI for balance-sheet uploads (Session 19B).
//
// Two modes:
//   1. Holdings — user uploaded a portfolio CSV or a multi-position
//      screenshot. Shows an editable table and, on confirm, creates a
//      parent `assets` row + many `investment_holdings` rows.
//   2. Single balance — user uploaded a savings / mortgage / credit card
//      statement. Shows a single editable form and, on confirm, creates
//      one `assets` or `liabilities` row.

import { useMemo, useState } from 'react'
import type { ParsedHolding } from '@/lib/parsers/types'
import type {
  ConfirmedBalanceSheetImport,
  BalanceSheetSource,
} from '@/lib/upload/balance-sheet-import'

// Matches the schema used by the screenshot / PDF extractors.
type BalanceSheetExtraction = {
  document_type:
    | 'investment_holdings'
    | 'pension_statement'
    | 'loan_statement'
    | 'savings_statement'
    | 'credit_card_statement'
    | 'unknown'
  provider: string | null
  account_name: string | null
  currency: string
  holdings: Array<{
    name: string
    ticker: string | null
    quantity: number | null
    current_value: number | null
    cost_basis: number | null
    gain_loss_pct: number | null
  }>
  balance: {
    outstanding_balance: number | null
    interest_rate: number | null
    credit_limit: number | null
    minimum_payment: number | null
    monthly_payment: number | null
    remaining_term: string | null
  }
  total_value: number | null
  confidence: 'high' | 'medium' | 'low'
}

type Props = {
  // CSV path
  holdings?: ParsedHolding[]
  suggestedAssetName?: string | null
  suggestedProvider?: string | null
  // Screenshot / PDF path
  screenshotData?: BalanceSheetExtraction
  source: BalanceSheetSource
  onConfirm: (payload: ConfirmedBalanceSheetImport) => Promise<void> | void
  onCancel: () => void
  isImporting?: boolean
}

type HoldingsAssetType = 'stocks' | 'bonds' | 'pension' | 'crypto'
const SINGLE_ASSET_TYPES = ['savings', 'stocks', 'pension', 'property', 'other'] as const
const LIABILITY_TYPES = [
  'mortgage',
  'student_loan',
  'credit_card',
  'personal_loan',
  'car_finance',
  'bnpl',
  'overdraft',
  'other',
] as const

function currencySymbol(code: string): string {
  const up = code.toUpperCase()
  if (up === 'GBP') return '£'
  if (up === 'EUR') return '€'
  if (up === 'USD') return '$'
  return up + ' '
}

function formatMoney(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return currencySymbol(currency) + n.toLocaleString('en-GB', { maximumFractionDigits: 2 })
}

// Decide which shape the incoming data is (holdings vs single balance).
function deriveMode(
  holdings: ParsedHolding[] | undefined,
  screenshotData: BalanceSheetExtraction | undefined
): 'holdings' | 'single_balance' {
  if (holdings && holdings.length > 0) return 'holdings'
  if (!screenshotData) return 'holdings'
  if (screenshotData.holdings && screenshotData.holdings.length > 0) return 'holdings'
  return 'single_balance'
}

// Guess an initial asset_type for a holdings payload based on the screenshot
// document_type or the CSV's own asset_type_hint.
function guessAssetType(
  screenshotData: BalanceSheetExtraction | undefined,
  holdings: ParsedHolding[] | undefined
): HoldingsAssetType {
  if (screenshotData?.document_type === 'pension_statement') return 'pension'
  if (holdings && holdings[0]?.asset_type_hint) {
    const hint = holdings[0].asset_type_hint.toLowerCase()
    if (hint.includes('bond')) return 'bonds'
    if (hint.includes('crypto') || hint.includes('coin')) return 'crypto'
    if (hint.includes('pension')) return 'pension'
  }
  return 'stocks'
}

type EditableHolding = ParsedHolding & { __key: string; __removed: boolean }

export function HoldingsPreview({
  holdings,
  suggestedAssetName,
  suggestedProvider,
  screenshotData,
  source,
  onConfirm,
  onCancel,
  isImporting,
}: Props) {
  const mode = deriveMode(holdings, screenshotData)

  // Seed initial holdings from either CSV or screenshot data.
  const initialHoldings: EditableHolding[] = useMemo(() => {
    if (holdings && holdings.length > 0) {
      return holdings.map((h, i) => ({ ...h, __key: 'csv-' + i, __removed: false }))
    }
    if (screenshotData && screenshotData.holdings.length > 0) {
      return screenshotData.holdings.map((h, i) => ({
        ticker: h.ticker,
        name: h.name,
        quantity: h.quantity,
        current_value: h.current_value,
        cost_basis: h.cost_basis,
        price_per_unit: null,
        gain_loss_pct: h.gain_loss_pct,
        currency: screenshotData.currency,
        asset_type_hint: null,
        raw_row: {},
        __key: 'ss-' + i,
        __removed: false,
      }))
    }
    return []
  }, [holdings, screenshotData])

  // Shared header state
  const [accountName, setAccountName] = useState<string>(
    suggestedAssetName ?? screenshotData?.account_name ?? ''
  )
  const [provider, setProvider] = useState<string>(
    suggestedProvider ?? screenshotData?.provider ?? ''
  )
  const [currency, setCurrency] = useState<string>(
    (holdings && holdings[0]?.currency) || screenshotData?.currency || 'GBP'
  )
  const [assetType, setAssetType] = useState<HoldingsAssetType>(
    guessAssetType(screenshotData, holdings)
  )

  // Editable holdings rows
  const [rows, setRows] = useState<EditableHolding[]>(initialHoldings)

  // Single-balance state (savings / loan / credit card)
  const isLiabilityLike =
    screenshotData?.document_type === 'loan_statement' ||
    screenshotData?.document_type === 'credit_card_statement'

  const [singleKind, setSingleKind] = useState<'asset' | 'liability'>(
    isLiabilityLike ? 'liability' : 'asset'
  )
  const [singleAssetType, setSingleAssetType] = useState<(typeof SINGLE_ASSET_TYPES)[number]>(
    screenshotData?.document_type === 'savings_statement' ? 'savings' : 'savings'
  )
  const [singleLiabilityType, setSingleLiabilityType] = useState<
    (typeof LIABILITY_TYPES)[number]
  >(
    screenshotData?.document_type === 'credit_card_statement'
      ? 'credit_card'
      : screenshotData?.document_type === 'loan_statement'
        ? 'mortgage'
        : 'personal_loan'
  )
  const [balance, setBalance] = useState<number>(
    screenshotData?.balance.outstanding_balance ?? screenshotData?.total_value ?? 0
  )
  const [interestRate, setInterestRate] = useState<number | ''>(
    screenshotData?.balance.interest_rate ?? ''
  )
  const [creditLimit, setCreditLimit] = useState<number | ''>(
    screenshotData?.balance.credit_limit ?? ''
  )
  const [minimumPayment, setMinimumPayment] = useState<number | ''>(
    screenshotData?.balance.minimum_payment ?? ''
  )
  const [monthlyPayment, setMonthlyPayment] = useState<number | ''>(
    screenshotData?.balance.monthly_payment ?? ''
  )

  const visibleRows = rows.filter((r) => !r.__removed)
  const totalValue = visibleRows.reduce(
    (sum, r) => sum + (typeof r.current_value === 'number' ? r.current_value : 0),
    0
  )

  function updateRow<K extends keyof ParsedHolding>(
    key: string,
    field: K,
    value: ParsedHolding[K]
  ) {
    setRows((prev) =>
      prev.map((r) => (r.__key === key ? { ...r, [field]: value } : r))
    )
  }

  function removeRow(key: string) {
    setRows((prev) => prev.map((r) => (r.__key === key ? { ...r, __removed: true } : r)))
  }

  async function handleConfirm() {
    if (mode === 'holdings') {
      if (!accountName.trim()) {
        alert('Please name this account before saving.')
        return
      }
      const cleanHoldings: ParsedHolding[] = visibleRows.map((r) => ({
        ticker: r.ticker,
        name: r.name,
        quantity: r.quantity,
        current_value: r.current_value,
        cost_basis: r.cost_basis,
        price_per_unit: r.price_per_unit,
        gain_loss_pct: r.gain_loss_pct,
        currency: r.currency,
        asset_type_hint: r.asset_type_hint,
        raw_row: r.raw_row,
      }))
      await onConfirm({
        import_type: 'holdings',
        source,
        asset_name: accountName.trim(),
        asset_type: assetType,
        provider: provider.trim() || null,
        currency,
        holdings: cleanHoldings,
      })
      return
    }

    // Single balance path
    if (!accountName.trim()) {
      alert('Please name this account before saving.')
      return
    }

    if (singleKind === 'asset') {
      if (!balance || balance <= 0) {
        alert('Please enter a balance.')
        return
      }
      await onConfirm({
        import_type: 'single_asset',
        source,
        asset: {
          name: accountName.trim(),
          asset_type: singleAssetType,
          provider: provider.trim() || null,
          currency,
          current_value: Number(balance),
        },
      })
    } else {
      if (!balance || balance <= 0) {
        alert('Please enter an outstanding balance.')
        return
      }
      await onConfirm({
        import_type: 'liability',
        source,
        liability: {
          name: accountName.trim(),
          liability_type: singleLiabilityType,
          provider: provider.trim() || null,
          currency,
          outstanding_balance: Number(balance),
          interest_rate: interestRate === '' ? null : Number(interestRate),
          minimum_payment: minimumPayment === '' ? null : Number(minimumPayment),
          monthly_payment: monthlyPayment === '' ? null : Number(monthlyPayment),
          details: {
            ...(creditLimit !== '' ? { credit_limit: Number(creditLimit) } : {}),
          },
        },
      })
    }
  }

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-medium text-foreground">Account details</h3>

        {mode === 'single_balance' && (
          <div>
            <label className="text-xs text-muted-foreground block mb-1">This is</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSingleKind('asset')}
                className={`flex-1 min-h-[44px] rounded-md border px-3 text-sm ${
                  singleKind === 'asset'
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-input text-muted-foreground'
                }`}
              >
                Something I own
              </button>
              <button
                type="button"
                onClick={() => setSingleKind('liability')}
                className={`flex-1 min-h-[44px] rounded-md border px-3 text-sm ${
                  singleKind === 'liability'
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-input text-muted-foreground'
                }`}
              >
                Something I owe
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">Account name</span>
            <input
              type="text"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="e.g. Vanguard S&S ISA"
              className="mt-1 w-full min-h-[44px] rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Provider</span>
            <input
              type="text"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="e.g. Vanguard"
              className="mt-1 w-full min-h-[44px] rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Currency</span>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="mt-1 w-full min-h-[44px] rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="GBP">GBP</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
          </label>

          {mode === 'holdings' && (
            <label className="block">
              <span className="text-xs text-muted-foreground">Asset type</span>
              <select
                value={assetType}
                onChange={(e) =>
                  setAssetType(e.target.value as HoldingsAssetType)
                }
                className="mt-1 w-full min-h-[44px] rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="stocks">Stocks / ETFs</option>
                <option value="bonds">Bonds</option>
                <option value="pension">Pension</option>
                <option value="crypto">Crypto</option>
              </select>
            </label>
          )}

          {mode === 'single_balance' && singleKind === 'asset' && (
            <label className="block">
              <span className="text-xs text-muted-foreground">Asset type</span>
              <select
                value={singleAssetType}
                onChange={(e) =>
                  setSingleAssetType(e.target.value as (typeof SINGLE_ASSET_TYPES)[number])
                }
                className="mt-1 w-full min-h-[44px] rounded-md border border-input bg-background px-3 text-sm"
              >
                {SINGLE_ASSET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}

          {mode === 'single_balance' && singleKind === 'liability' && (
            <label className="block">
              <span className="text-xs text-muted-foreground">Debt type</span>
              <select
                value={singleLiabilityType}
                onChange={(e) =>
                  setSingleLiabilityType(e.target.value as (typeof LIABILITY_TYPES)[number])
                }
                className="mt-1 w-full min-h-[44px] rounded-md border border-input bg-background px-3 text-sm"
              >
                {LIABILITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {/* Holdings table */}
      {mode === 'holdings' && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-medium text-foreground">
              {visibleRows.length} holding{visibleRows.length === 1 ? '' : 's'}
            </h3>
            <p className="text-sm text-muted-foreground">
              Total: {formatMoney(totalValue, currency)}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-2">Name</th>
                  <th className="py-2 pr-2">Ticker</th>
                  <th className="py-2 pr-2 text-right">Qty</th>
                  <th className="py-2 pr-2 text-right">Value</th>
                  <th className="py-2 pr-2 text-right">Cost</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.__key} className="border-b border-border/50">
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        value={r.name}
                        onChange={(e) => updateRow(r.__key, 'name', e.target.value)}
                        className="w-full min-h-[36px] rounded border border-input bg-background px-2 text-sm"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        value={r.ticker ?? ''}
                        onChange={(e) =>
                          updateRow(r.__key, 'ticker', e.target.value || null)
                        }
                        className="w-20 min-h-[36px] rounded border border-input bg-background px-2 text-sm"
                      />
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <input
                        type="number"
                        value={r.quantity ?? ''}
                        onChange={(e) =>
                          updateRow(
                            r.__key,
                            'quantity',
                            e.target.value === '' ? null : Number(e.target.value)
                          )
                        }
                        className="w-24 min-h-[36px] rounded border border-input bg-background px-2 text-sm text-right"
                      />
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <input
                        type="number"
                        value={r.current_value ?? ''}
                        onChange={(e) =>
                          updateRow(
                            r.__key,
                            'current_value',
                            e.target.value === '' ? null : Number(e.target.value)
                          )
                        }
                        className="w-28 min-h-[36px] rounded border border-input bg-background px-2 text-sm text-right"
                      />
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <input
                        type="number"
                        value={r.cost_basis ?? ''}
                        onChange={(e) =>
                          updateRow(
                            r.__key,
                            'cost_basis',
                            e.target.value === '' ? null : Number(e.target.value)
                          )
                        }
                        className="w-28 min-h-[36px] rounded border border-input bg-background px-2 text-sm text-right"
                      />
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeRow(r.__key)}
                        className="text-xs text-muted-foreground hover:text-destructive min-h-[36px] px-2"
                        aria-label="Remove row"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {visibleRows.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              All rows removed. Cancel to start over.
            </p>
          )}
        </div>
      )}

      {/* Single balance form */}
      {mode === 'single_balance' && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-medium text-foreground">
            {singleKind === 'asset' ? 'Balance' : 'Debt details'}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-muted-foreground">
                {singleKind === 'asset' ? 'Current value' : 'Outstanding balance'}
              </span>
              <input
                type="number"
                value={balance || ''}
                onChange={(e) => setBalance(Number(e.target.value))}
                className="mt-1 w-full min-h-[44px] rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>

            {singleKind === 'liability' && (
              <>
                <label className="block">
                  <span className="text-xs text-muted-foreground">Interest rate (% APR)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={interestRate}
                    onChange={(e) =>
                      setInterestRate(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="mt-1 w-full min-h-[44px] rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">Minimum payment</span>
                  <input
                    type="number"
                    value={minimumPayment}
                    onChange={(e) =>
                      setMinimumPayment(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="mt-1 w-full min-h-[44px] rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">Actual monthly payment</span>
                  <input
                    type="number"
                    value={monthlyPayment}
                    onChange={(e) =>
                      setMonthlyPayment(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="mt-1 w-full min-h-[44px] rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>
                {singleLiabilityType === 'credit_card' && (
                  <label className="block">
                    <span className="text-xs text-muted-foreground">Credit limit</span>
                    <input
                      type="number"
                      value={creditLimit}
                      onChange={(e) =>
                        setCreditLimit(e.target.value === '' ? '' : Number(e.target.value))
                      }
                      className="mt-1 w-full min-h-[44px] rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </label>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 sticky bottom-0 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isImporting}
          className="flex-1 min-h-[44px] rounded-md border border-input px-4 text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isImporting || (mode === 'holdings' && visibleRows.length === 0)}
          className="flex-1 min-h-[44px] rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
        >
          {isImporting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
