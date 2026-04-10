'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { normaliseToMonthly, frequencyLabel } from '@/lib/bills/normalise'
import { billTypeIcon } from '@/lib/bills/provider-registry'
import type { BillRecord } from './BillCard'

interface Props {
  bill: BillRecord
  onClose: () => void
  onUploadBill: () => void
  onDelete?: () => void
}

interface TransactionHistory {
  date: string
  amount: number
  description: string
}

export function BillDetailPanel({ bill, onClose, onUploadBill, onDelete }: Props) {
  const router = useRouter()
  const [history, setHistory] = useState<TransactionHistory[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const monthly = normaliseToMonthly(Number(bill.amount), bill.frequency || 'monthly')
  const freq = frequencyLabel(bill.frequency || 'monthly')
  const planDetails = bill.current_plan_details as Record<string, unknown> | null
  const billType = (planDetails?.bill_type as string) || bill.category_id || ''
  const icon = billType ? billTypeIcon(billType) : '📋'
  const lastResearch = planDetails?.last_research as Record<string, unknown> | null
  const alternatives = (lastResearch?.alternatives || []) as Array<Record<string, unknown>>
  const uploads = (bill.bill_uploads || []) as Array<Record<string, unknown>>

  // Fetch transaction history for this bill
  useEffect(() => {
    async function loadHistory() {
      try {
        const searchTerm = bill.provider || bill.name
        const res = await fetch(
          `/api/bills/history?search=${encodeURIComponent(searchTerm)}`
        )
        if (res.ok) {
          const data = await res.json()
          setHistory(data.transactions || [])
        }
      } catch {
        // Non-fatal
      } finally {
        setLoadingHistory(false)
      }
    }
    loadHistory()
  }, [bill.provider, bill.name])

  async function handleAskCFO() {
    try {
      const res = await fetch('/api/bills/start-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bill_id: bill.id }),
      })
      if (res.ok) {
        const data = await res.json()
        router.push(`/chat/${data.conversation_id}`)
      }
    } catch {
      // Fall back to general chat
      router.push('/chat')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <div
        className="w-full max-w-md bg-card border-l border-border h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-4 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <span className="text-xl">{icon}</span>
            <h2 className="text-sm font-semibold text-foreground">
              {bill.provider || bill.name}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Amount */}
          <div>
            <div className="text-2xl font-bold text-foreground tabular-nums">
              {bill.currency || 'EUR'} {Number(bill.amount).toFixed(2)}{freq}
            </div>
            {bill.frequency !== 'monthly' && (
              <p className="text-sm text-muted-foreground">
                Monthly equivalent: {bill.currency || 'EUR'} {monthly.toFixed(2)}
              </p>
            )}
          </div>

          {/* Plan details */}
          {planDetails && Object.keys(planDetails).length > 0 && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Current Plan
              </h3>
              <div className="rounded-lg border border-border divide-y divide-border text-sm">
                {planDetails.tariff_type && (
                  <DetailRow label="Tariff" value={String(planDetails.tariff_type)} />
                )}
                {planDetails.power_contracted_kw && (
                  <DetailRow label="Contracted power" value={`${planDetails.power_contracted_kw} kW`} />
                )}
                {planDetails.consumption_kwh && (
                  <DetailRow label="Last consumption" value={`${planDetails.consumption_kwh} kWh`} />
                )}
                {planDetails.consumption_m3 && (
                  <DetailRow label="Last consumption" value={`${planDetails.consumption_m3} m³`} />
                )}
                {planDetails.plan_name && (
                  <DetailRow label="Plan" value={String(planDetails.plan_name)} />
                )}
                {planDetails.speed_mbps && (
                  <DetailRow label="Speed" value={`${planDetails.speed_mbps} Mbps`} />
                )}
                {planDetails.data_gb && (
                  <DetailRow label="Data" value={`${planDetails.data_gb} GB`} />
                )}
                {planDetails.coverage_type && (
                  <DetailRow label="Coverage" value={String(planDetails.coverage_type)} />
                )}
                <DetailRow label="Frequency" value={bill.frequency || 'monthly'} />
                {bill.contract_end_date && (
                  <DetailRow label="Contract ends" value={bill.contract_end_date} />
                )}
                <DetailRow
                  label="Permanencia"
                  value={bill.has_permanencia ? 'Yes' : 'No'}
                />
              </div>
            </section>
          )}

          {!planDetails && (
            <div className="rounded-lg border border-dashed border-border p-4 text-center">
              <p className="text-sm text-muted-foreground mb-2">
                No plan details yet
              </p>
              <button
                onClick={onUploadBill}
                className="text-sm text-primary hover:text-primary/80 font-medium min-h-[44px]"
              >
                Upload a bill to get details
              </button>
            </div>
          )}

          {/* Bill history */}
          <section>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Bill History
            </h3>
            {loadingHistory ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-6 bg-muted rounded animate-pulse" />
                ))}
              </div>
            ) : history.length > 0 ? (
              <div className="space-y-1">
                {history.map((tx, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1">
                    <span className="text-muted-foreground">
                      {new Date(tx.date).toLocaleDateString('en-GB', {
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="text-foreground tabular-nums font-medium">
                      {bill.currency || 'EUR'} {Math.abs(tx.amount).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No matching transactions found.</p>
            )}
          </section>

          {/* Researched alternatives */}
          {alternatives.length > 0 && lastResearch && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Alternatives Researched
              </h3>
              <p className="text-xs text-muted-foreground mb-2">
                {lastResearch.date as string} · {lastResearch.confidence as string} confidence
              </p>
              <div className="space-y-2">
                {alternatives.map((alt, i) => {
                  const saving = monthly - Number(alt.monthly_cost_estimate || 0)
                  return (
                    <div
                      key={i}
                      className="rounded-lg border border-border p-3 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground">{alt.provider as string}</span>
                        <span className="tabular-nums text-foreground">
                          ~{bill.currency || 'EUR'} {Number(alt.monthly_cost_estimate).toFixed(0)}/mo
                        </span>
                      </div>
                      {alt.plan_name ? (
                        <p className="text-xs text-muted-foreground">{String(alt.plan_name)}</p>
                      ) : null}
                      {saving > 0 && (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                          Save ~{bill.currency || 'EUR'} {saving.toFixed(0)}/mo
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
              {lastResearch.market_summary ? (
                <p className="text-xs text-muted-foreground mt-2">
                  {String(lastResearch.market_summary)}
                </p>
              ) : null}
            </section>
          )}

          {/* Upload history */}
          {uploads.length > 0 && (
            <section>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Uploaded Bills ({uploads.length})
              </h3>
              <div className="space-y-1">
                {uploads.map((u, i) => (
                  <div key={i} className="flex items-center justify-between text-xs text-muted-foreground py-1">
                    <span>
                      {new Date(u.uploaded_at as string).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="tabular-nums">
                      {bill.currency || 'EUR'} {Number(u.amount).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-2">
            <button
              onClick={onUploadBill}
              className="w-full bg-card border border-border text-foreground text-sm font-medium rounded-lg py-2.5 min-h-[44px] hover:bg-accent transition-colors"
            >
              Upload New Bill
            </button>
            <button
              onClick={handleAskCFO}
              className="w-full bg-primary text-primary-foreground text-sm font-medium rounded-lg py-2.5 min-h-[44px] hover:bg-primary/90 transition-colors"
            >
              Ask CFO About This Bill
            </button>
            {onDelete && (
              <button
                onClick={onDelete}
                className="w-full text-destructive text-sm font-medium rounded-lg py-2.5 min-h-[44px] hover:bg-destructive/10 transition-colors"
              >
                Delete Bill
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  )
}
