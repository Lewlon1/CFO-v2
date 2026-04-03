import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import type { ValueMapTransaction } from './types'

const DEFAULT_COUNT = 12
const MIN_TRANSACTIONS = 5
const MIN_AMOUNT = 1
const MAX_PER_MERCHANT = 2
const SMALL_AMOUNT_THRESHOLD = 10

const TRANSFER_PATTERNS = /transfer|savings pot|isa |standing order|internal transfer|savings transfer|moneybox|plum |chip /i
const ATM_PATTERNS = /atm|cash withdrawal|cash machine|cashpoint/i
const UTILITY_PATTERNS = /electric|energy|gas |water |broadband|internet|council tax|phone|mobile|ee |o2 |vodafone|three |sky |bt /i
const UTILITY_CATEGORIES = ['utilities', 'bills', 'taxes & government']

function isTransfer(tx: ValueMapTransaction): boolean {
  if (tx.category_name?.toLowerCase() === 'transfers') return true
  const text = ` ${(tx.merchant ?? tx.description ?? '').toLowerCase()} `
  return TRANSFER_PATTERNS.test(text)
}

function isAtm(tx: ValueMapTransaction): boolean {
  const text = (tx.merchant ?? tx.description ?? '').toLowerCase()
  return ATM_PATTERNS.test(text)
}

function isUtility(tx: ValueMapTransaction): boolean {
  if (tx.category_name && UTILITY_CATEGORIES.includes(tx.category_name.toLowerCase())) return true
  const text = ` ${(tx.merchant ?? tx.description ?? '').toLowerCase()} `
  return UTILITY_PATTERNS.test(text)
}

/**
 * Selects a diverse set of transactions for the Value Map exercise.
 *
 * Algorithm:
 *   1. Exclude transfers and deprioritise ATM withdrawals
 *   2. Reserve slots: 1 recurring, 1 small (<£10), 1 utility/bill
 *   3. Fill remaining via round-robin (max 2 per merchant)
 *   4. Backfill with ATM if still under count
 *   5. Sort final selection by amount descending
 *
 * Returns empty array if fewer than MIN_TRANSACTIONS available.
 */
export function selectTransactions(
  transactions: ValueMapTransaction[],
  count: number = DEFAULT_COUNT,
): ValueMapTransaction[] {
  // Exclude transfers
  const nonTransfers = transactions.filter((t) => t.amount >= MIN_AMOUNT && !isTransfer(t))

  // Separate ATM (backfill pool) from main candidates
  const atmPool: ValueMapTransaction[] = []
  const candidates: ValueMapTransaction[] = []
  for (const tx of nonTransfers) {
    if (isAtm(tx)) atmPool.push(tx)
    else candidates.push(tx)
  }

  if (candidates.length < MIN_TRANSACTIONS) return []
  if (candidates.length <= count) {
    return [...candidates].sort((a, b) => b.amount - a.amount)
  }

  const selected = new Set<string>() // transaction IDs
  const merchantCount = new Map<string, number>() // normalised merchant → count picked
  const result: ValueMapTransaction[] = []

  function pick(tx: ValueMapTransaction): boolean {
    if (selected.has(tx.id)) return false
    const key = normaliseMerchant(tx.merchant ?? tx.description ?? 'unknown')
    if ((merchantCount.get(key) ?? 0) >= MAX_PER_MERCHANT) return false
    selected.add(tx.id)
    merchantCount.set(key, (merchantCount.get(key) ?? 0) + 1)
    result.push(tx)
    return true
  }

  // ── Reserve slots ───────────────────────────────────────────────────────────

  // 1. One recurring subscription
  const recurring = candidates
    .filter((t) => t.is_recurring)
    .sort((a, b) => b.amount - a.amount)
  if (recurring.length > 0) pick(recurring[0])

  // 2. One small transaction (under threshold)
  const small = candidates
    .filter((t) => t.amount < SMALL_AMOUNT_THRESHOLD && t.amount >= MIN_AMOUNT && !selected.has(t.id))
    .sort((a, b) => b.amount - a.amount)
  if (small.length > 0) pick(small[0])

  // 3. One utility/bill
  const utility = candidates
    .filter((t) => isUtility(t) && !selected.has(t.id))
    .sort((a, b) => b.amount - a.amount)
  if (utility.length > 0) pick(utility[0])

  // ── Fill remaining via round-robin ──────────────────────────────────────────

  const remaining = candidates
    .filter((t) => !selected.has(t.id) && t.amount >= SMALL_AMOUNT_THRESHOLD)

  // Group by normalised merchant
  const groups = new Map<string, ValueMapTransaction[]>()
  for (const tx of remaining) {
    const key = normaliseMerchant(tx.merchant ?? tx.description ?? 'unknown')
    const group = groups.get(key) ?? []
    group.push(tx)
    groups.set(key, group)
  }

  // Sort groups: rarest first, then by max amount descending
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    if (a[1].length !== b[1].length) return a[1].length - b[1].length
    const maxA = Math.max(...a[1].map((t) => t.amount))
    const maxB = Math.max(...b[1].map((t) => t.amount))
    return maxB - maxA
  })

  // Within each group, sort by amount descending
  for (const [, group] of sortedGroups) {
    group.sort((a, b) => b.amount - a.amount)
  }

  // Round-robin with merchant cap
  const groupPointers = new Map<number, number>()
  let round = 0
  while (result.length < count) {
    let pickedThisRound = false

    for (let gi = 0; gi < sortedGroups.length && result.length < count; gi++) {
      const [, group] = sortedGroups[gi]
      const pointer = groupPointers.get(gi) ?? 0

      if (pointer < group.length && round < group.length) {
        if (pick(group[pointer])) {
          groupPointers.set(gi, pointer + 1)
          pickedThisRound = true
        } else {
          // Merchant cap hit — skip
          groupPointers.set(gi, pointer + 1)
        }
      }
    }

    if (!pickedThisRound) break
    round++
  }

  // ── Backfill with ATM if still short ────────────────────────────────────────

  if (result.length < count) {
    atmPool.sort((a, b) => b.amount - a.amount)
    for (const tx of atmPool) {
      if (result.length >= count) break
      pick(tx)
    }
  }

  // Sort final selection: biggest amount first
  return result.sort((a, b) => b.amount - a.amount)
}
