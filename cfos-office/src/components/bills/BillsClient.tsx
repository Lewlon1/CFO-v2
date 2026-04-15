'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { normaliseToMonthly } from '@/lib/bills/normalise'
import { billTypeGroup, BILL_TYPE_GROUPS, matchProvider } from '@/lib/bills/provider-registry'
import { BillCard, type BillRecord } from './BillCard'
import { BillDetailPanel } from './BillDetailPanel'
import { BillUploadModal } from './BillUploadModal'
import { EmptyBillsState } from './EmptyBillsState'

interface Props {
  bills: BillRecord[]
}

export function BillsClient({ bills: initialBills }: Props) {
  const router = useRouter()
  const [bills, setBills] = useState(initialBills)
  // Sync local state when the server component re-renders (e.g. after
  // router.refresh() following an upload). Without this, useState's
  // snapshot from first mount sticks and new bills never appear until the
  // user navigates away and back.
  useEffect(() => {
    setBills(initialBills)
  }, [initialBills])
  const [selectedBill, setSelectedBill] = useState<BillRecord | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadBill, setUploadBill] = useState<BillRecord | null>(null) // bill to attach upload to
  const [initialFiles, setInitialFiles] = useState<File[] | undefined>(undefined)

  const trackedBills = bills.filter((b) => b.status === 'tracked')
  const detectedBills = bills.filter((b) => b.status !== 'tracked')

  const monthlyTotal = bills.reduce(
    (sum, b) => sum + normaliseToMonthly(Number(b.amount), b.frequency || 'monthly'),
    0
  )
  const potentialSavings = bills.reduce(
    (sum, b) => sum + (Number(b.potential_saving_monthly) || 0),
    0
  )

  async function handlePromote(billId: string) {
    try {
      const res = await fetch('/api/bills/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bill_id: billId }),
      })
      if (res.ok) {
        const { bill: updated } = await res.json()
        setBills((prev) => prev.map((b) => (b.id === billId ? updated : b)))
      }
    } catch {
      // Non-fatal
    }
  }

  async function handleDismiss(billId: string) {
    // Optimistic remove
    setBills((prev) => prev.filter((b) => b.id !== billId))
    try {
      await fetch('/api/bills/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bill_id: billId }),
      })
    } catch {
      // Non-fatal — on next page load the bill will reappear if the request failed
    }
  }

  async function handleDelete(billId: string) {
    if (!confirm('Delete this bill? This cannot be undone.')) return
    setBills((prev) => prev.filter((b) => b.id !== billId))
    setSelectedBill(null)
    try {
      await fetch('/api/bills/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bill_id: billId }),
      })
    } catch {
      // Non-fatal — refresh will restore if failed
      router.refresh()
    }
  }

  function handleUploadComplete() {
    setShowUpload(false)
    setUploadBill(null)
    setInitialFiles(undefined)
    router.refresh()
  }

  function handleOpenUpload(bill?: BillRecord) {
    setUploadBill(bill || null)
    setInitialFiles(undefined)
    setShowUpload(true)
    setSelectedBill(null)
  }

  function handleFilesFromEmptyState(files: File[]) {
    setUploadBill(null)
    setInitialFiles(files)
    setShowUpload(true)
  }

  // Group tracked bills by type
  const groupedTracked = groupBills(trackedBills)

  if (bills.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <EmptyBillsState onFiles={handleFilesFromEmptyState} />
        {showUpload && (
          <BillUploadModal
            bill={null}
            onClose={() => { setShowUpload(false); setInitialFiles(undefined) }}
            onConfirmed={handleUploadComplete}
            initialFiles={initialFiles}
          />
        )}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Your Bills</h1>
        <button
          onClick={() => handleOpenUpload()}
          className="text-sm font-medium text-primary hover:text-primary/80 min-h-[44px] min-w-[44px] flex items-center"
        >
          Upload Bill
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Monthly total</p>
          <p className="text-lg font-bold text-foreground tabular-nums">
            EUR {monthlyTotal.toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">Potential savings</p>
          {potentialSavings > 0 ? (
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              EUR {potentialSavings.toFixed(2)}/mo
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mt-1">Not yet analysed</p>
          )}
        </div>
      </div>

      {/* Tracked bills by group */}
      {trackedBills.length > 0 && (
        <div className="space-y-4">
          {Object.entries(groupedTracked).map(([groupKey, groupBills]) => {
            const group = BILL_TYPE_GROUPS[groupKey] || { label: 'Other', icon: '📋' }
            return (
              <section key={groupKey}>
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <span>{group.icon}</span>
                  {group.label}
                </h2>
                <div className="space-y-2">
                  {groupBills.map((bill) => (
                    <BillCard
                      key={bill.id}
                      bill={bill}
                      onClick={() => setSelectedBill(bill)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* Detected but untracked */}
      {detectedBills.length > 0 && (
        <section>
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            Detected Recurring Charges
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            These were automatically detected from your transactions. Track them to get optimisation recommendations.
          </p>
          <div className="space-y-2">
            {detectedBills.map((bill) => (
              <BillCard
                key={bill.id}
                bill={bill}
                onClick={() => setSelectedBill(bill)}
                onPromote={() => handlePromote(bill.id)}
                onDismiss={() => handleDismiss(bill.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Detail panel */}
      {selectedBill && (
        <BillDetailPanel
          bill={selectedBill}
          onClose={() => setSelectedBill(null)}
          onUploadBill={() => handleOpenUpload(selectedBill)}
          onDelete={() => handleDelete(selectedBill.id)}
        />
      )}

      {/* Upload modal */}
      {showUpload && (
        <BillUploadModal
          bill={uploadBill}
          onClose={() => {
            setShowUpload(false)
            setUploadBill(null)
            setInitialFiles(undefined)
          }}
          onConfirmed={handleUploadComplete}
          initialFiles={initialFiles}
        />
      )}
    </div>
  )
}

function groupBills(bills: BillRecord[]): Record<string, BillRecord[]> {
  const groups: Record<string, BillRecord[]> = {}

  for (const bill of bills) {
    const planDetails = bill.current_plan_details as Record<string, unknown> | null
    const billType = (planDetails?.bill_type as string) || bill.category_id || ''
    let group = billType ? billTypeGroup(billType) : 'other'

    // Try provider registry if no type
    if (group === 'other') {
      const match = matchProvider(bill.name || '', bill.provider || '')
      if (match) group = billTypeGroup(match.provider.type)
    }

    if (!groups[group]) groups[group] = []
    groups[group].push(bill)
  }

  return groups
}
