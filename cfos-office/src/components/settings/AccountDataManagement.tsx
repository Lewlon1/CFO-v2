'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/button'

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
      <section className="space-y-3">
        <h2 className="text-h3 text-text-primary">Your data</h2>
        <Card variant="elevated" className="p-4 space-y-3">
          <p className="text-body text-text-secondary">
            Download a full copy of everything we hold for you — profile, transactions,
            conversations, Value Map, and consent history. The file is standard JSON.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            loading={exporting}
            className="min-h-[44px]"
          >
            Download my data
          </Button>
          {exportError && <p className="text-body-sm text-destructive">{exportError}</p>}
        </Card>
      </section>

      {/* Danger zone */}
      <section className="space-y-3">
        <h2 className="text-h3 text-destructive">Danger zone</h2>
        <div className="rounded-card border border-destructive/30 bg-destructive/5 p-4 space-y-3">
          <p className="text-body text-text-secondary">
            Permanently delete your account and every piece of data associated with it —
            transactions, conversations, financial portrait, Value Map results. This action
            cannot be undone.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowDeleteModal(true)
              setConfirmationText('')
              setDeleteError(null)
            }}
            className="min-h-[44px] border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            Delete my account
          </Button>
        </div>
      </section>

      {/* Confirmation modal */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !deleting && setShowDeleteModal(false)}
        >
          <Card
            variant="elevated"
            className="w-full max-w-md p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-h2 text-text-primary">Delete your account?</h3>
            <p className="text-body text-text-secondary">
              This will permanently delete all your data including transactions,
              conversations, financial portrait, and Value Map results. This action
              cannot be undone.
            </p>
            <p className="text-body text-text-primary">
              Type <span className="font-data font-semibold">DELETE MY ACCOUNT</span> to confirm:
            </p>
            <Input
              type="text"
              value={confirmationText}
              onChange={e => setConfirmationText(e.target.value)}
              disabled={deleting}
              placeholder="DELETE MY ACCOUNT"
              autoFocus
            />
            {deleteError && <p className="text-body-sm text-destructive">{deleteError}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="min-h-[44px]"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleDelete}
                disabled={!canDelete}
                loading={deleting}
                className="min-h-[44px] bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80"
              >
                Delete permanently
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  )
}
