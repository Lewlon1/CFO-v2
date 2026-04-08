'use client'

import { normaliseToMonthly, frequencyLabel } from '@/lib/bills/normalise'
import { billTypeIcon, matchProvider } from '@/lib/bills/provider-registry'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BillRecord = Record<string, any>

interface Props {
  bill: BillRecord
  onClick: () => void
  onPromote?: () => void
  onDismiss?: () => void
}

export function BillCard({ bill, onClick, onPromote, onDismiss }: Props) {
  const monthly = normaliseToMonthly(Number(bill.amount), bill.frequency || 'monthly')
  const freq = frequencyLabel(bill.frequency || 'monthly')
  const isDetected = bill.status === 'detected'
  const planDetails = bill.current_plan_details as Record<string, unknown> | null
  const billType = (planDetails?.bill_type as string) || bill.category_id || ''
  const icon = billType ? billTypeIcon(billType) : getIconFromProvider(bill)
  const saving = bill.potential_saving_monthly ? Number(bill.potential_saving_monthly) : 0

  // Contract end warning
  const contractEnd = bill.contract_end_date ? new Date(bill.contract_end_date) : null
  const daysUntilEnd = contractEnd
    ? Math.ceil((contractEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <div
      className="rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="px-4 py-3 flex items-start gap-3">
        <span className="text-xl leading-none mt-0.5 flex-shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-foreground truncate">
              {bill.provider || bill.name}
            </h3>
            {isDetected && (
              <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded flex-shrink-0">
                Detected
              </span>
            )}
          </div>

          {bill.provider && bill.provider !== bill.name && (
            <p className="text-xs text-muted-foreground truncate">{bill.name}</p>
          )}

          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm font-semibold text-foreground tabular-nums">
              {bill.currency || 'EUR'} {Number(bill.amount).toFixed(2)}{freq}
            </span>
            {bill.frequency !== 'monthly' && (
              <span className="text-xs text-muted-foreground">
                ({bill.currency || 'EUR'} {monthly.toFixed(2)}/mo)
              </span>
            )}
          </div>

          {/* Plan details snippet */}
          {planDetails?.tariff_type && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {planDetails.tariff_type as string}
              {planDetails.power_contracted_kw ? ` · ${planDetails.power_contracted_kw} kW` : ''}
            </p>
          )}
          {planDetails?.plan_name && !planDetails.tariff_type && (
            <p className="text-xs text-muted-foreground mt-0.5">{planDetails.plan_name as string}</p>
          )}

          {/* Savings badge */}
          {saving > 0 && (
            <div className="flex items-center gap-1 mt-1.5">
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                Could save ~{bill.currency || 'EUR'} {saving.toFixed(0)}/mo
              </span>
            </div>
          )}

          {/* Contract end warning */}
          {daysUntilEnd !== null && daysUntilEnd > 0 && daysUntilEnd <= 30 && (
            <div className="flex items-center gap-1 mt-1">
              <span
                className={`text-xs font-medium ${
                  daysUntilEnd <= 7
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                Contract ends in {daysUntilEnd} days
              </span>
            </div>
          )}

          {bill.has_permanencia && (!contractEnd || (daysUntilEnd && daysUntilEnd > 30)) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Lock-in period{contractEnd ? ` until ${contractEnd.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}` : ''}
            </p>
          )}
        </div>

        {/* Actions for detected bills */}
        {isDetected && (onPromote || onDismiss) && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {onPromote && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onPromote()
                }}
                className="text-xs text-primary hover:text-primary/80 font-medium min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                Track
              </button>
            )}
            {onDismiss && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDismiss()
                }}
                className="text-xs text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Dismiss"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function getIconFromProvider(bill: BillRecord): string {
  const match = matchProvider(bill.name || '', bill.provider || '')
  if (match) return match.provider.icon
  return '📋'
}
