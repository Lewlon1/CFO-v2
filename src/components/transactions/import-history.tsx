"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog"

type ImportBatch = {
  import_batch_id: string
  imported_at: string
  tx_count: number
}

type Props = {
  profileId: string
}

export function ImportHistory({ profileId }: Props) {
  const supabase = createClient()
  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [confirmBatch, setConfirmBatch] = useState<ImportBatch | null>(null)

  useEffect(() => {
    async function load() {
      const { data } = await (supabase.rpc as any)("fn_import_batches", {
        p_profile_id: profileId,
      })
      setBatches((data as ImportBatch[]) ?? [])
      setLoading(false)
    }
    load()
  }, [supabase, profileId])

  async function handleRemove(batch: ImportBatch) {
    setRemovingId(batch.import_batch_id)

    // Fetch dates before delete for snapshot refresh
    const { data: txDates } = await supabase
      .from("transactions")
      .select("transaction_date")
      .eq("profile_id", profileId)
      .eq("import_batch_id", batch.import_batch_id)

    const affectedMonths = new Set(
      (txDates ?? []).map((t) => {
        const d = new Date(t.transaction_date)
        return `${d.getFullYear()}-${d.getMonth() + 1}`
      })
    )

    const { error: deleteError } = await supabase
      .from("transactions")
      .delete()
      .eq("profile_id", profileId)
      .eq("import_batch_id", batch.import_batch_id)

    if (deleteError) {
      setRemovingId(null)
      return
    }

    for (const ym of affectedMonths) {
      const [year, month] = ym.split("-").map(Number)
      await (supabase.rpc as any)("fn_generate_monthly_snapshot", {
        p_profile_id: profileId,
        p_year: year,
        p_month: month,
      })
    }

    setBatches((prev) => prev.filter((b) => b.import_batch_id !== batch.import_batch_id))
    setConfirmBatch(null)
    setRemovingId(null)
  }

  if (!loading && batches.length === 0) return null

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Import history</h3>

      <div className="rounded-lg border divide-y">
        {loading ? (
          <>
            {[...Array(2)].map((_, i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <div className="h-4 w-32 rounded bg-muted animate-pulse" />
                <div className="h-4 w-20 rounded bg-muted animate-pulse ml-auto" />
              </div>
            ))}
          </>
        ) : (
          batches.map((batch) => (
            <div key={batch.import_batch_id} className="px-4 py-3 flex items-center gap-3 text-sm">
              <div>
                <span className="font-medium">
                  {new Date(batch.imported_at).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
                <span className="text-muted-foreground ml-2">
                  · {batch.tx_count} transaction{batch.tx_count !== 1 ? "s" : ""}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmBatch(batch)}
                disabled={removingId === batch.import_batch_id}
              >
                {removingId === batch.import_batch_id ? "Removing…" : "Remove"}
              </Button>
            </div>
          ))
        )}
      </div>

      <Dialog open={!!confirmBatch} onOpenChange={(open) => !open && setConfirmBatch(null)}>
        <DialogPopup className="max-w-sm">
          <DialogClose />
          <DialogTitle>
            Remove {confirmBatch?.tx_count} transaction{confirmBatch?.tx_count !== 1 ? "s" : ""}?
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            All transactions from this import will be permanently deleted. This cannot be undone.
          </DialogDescription>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setConfirmBatch(null)} disabled={!!removingId}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmBatch && handleRemove(confirmBatch)}
              disabled={!!removingId}
            >
              {removingId ? "Removing…" : "Remove"}
            </Button>
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  )
}
