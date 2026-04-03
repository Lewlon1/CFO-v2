"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "@/components/ui/select"
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

export function AddTransactionModal({
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

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    setError(null)
  }, [editingTransaction, accounts])

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
      metadata: {},
    }

    if (editingTransaction) {
      const { data, error: dbErr } = await supabase
        .from("transactions")
        .update(payload)
        .eq("id", editingTransaction.id)
        .select()
        .single()
      if (dbErr) { setError(dbErr.message); setSaving(false); return }
      onSuccess(data as Transaction)
    } else {
      const { data, error: dbErr } = await supabase
        .from("transactions")
        .insert({ ...payload, profile_id: profileId })
        .select()
        .single()
      if (dbErr) { setError(dbErr.message); setSaving(false); return }
      onSuccess(data as Transaction)
    }

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogClose />
        <DialogTitle className="mb-4">
          {editingTransaction ? "Edit transaction" : "Add transaction"}
        </DialogTitle>

        <div className="space-y-4">
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
                <SelectTrigger><SelectValue /></SelectTrigger>
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
            <Label htmlFor="tx-desc">Description</Label>
            <Input
              id="tx-desc"
              placeholder="e.g. Monthly subscription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tx-merchant">Merchant</Label>
            <Input
              id="tx-merchant"
              placeholder="e.g. Netflix"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Account</Label>
              <Select
                value={accountId}
                onValueChange={(v: unknown) => setAccountId(v as string)}
              >
                <SelectTrigger><SelectValue placeholder="Select account…" /></SelectTrigger>
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
                <SelectTrigger><SelectValue placeholder="Select category…" /></SelectTrigger>
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
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
      </DialogPopup>
    </Dialog>
  )
}
