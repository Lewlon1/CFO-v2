'use client'

import { useState } from 'react'
import { Download, FileDown, Trash2, AlertTriangle } from 'lucide-react'

type DeletionTarget = 'transactions' | 'portrait' | 'conversations' | 'goals' | 'value_map' | 'everything'

interface DataManagementProps {
  dataSummary: {
    totalTransactions: number
    monthsCovered: number
    traitCount: number
  }
}

const DELETION_OPTIONS: Array<{
  target: DeletionTarget
  label: string
  description: string
}> = [
  {
    target: 'transactions',
    label: 'Delete all transaction data',
    description: 'Removes all transactions, monthly snapshots, and recurring expense records.',
  },
  {
    target: 'portrait',
    label: 'Delete behavioral observations',
    description: 'Removes all personality traits and behavioral patterns your CFO has noted.',
  },
  {
    target: 'conversations',
    label: 'Delete chat history',
    description: 'Removes all conversations and messages with your CFO.',
  },
  {
    target: 'goals',
    label: 'Delete all goals and actions',
    description: 'Removes all financial goals and action items.',
  },
  {
    target: 'value_map',
    label: 'Delete Value Map data',
    description: 'Removes your Value Map results and value category preferences.',
  },
]

async function downloadFile(url: string) {
  const res = await fetch(url)
  if (!res.ok) return
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const filenameMatch = disposition.match(/filename="(.+)"/)
  const filename = filenameMatch?.[1] ?? 'export'
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export function DataManagement({ dataSummary }: DataManagementProps) {
  const [confirmTarget, setConfirmTarget] = useState<DeletionTarget | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteAccountStep, setDeleteAccountStep] = useState<0 | 1 | 2>(0)

  const handleDelete = async (target: DeletionTarget) => {
    setIsDeleting(true)
    try {
      const res = await fetch('/api/profile/delete-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target,
          confirmation: `DELETE_${target.toUpperCase()}`,
        }),
      })
      const data = await res.json()
      if (data.redirect) {
        window.location.href = data.redirect
      } else {
        window.location.reload()
      }
    } finally {
      setIsDeleting(false)
      setConfirmTarget(null)
    }
  }

  return (
    <div className="space-y-8">
      {/* Export */}
      <div>
        <h4 className="text-sm font-medium mb-2">Export your data</h4>
        <p className="text-xs text-muted-foreground mb-3">
          Download your transaction history and profile information.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => downloadFile('/api/profile/export/transactions')}
            disabled={dataSummary.totalTransactions === 0}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors text-sm min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileDown className="h-4 w-4" />
            Export transactions (CSV)
          </button>
          <button
            onClick={() => downloadFile('/api/profile/export/profile')}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors text-sm min-h-[44px]"
          >
            <Download className="h-4 w-4" />
            Export profile summary
          </button>
        </div>
      </div>

      {/* Selective deletion */}
      <div>
        <h4 className="text-sm font-medium mb-2">Delete data</h4>
        <p className="text-xs text-muted-foreground mb-3">
          Remove specific categories of data. This cannot be undone.
        </p>
        <div className="space-y-2">
          {DELETION_OPTIONS.map(({ target, label, description }) => (
            <div
              key={target}
              className="flex items-center justify-between py-3 border-b border-border last:border-0"
            >
              <div className="flex-1 min-w-0 mr-4">
                <p className="text-sm">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              {confirmTarget === target ? (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleDelete(target)}
                    disabled={isDeleting}
                    className="text-xs px-3 py-2 bg-destructive text-destructive-foreground rounded font-medium min-h-[44px]"
                  >
                    {isDeleting ? 'Deleting...' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setConfirmTarget(null)}
                    className="text-xs px-3 py-2 border border-border rounded min-h-[44px]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmTarget(target)}
                  className="text-xs text-muted-foreground hover:text-destructive px-3 py-2 border border-border rounded hover:border-destructive/50 min-h-[44px] flex-shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Account deletion */}
      <div className="border-t border-destructive/20 pt-6">
        <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="text-sm font-medium text-destructive">Delete account</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Permanently delete your account and all associated data. This cannot be undone.
              </p>

              {deleteAccountStep === 0 && (
                <button
                  onClick={() => setDeleteAccountStep(1)}
                  className="text-xs text-destructive/70 hover:text-destructive underline mt-3 min-h-[44px] flex items-center"
                >
                  I want to delete my account
                </button>
              )}

              {deleteAccountStep === 1 && (
                <div className="mt-3 p-3 bg-destructive/10 rounded">
                  <p className="text-xs text-destructive font-medium mb-2">
                    Are you sure? This will permanently delete:
                  </p>
                  <p className="text-xs text-muted-foreground mb-3">
                    All transactions, conversations, goals, behavioral observations, Value Map results, and your profile. None of this can be recovered.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setDeleteAccountStep(2)}
                      className="text-xs px-4 py-2 bg-destructive text-destructive-foreground rounded font-medium min-h-[44px]"
                    >
                      Yes, I&apos;m sure
                    </button>
                    <button
                      onClick={() => setDeleteAccountStep(0)}
                      className="text-xs px-4 py-2 border border-border rounded min-h-[44px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {deleteAccountStep === 2 && (
                <div className="mt-3 p-3 bg-destructive/10 rounded">
                  <p className="text-xs text-destructive font-medium mb-3">
                    Final confirmation. This is irreversible.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDelete('everything')}
                      disabled={isDeleting}
                      className="text-xs px-4 py-2 bg-destructive text-destructive-foreground rounded font-medium min-h-[44px]"
                    >
                      {isDeleting ? 'Deleting account...' : 'Permanently delete my account'}
                    </button>
                    <button
                      onClick={() => setDeleteAccountStep(0)}
                      className="text-xs px-4 py-2 border border-border rounded min-h-[44px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
