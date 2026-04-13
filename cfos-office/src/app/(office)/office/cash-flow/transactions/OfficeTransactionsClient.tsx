'use client'

import { useState, useMemo } from 'react'
import { MonthSelector, FilterPills, TransactionRow, SectionTitle } from '@/components/data'
import { formatMonth } from '@/lib/constants/dashboard'
import type { ValueCategory } from '@/lib/tokens'

interface Transaction {
  id: string
  date: string
  description: string
  amount: number
  currency: string
  category_id: string | null
  value_category: string | null
}

interface OfficeTransactionsClientProps {
  transactions: Transaction[]
  categoryMap: Record<string, { name: string; icon: string; color: string }>
}

export function OfficeTransactionsClient({ transactions, categoryMap }: OfficeTransactionsClientProps) {
  const [activeFilter, setActiveFilter] = useState('all')

  // Build unique filter options from categories present in transactions
  const filterOptions = useMemo(() => {
    const catCounts: Record<string, number> = {}
    for (const tx of transactions) {
      const cat = tx.category_id ? categoryMap[tx.category_id]?.name ?? 'Other' : 'Other'
      catCounts[cat] = (catCounts[cat] ?? 0) + 1
    }
    const sorted = Object.entries(catCounts).sort(([, a], [, b]) => b - a).slice(0, 5)
    return [
      { id: 'all', label: `All (${transactions.length})` },
      ...sorted.map(([name]) => ({ id: name.toLowerCase(), label: name })),
    ]
  }, [transactions, categoryMap])

  // Filter transactions
  const filtered = useMemo(() => {
    if (activeFilter === 'all') return transactions
    return transactions.filter(tx => {
      const cat = tx.category_id ? categoryMap[tx.category_id]?.name ?? '' : ''
      return cat.toLowerCase() === activeFilter
    })
  }, [transactions, activeFilter, categoryMap])

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

  const monthLabel = transactions[0]?.date
    ? formatMonth(transactions[0].date.slice(0, 7))
    : formatMonth(new Date().toISOString().slice(0, 7))

  const formatDateLabel = (dateStr: string) => {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return `${d.getUTCDate()} ${d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })}`
  }

  const handleValueChange = async (txId: string, newCategory: ValueCategory) => {
    try {
      // Map display value 'unsure' to DB enum 'no_idea'
      const dbValue = newCategory === 'unsure' ? 'no_idea' : newCategory
      await fetch('/api/corrections/signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: txId, value_category: dbValue }),
      })
    } catch {
      // Silently fail — pill already updated optimistically
    }
  }

  return (
    <div className="px-3.5 pt-1.5 pb-24">
      <MonthSelector label={monthLabel} />
      <FilterPills options={filterOptions} activeId={activeFilter} onChange={setActiveFilter} />

      {grouped.length === 0 ? (
        <p className="text-[13px] text-[rgba(245,245,240,0.4)] text-center pt-8">No transactions found</p>
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
                  iconBg={cat ? `${cat.color}1A` : 'rgba(245,245,240,0.04)'}
                  iconColor={cat?.color ?? 'rgba(245,245,240,0.3)'}
                  merchant={tx.description}
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
