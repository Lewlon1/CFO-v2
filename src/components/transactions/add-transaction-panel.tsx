"use client"

import { useState, useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet"
import {
  Select,
  SelectTrigger,
  SelectPopup,
  SelectItem,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/toast"
import { categoriseTransaction } from "@/lib/categorisation/categorise-transaction"
import type { MerchantMapping } from "@/lib/categorisation/categorise-transaction"
import type {
  BankAccount,
  Category,
  Frequency,
  Transaction,
  TransactionType,
} from "@/lib/types/database"

const TRANSACTION_TYPES: { value: TransactionType; label: string }[] = [
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
  { value: "transfer", label: "Transfer" },
]

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
]

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingTransaction: Transaction | null
  accounts: BankAccount[]
  categories: Category[]
  profileId: string
  onSuccess: (tx: Transaction) => void
  onDelete?: (id: string) => void
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function AddTransactionPanel({
  open,
  onOpenChange,
  editingTransaction,
  accounts,
  categories,
  profileId,
  onSuccess,
  onDelete,
}: Props) {
  const supabase = createClient()
  const { toast } = useToast()

  const [date, setDate] = useState(editingTransaction?.transaction_date ?? todayISO())
  const [amount, setAmount] = useState(
    editingTransaction?.amount != null ? String(editingTransaction.amount) : ""
  )
  const [description, setDescription] = useState(editingTransaction?.description ?? "")
  const [merchant, setMerchant] = useState(editingTransaction?.merchant ?? "")
  const [type, setType] = useState<TransactionType>(editingTransaction?.type ?? "expense")
  const [categoryId, setCategoryId] = useState(editingTransaction?.category_id ?? "")
  const [accountId, setAccountId] = useState(
    editingTransaction?.bank_account_id ?? accounts[0]?.id ?? ""
  )
  const [isRecurring, setIsRecurring] = useState(editingTransaction?.is_recurring ?? false)
  const [frequency, setFrequency] = useState<Frequency>(
    editingTransaction?.frequency ?? "monthly"
  )
  const [nextDueDate, setNextDueDate] = useState(editingTransaction?.next_due_date ?? "")
  const [notes, setNotes] = useState(
    typeof editingTransaction?.metadata === "object" && editingTransaction?.metadata !== null
      ? ((editingTransaction.metadata as Record<string, unknown>).notes as string) ?? ""
      : ""
  )
  const [showNotes, setShowNotes] = useState(false)

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Merchant mappings for auto-categorisation
  const [mappings, setMappings] = useState<MerchantMapping[]>([])
  const merchantDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load mappings on mount
  useEffect(() => {
    supabase
      .from("merchant_category_map")
      .select("merchant_pattern, category_name, source, profile_id")
      .then(({ data }) => {
        if (data) setMappings(data as MerchantMapping[])
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDate(editingTransaction?.transaction_date ?? todayISO())
    setAmount(editingTransaction?.amount != null ? String(editingTransaction.amount) : "")
    setDescription(editingTransaction?.description ?? "")
    setMerchant(editingTransaction?.merchant ?? "")
    setType(editingTransaction?.type ?? "expense")
    setCategoryId(editingTransaction?.category_id ?? "")
    setAccountId(editingTransaction?.bank_account_id ?? accounts[0]?.id ?? "")
    setIsRecurring(editingTransaction?.is_recurring ?? false)
    setFrequency(editingTransaction?.frequency ?? "monthly")
    setNextDueDate(editingTransaction?.next_due_date ?? "")
    const n =
      typeof editingTransaction?.metadata === "object" && editingTransaction?.metadata !== null
        ? ((editingTransaction.metadata as Record<string, unknown>).notes as string) ?? ""
        : ""
    setNotes(n)
    setShowNotes(!!n)
    setError(null)
  }, [editingTransaction, accounts])

  // Auto-categorise as merchant is typed (debounced)
  function handleMerchantChange(value: string) {
    setMerchant(value)
    if (merchantDebounce.current) clearTimeout(merchantDebounce.current)
    merchantDebounce.current = setTimeout(() => {
      if (!value.trim() || categoryId) return
      const suggested = categoriseTransaction(value, mappings)
      if (suggested !== "Uncategorised") {
        const cat = categories.find((c) => c.name === suggested)
        if (cat) setCategoryId(cat.id)
      }
    }, 400)
  }

  const filteredCategories = categories.filter(
    (c) => c.type === type || c.type === undefined
  )

  async function handleSubmit() {
    if (!accountId) { setError("Please select an account."); return }
    const amountNum = parseFloat(amount)
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setError("Amount must be a positive number.")
      return
    }
    if (!date) { setError("Date is required."); return }

    setSaving(true)
    setError(null)

    const selectedAccount = accounts.find((a) => a.id === accountId)
    const selectedCategory = categories.find((c) => c.id === categoryId)

    const payload = {
      transaction_date: date,
      amount: amountNum,
      description: description.trim() || null,
      merchant: merchant.trim() || null,
      type,
      category_id: categoryId || null,
      bank_account_id: accountId,
      currency: selectedAccount?.currency ?? "EUR",
      is_recurring: isRecurring,
      frequency: isRecurring ? frequency : null,
      next_due_date: isRecurring && nextDueDate ? nextDueDate : null,
      recurrence_end: null,
      source: "manual" as const,
      external_id: null,
      metadata: notes.trim() ? { notes: notes.trim() } : {},
    }

    let savedTx: Transaction | null = null

    if (editingTransaction) {
      const previousCategoryId = editingTransaction.category_id
      const { data, error: dbErr } = await supabase
        .from("transactions")
        .update(payload)
        .eq("id", editingTransaction.id)
        .select()
        .single()
      if (dbErr) { setError(dbErr.message); setSaving(false); return }
      savedTx = data as Transaction

      // Learn category correction if merchant field + category changed
      const merchantText = merchant.trim().toLowerCase()
      if (
        merchantText &&
        categoryId &&
        categoryId !== previousCategoryId &&
        selectedCategory
      ) {
        await supabase.from("merchant_category_map").upsert(
          {
            profile_id: profileId,
            merchant_pattern: merchantText,
            category_name: selectedCategory.name,
            source: "user",
          },
          { onConflict: "id" }
        )
        toast(`Got it — future transactions from ${merchant.trim()} will be filed under ${selectedCategory.name}`)
      }
    } else {
      const { data, error: dbErr } = await supabase
        .from("transactions")
        .insert({ ...payload, profile_id: profileId })
        .select()
        .single()
      if (dbErr) { setError(dbErr.message); setSaving(false); return }
      savedTx = data as Transaction
    }

    if (savedTx) onSuccess(savedTx)
    setSaving(false)
    onOpenChange(false)
  }

  async function handleDelete() {
    if (!editingTransaction || !onDelete) return
    setDeleting(true)
    await supabase.from("transactions").delete().eq("id", editingTransaction.id)
    onDelete(editingTransaction.id)
    setDeleting(false)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetClose />
        <div className="p-6 space-y-4">
          <SheetTitle>
            {editingTransaction ? "Edit transaction" : "Add transaction"}
          </SheetTitle>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="tx-date">Date</Label>
              <Input
                id="tx-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v: unknown) => setType(v as TransactionType)}
              >
                <SelectTrigger>
                  <span>{TRANSACTION_TYPES.find((t) => t.value === type)?.label}</span>
                </SelectTrigger>
                <SelectPopup>
                  {TRANSACTION_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tx-amount">Amount</Label>
            <Input
              id="tx-amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tx-merchant">Merchant</Label>
            <Input
              id="tx-merchant"
              placeholder="e.g. Netflix"
              value={merchant}
              onChange={(e) => handleMerchantChange(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tx-desc">Description</Label>
            <Input
              id="tx-desc"
              placeholder="e.g. Monthly subscription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Account</Label>
              <Select
                value={accountId}
                onValueChange={(v: unknown) => setAccountId(v as string)}
              >
                <SelectTrigger>
                  {accounts.find((a) => a.id === accountId)
                    ? <span>{accounts.find((a) => a.id === accountId)!.name}</span>
                    : <span className="text-muted-foreground">Select account…</span>}
                </SelectTrigger>
                <SelectPopup>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={categoryId}
                onValueChange={(v: unknown) => setCategoryId(v as string)}
              >
                <SelectTrigger>
                  {categoryId
                    ? <span>{categories.find((c) => c.id === categoryId)?.name}</span>
                    : <span className="text-muted-foreground">Select category…</span>}
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="">No category</SelectItem>
                  {filteredCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="tx-recurring"
              type="checkbox"
              className="rounded border-input"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
            />
            <Label htmlFor="tx-recurring" className="cursor-pointer">
              Recurring transaction
            </Label>
          </div>

          {isRecurring && (
            <div className="grid grid-cols-2 gap-4 pl-4 border-l-2 border-muted">
              <div className="space-y-1.5">
                <Label>Frequency</Label>
                <Select
                  value={frequency}
                  onValueChange={(v: unknown) => setFrequency(v as Frequency)}
                >
                  <SelectTrigger>
                    <span>{FREQUENCIES.find((f) => f.value === frequency)?.label}</span>
                  </SelectTrigger>
                  <SelectPopup>
                    {FREQUENCIES.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tx-next-due">Next due date</Label>
                <Input
                  id="tx-next-due"
                  type="date"
                  value={nextDueDate}
                  onChange={(e) => setNextDueDate(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Collapsible notes */}
          {showNotes ? (
            <div className="space-y-1.5">
              <Label htmlFor="tx-notes">Notes</Label>
              <Textarea
                id="tx-notes"
                placeholder="Any additional notes…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="resize-none"
                rows={3}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              + Add notes
            </button>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            {editingTransaction && onDelete ? (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting || saving}
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={saving}>
                {saving ? "Saving…" : editingTransaction ? "Save changes" : "Add transaction"}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
