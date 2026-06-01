'use client'

import { useState, useMemo } from 'react'
import { MonthSelector, FilterPills, TransactionRow, SectionTitle } from '@/components/data'
import { formatMonth } from '@/lib/constants/dashboard'
import type { ValueCategory } from '@/lib/tokens'
import type { Database } from '@/lib/supabase/types'

// Server page selects exactly these columns from `transactions`. Using Pick of
// the canonical Row type keeps nullability honest (description, currency,
// value_category may all be null in the DB) instead of redefining a parallel
// shape that silently asserts non-null.
type Transaction = Pick<
  Database['public']['Tables']['transactions']['Row'],
  'id' | 'date' | 'description' | 'amount' | 'currency' | 'category_id' | 'value_category'
>

interface OfficeTransactionsClientProps {
  transactions: Transaction[]
  categoryMap: Record<string, { name: string; icon: string; color: string }>
}

export function OfficeTransactionsClient({ transactions, categoryMap }: OfficeTransactionsClientProps) {
  // Distinct YYYY-MM strings present in the data, sorted newest → oldest.
  const availableMonths = useMemo(() => {
    const months = new Set<string>()
    for (const tx of transactions) months.add(tx.date.slice(0, 7))
    return Array.from(months).sort().reverse()
  }, [transactions])

  const [currentMonth, setCurrentMonth] = useState<string>(
    () => availableMonths[0] ?? new Date().toISOString().slice(0, 7),
  )
  const [activeFilter, setActiveFilter] = useState('all')

  // Reset the category filter when the user navigates months — a category
  // mix from one month doesn't necessarily exist in the next.
  const handleMonthChange = (next: string) => {
    setCurrentMonth(next)
    setActiveFilter('all')
  }

  const monthScopedTxns = useMemo(
    () => transactions.filter((tx) => tx.date.slice(0, 7) === currentMonth),
    [transactions, currentMonth],
  )

  // Build unique filter options from categories present in the visible month.
  const filterOptions = useMemo(() => {
    const catCounts: Record<string, number> = {}
    for (const tx of monthScopedTxns) {
      const cat = tx.category_id ? categoryMap[tx.category_id]?.name ?? 'Other' : 'Other'
      catCounts[cat] = (catCounts[cat] ?? 0) + 1
    }
    const sorted = Object.entries(catCounts).sort(([, a], [, b]) => b - a).slice(0, 5)
    return [
      { id: 'all', label: `All (${monthScopedTxns.length})` },
      ...sorted.map(([name]) => ({ id: name.toLowerCase(), label: name })),
    ]
  }, [monthScopedTxns, categoryMap])

  // Filter the month-scoped set by category.
  const filtered = useMemo(() => {
    if (activeFilter === 'all') return monthScopedTxns
    return monthScopedTxns.filter(tx => {
      const cat = tx.category_id ? categoryMap[tx.category_id]?.name ?? '' : ''
      return cat.toLowerCase() === activeFilter
    })
  }, [monthScopedTxns, activeFilter, categoryMap])

  // Group by date
  const grouped = useMemo(() => {
    const groups: Record<string, Transaction[]> = {}
    for (const tx of filtered) {
      const dateKey = tx.date.slice(0, 10) // normalize to YYYY-MM-DD
      if (!groups[dateKey]) groups[dateKey] = []
      groups[dateKey].push(tx)
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a))
  }, [filtered])

  const monthLabel = formatMonth(currentMonth)
  const currentMonthIdx = availableMonths.indexOf(currentMonth)
  const handlePrev = () => {
    // availableMonths is sorted desc, so "previous calendar month" = next index.
    const next = availableMonths[currentMonthIdx + 1]
    if (next) handleMonthChange(next)
  }
  const handleNext = () => {
    const next = availableMonths[currentMonthIdx - 1]
    if (next) handleMonthChange(next)
  }

  const formatDateLabel = (dateStr: string) => {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return `${d.getUTCDate()} ${d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })}`
  }

  const handleValueChange = async (txId: string, newCategory: ValueCategory) => {
    try {
      const res = await fetch('/api/corrections/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: txId, value_category: newCategory }),
      })
      if (!res.ok) {
        // Optimistic UI already updated — surface the failure so we know the
        // server didn't get the correction. We don't roll back the pill (the
        // user has moved on); we want the noise in logs/console so we can fix
        // it before users start losing categorisations.
        console.error(
          '[OfficeTransactionsClient] correction signal POST failed',
          { txId, status: res.status },
        )
      }
    } catch (err) {
      // Pill already updated optimistically; the server didn't see the change.
      // Don't roll back — just make sure the failure is visible.
      console.error('[OfficeTransactionsClient] correction signal threw', err)
    }
  }

  return (
    <div className="px-3.5 pt-1.5 pb-24">
      <MonthSelector label={monthLabel} onPrev={handlePrev} onNext={handleNext} />
      <FilterPills options={filterOptions} activeId={activeFilter} onChange={setActiveFilter} />

      {grouped.length === 0 ? (
        <p className="text-[13px] text-text-tertiary text-center pt-8">No transactions found</p>
      ) : (
        grouped.map(([date, txns]) => (
          <div key={date}>
            <SectionTitle>{formatDateLabel(date)}</SectionTitle>
            {txns.map(tx => {
              const cat = tx.category_id ? categoryMap[tx.category_id] : null
              const VALID_VC = new Set(['foundation', 'investment', 'leak', 'burden', 'unsure'])
              const vc: ValueCategory = VALID_VC.has(tx.value_category ?? '') ? tx.value_category as ValueCategory : 'unsure'
              return (
                <TransactionRow
                  key={tx.id}
                  icon={cat?.icon ?? '?'}
                  iconBg={cat ? `${cat.color}1A` : 'var(--muted)'}
                  iconColor={cat?.color ?? 'var(--text-tertiary)'}
                  merchant={tx.description ?? '—'}
                  time={cat?.name ?? 'Uncategorised'}
                  category={cat?.name ?? ''}
                  amount={`${tx.amount < 0 ? '-' : ''}\u20AC${Math.abs(tx.amount).toFixed(2)}`}
                  valueCategory={vc}
                  onValueChange={(newCat) => handleValueChange(tx.id, newCat)}
                />
              )
            })}
          </div>
        ))
      )}
    </div>
  )
}
