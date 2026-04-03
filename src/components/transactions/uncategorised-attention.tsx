"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { CategoryPicker } from "./category-picker"
import { useToast } from "@/components/ui/toast"
import { normaliseMerchant } from "@/lib/categorisation/normalise-merchant"
import { getDisplayMerchant } from "@/lib/categorisation/merchant-display"
import { AddTransactionPanel } from "./add-transaction-panel"
import type { BankAccount, Category, Transaction } from "@/lib/types/database"

type TxWithMerchant = Transaction & { normalisedMerchant: string }

type Props = {
  profileId: string
  categories: Category[]
  onCategorised?: () => void
}

function isAttentionSkipped(metadata: unknown): boolean {
  return (metadata as Record<string, unknown> | null)?.attention_skipped === true
}

type AttentionRowProps = {
  tx: TxWithMerchant
  categories: Category[]
  duplicateIds: Set<string>
  dismissedDuplicates: Set<string>
  onDismissDuplicate: (id: string) => void
  onCategoryChange: (tx: TxWithMerchant, catId: string) => void
  onViewDetails: () => void
  onSkip: (() => void) | undefined
  onUnskip: (() => void) | undefined
  isSkipped: boolean
}

function AttentionRow({
  tx,
  categories,
  duplicateIds,
  dismissedDuplicates,
  onDismissDuplicate,
  onCategoryChange,
  onViewDetails,
  onSkip,
  onUnskip,
  isSkipped,
}: AttentionRowProps) {
  const { primary, secondary, isAmbiguous } = getDisplayMerchant(tx)

  return (
    <div
      className={`rounded-md bg-background border px-3 py-2.5 space-y-2 text-sm${isSkipped ? " opacity-50" : ""}`}
    >
      {/* Row 1: merchant + amount */}
      <div className="flex items-baseline gap-2">
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <span className="font-medium truncate">
            {primary}
            {isAmbiguous && (
              <span className="text-xs text-muted-foreground font-normal ml-1">(unknown)</span>
            )}
          </span>
          {secondary && (
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">{secondary}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {duplicateIds.has(tx.id) && !dismissedDuplicates.has(tx.id) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
              Possible duplicate
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDismissDuplicate(tx.id) }}
                className="hover:text-amber-800 dark:hover:text-amber-200"
                aria-label="Dismiss duplicate warning"
              >×</button>
            </span>
          )}
          <span className="font-medium text-red-500 tabular-nums">
            −{tx.amount.toLocaleString("en", { minimumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Row 2: date · account */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground tabular-nums">{tx.transaction_date}</span>
        {tx.account_name && (
          <>
            <span className="text-[10px] text-border">·</span>
            <span className="text-xs text-muted-foreground">{tx.account_name}</span>
          </>
        )}
      </div>

      {/* Row 3: category picker */}
      <CategoryPicker
        categories={categories.filter((c) => c.type === "expense" || c.type === undefined)}
        value={null}
        onValueChange={(catId) => onCategoryChange(tx, catId)}
        placeholder="Select category…"
        rowType="expense"
        className="h-9 w-full text-sm"
      />

      {/* Divider */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-border/50" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50">
          Can&apos;t categorise?
        </span>
        <div className="flex-1 h-px bg-border/50" />
      </div>

      {/* Row 4: secondary actions */}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onViewDetails}
          className="flex-1 min-h-[36px] flex items-center justify-center gap-1.5 rounded-md bg-muted border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors"
        >
          <span>↗</span> View details
        </button>
        {!isSkipped && onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="flex-1 min-h-[36px] flex items-center justify-center rounded-md border border-border/50 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
          >
            Skip for now
          </button>
        )}
        {isSkipped && onUnskip && (
          <button
            type="button"
            onClick={onUnskip}
            className="flex-1 min-h-[36px] flex items-center justify-center rounded-md border border-border/50 text-xs italic text-muted-foreground/70 hover:text-muted-foreground transition-colors"
          >
            Unskip
          </button>
        )}
      </div>
    </div>
  )
}

