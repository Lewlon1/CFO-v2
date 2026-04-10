'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Two sections:
 *  1. Export my data — downloads a full GDPR Article 20 JSON export
 *  2. Danger zone — permanently deletes account + all data
 */
export function AccountDataManagement() {
  const router = useRouter()

  // Export state
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // Delete state
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [confirmationText, setConfirmationText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    try {
      const res = await fetch('/api/account/export')
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || `Export failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cfos-office-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: confirmationText }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.error || `Deletion failed (${res.status})`)
      }
      // The API already signs out via the server-side Supabase client, but
      // we also clear the browser-side session to be safe.
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/')
      router.refresh()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Deletion failed')
      setDeleting(false)
    }
  }

  const canDelete = confirmationText === 'DELETE MY ACCOUNT' && !deleting

  return (
    <>
      {/* Export */}
      <section className="mt-10">
        <h2 className="text-sm font-medium text-foreground mb-2">Your data</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Download a full copy of everything we hold for you — profile, transactions,
          conversations, Value Map, and consent history. The file is standard JSON.
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="min-h-[44px] rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
        >
          {exporting ? 'Preparing download…' : 'Download my data'}
        </button>
        {exportError && (
          <p className="mt-2 text-sm text-destructive">{exportError}</p>
        )}
      </section>

      {/* Danger zone */}
      <section className="mt-10 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
        <h2 className="text-sm font-medium text-destructive mb-2">Danger zone</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Permanently delete your account and every piece of data associated with it —
          transactions, conversations, financial portrait, Value Map results. This action
          cannot be undone.
        </p>
        <button
          type="button"
          onClick={() => {
            setShowDeleteModal(true)
            setConfirmationText('')
            setDeleteError(null)
          }}
          className="min-h-[44px] rounded-lg border border-destructive/40 bg-background px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10"
        >
          Delete my account
        </button>
      </section>

      {/* Confirmation modal */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !deleting && setShowDeleteModal(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Delete your account?
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              This will permanently delete all your data including transactions,
              conversations, financial portrait, and Value Map results. This action
              cannot be undone.
            </p>
            <p className="text-sm text-foreground mb-2">
              Type <span className="font-mono font-semibold">DELETE MY ACCOUNT</span> to
              confirm:
            </p>
            <input
              type="text"
              value={confirmationText}
              onChange={e => setConfirmationText(e.target.value)}
              disabled={deleting}
              className="w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="DELETE MY ACCOUNT"
              autoFocus
            />
            {deleteError && (
              <p className="mt-2 text-sm text-destructive">{deleteError}</p>
            )}
            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="min-h-[44px] rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!canDelete}
                className="min-h-[44px] rounded-lg bg-destructive px-4 py-2.5 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