export function UncategorisedAttention({ profileId, categories, onCategorised }: Props) {
  const supabase = createClient()
  const { toast } = useToast()
  const [items, setItems] = useState<TxWithMerchant[]>([])
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loaded, setLoaded] = useState(false)
  const [dismissedDuplicates, setDismissedDuplicates] = useState<Set<string>>(new Set())
  const [showSkipped, setShowSkipped] = useState(false)
  const [editingTx, setEditingTx] = useState<TxWithMerchant | null>(null)

  const duplicateIds = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const tx of items) {
      const key = `${(tx.merchant ?? tx.description ?? "").toLowerCase().trim()}|${tx.transaction_date}|${tx.amount}`
      const group = groups.get(key) ?? []
      group.push(tx.id)
      groups.set(key, group)
    }
    const ids = new Set<string>()
    for (const group of groups.values()) {
      if (group.length >= 2) group.forEach((id) => ids.add(id))
    }
    return ids
  }, [items])

  const fetchUncategorised = useCallback(async () => {
    const { data } = await supabase
      .from("transactions")
      .select("*")
      .eq("profile_id", profileId)
      .is("category_id", null)
      .eq("type", "expense")
      .gte("amount", 10)
      .order("transaction_date", { ascending: false })
      .limit(20)

    const { data: accountData } = await supabase
      .from("bank_accounts")
      .select("*")
      .eq("profile_id", profileId)

    const withMerchant = ((data as Transaction[]) ?? []).map((tx) => ({
      ...tx,
      normalisedMerchant: normaliseMerchant(tx.merchant ?? tx.description ?? ""),
    }))
    setItems(withMerchant)
    setAccounts((accountData as BankAccount[]) ?? [])
    setLoaded(true)
  }, [supabase, profileId])

  useEffect(() => {
    fetchUncategorised()
  }, [fetchUncategorised])

  const activeItems = useMemo(
    () => items.filter((tx) => !isAttentionSkipped(tx.metadata)),
    [items]
  )

  const skippedItems = useMemo(
    () => items.filter((tx) => isAttentionSkipped(tx.metadata)),
    [items]
  )

  async function handleCategoryChange(tx: TxWithMerchant, catId: string) {
    const cat = categories.find((c) => c.id === catId)
    if (!cat) return

    // Find all items sharing the same normalised merchant
    const matching = items.filter((t) => t.normalisedMerchant === tx.normalisedMerchant)
    const matchingIds = matching.map((t) => t.id)

    // Optimistically remove all matches
    setItems((prev) => prev.filter((t) => t.normalisedMerchant !== tx.normalisedMerchant))

    // Batch update in DB
    await supabase
      .from("transactions")
      .update({ category_id: catId })
      .in("id", matchingIds)

    // Learn the mapping once
    const merchantText = (tx.merchant ?? tx.description ?? "").toLowerCase().trim()
    if (merchantText) {
      await supabase.from("merchant_category_map").upsert(
        {
          profile_id: profileId,
          merchant_pattern: tx.normalisedMerchant || merchantText,
          category_name: cat.name,
          source: "user",
        },
        { onConflict: "id" }
      )
    }

    const displayName = tx.merchant ?? tx.description ?? "Unknown"
    if (matching.length > 1) {
      toast(`Got it — ${matching.length} transactions from ${displayName} filed under ${cat.name}`)
    } else {
      toast(`Got it — future transactions from ${displayName} will be filed under ${cat.name}`)
    }

    onCategorised?.()
  }

  async function handleSkip(tx: TxWithMerchant) {
    const updatedMetadata = { ...(tx.metadata as Record<string, unknown> | null ?? {}), attention_skipped: true }

    // Optimistic update
    setItems((prev) =>
      prev.map((t) => (t.id === tx.id ? { ...t, metadata: updatedMetadata } : t))
    )

    const { error } = await supabase
      .from("transactions")
      .update({ metadata: updatedMetadata })
      .eq("id", tx.id)

    if (error) {
      // Revert on failure
      setItems((prev) =>
        prev.map((t) => (t.id === tx.id ? { ...t, metadata: tx.metadata } : t))
      )
      toast("Couldn't skip — please try again")
    }
  }

  async function handleUnskip(tx: TxWithMerchant) {
    const updatedMetadata = { ...(tx.metadata as Record<string, unknown> | null ?? {}), attention_skipped: false }

    // Optimistic update
    setItems((prev) =>
      prev.map((t) => (t.id === tx.id ? { ...t, metadata: updatedMetadata } : t))
    )

    const { error } = await supabase
      .from("transactions")
      .update({ metadata: updatedMetadata })
      .eq("id", tx.id)

    if (error) {
      // Revert on failure
      setItems((prev) =>
        prev.map((t) => (t.id === tx.id ? { ...t, metadata: tx.metadata } : t))
      )
      toast("Couldn't unskip — please try again")
    }
  }

  if (!loaded || (activeItems.length === 0 && skippedItems.length === 0)) return null

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-800/40 dark:bg-amber-950/10 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium flex-1">Needs your attention</p>
        <span className="rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          {activeItems.length}
        </span>
        {skippedItems.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSkipped((v) => !v)}
            className="text-xs text-muted-foreground border border-border rounded px-2 py-0.5 hover:border-muted-foreground transition-colors"
          >
            {skippedItems.length} skipped{showSkipped ? " ✓" : ""}
          </button>
        )}
      </div>

      {/* Active items */}
      <div className="space-y-1.5">
        {activeItems.map((tx) => (
          <AttentionRow
            key={tx.id}
            tx={tx}
            categories={categories}
            duplicateIds={duplicateIds}
            dismissedDuplicates={dismissedDuplicates}
            onDismissDuplicate={(id) => setDismissedDuplicates((prev) => new Set(prev).add(id))}
            onCategoryChange={handleCategoryChange}
            onViewDetails={() => setEditingTx(tx)}
            onSkip={() => handleSkip(tx)}
            isSkipped={false}
            onUnskip={undefined}
          />
        ))}
      </div>

      {/* Skipped section */}
      {showSkipped && skippedItems.length > 0 && (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 pt-1 px-0.5">
            Skipped
          </p>
          <div className="space-y-1.5">
            {skippedItems.map((tx) => (
              <AttentionRow
                key={tx.id}
                tx={tx}
                categories={categories}
                duplicateIds={duplicateIds}
                dismissedDuplicates={dismissedDuplicates}
                onDismissDuplicate={(id) => setDismissedDuplicates((prev) => new Set(prev).add(id))}
                onCategoryChange={handleCategoryChange}
                onViewDetails={() => setEditingTx(tx)}
                onSkip={undefined}
                isSkipped={true}
                onUnskip={() => handleUnskip(tx)}
              />
            ))}
          </div>
        </>
      )}

      {/* AddTransactionPanel */}
      {editingTx && (
        <AddTransactionPanel
          open={true}
          onOpenChange={(open) => { if (!open) setEditingTx(null) }}
          editingTransaction={editingTx}
          accounts={accounts}
          categories={categories}
          profileId={profileId}
          onSuccess={() => {
            setEditingTx(null)
            fetchUncategorised()
          }}
        />
      )}
    </div>
  )
}
