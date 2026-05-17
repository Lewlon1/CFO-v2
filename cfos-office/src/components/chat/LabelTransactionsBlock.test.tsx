import { describe, expect, it } from 'vitest'
import {
  buildLabelRecapTrigger,
  buildSignalPayload,
  formatRowAmount,
  formatRowDate,
  isAllLabelled,
  type LabelTransactionsTransaction,
} from './LabelTransactionsBlock'

// Component-level DOM tests are intentionally omitted — the project doesn't
// have testing-library/react installed (see cfos-office/package.json). What
// matters about LabelTransactionsBlock from a correctness standpoint lives in
// its pure helpers: the signal payload shape, the all-labelled gate, and the
// date/amount formatters. Visual behaviour is covered by manual review against
// docs/design/prototypes/label-transactions-prototype.jsx.

describe('buildSignalPayload', () => {
  it('maps the args to the route contract verbatim', () => {
    expect(buildSignalPayload('tx-1', 'foundation')).toEqual({
      transaction_id: 'tx-1',
      value_category: 'foundation',
    })
  })

  it("emits 'unsure' as a valid value_category — the route accepts it directly", () => {
    // /api/corrections/signal includes 'unsure' in VALID_VALUES (route line 8),
    // so the block treats it identically to the four content quadrants.
    expect(buildSignalPayload('tx-2', 'unsure')).toEqual({
      transaction_id: 'tx-2',
      value_category: 'unsure',
    })
  })
})

describe('isAllLabelled', () => {
  const tx = (id: string): LabelTransactionsTransaction => ({
    id,
    date: '2026-03-08',
    merchant: 'Glovo',
    amount: 18.5,
  })

  it('false when transactions is empty (nothing to send)', () => {
    expect(isAllLabelled([], {})).toBe(false)
  })

  it('false when at least one transaction has no label', () => {
    expect(
      isAllLabelled([tx('a'), tx('b'), tx('c')], { a: 'leak', b: 'investment' }),
    ).toBe(false)
  })

  it('true only when every transaction has a label', () => {
    expect(
      isAllLabelled([tx('a'), tx('b')], { a: 'leak', b: 'investment' }),
    ).toBe(true)
  })

  it('extra labels for unknown transactions do not matter', () => {
    expect(
      isAllLabelled([tx('a')], { a: 'foundation', b: 'leak' }),
    ).toBe(true)
  })
})

describe('formatRowDate', () => {
  it('formats a YYYY-MM-DD as "Fri 8 Mar"', () => {
    // 2026-03-13 is a Friday
    expect(formatRowDate('2026-03-13')).toBe('Fri 13 Mar')
  })

  it('formats an ISO timestamp the same way (using a mid-day time so the conversion is timezone-stable)', () => {
    // 12:00 UTC stays on the same calendar day in every timezone the dev/CI
    // boxes use. 23:14 UTC (the prototype's value) would flip to next day in
    // any positive UTC offset.
    expect(formatRowDate('2026-03-13T12:00:00.000Z')).toBe('Fri 13 Mar')
  })

  it('returns empty string for empty input (defensive)', () => {
    expect(formatRowDate('')).toBe('')
  })
})

describe('formatRowAmount', () => {
  it('formats EUR with a leading minus and € symbol', () => {
    expect(formatRowAmount(18.5, 'EUR')).toBe('−€18.50')
  })

  it('uses the absolute value — the block displays spend rows', () => {
    // The tool emits magnitude (positive). The block prints the minus sign
    // itself. If a signed-negative slips through, abs() still produces the
    // right display.
    expect(formatRowAmount(-22, 'EUR')).toBe('−€22')
  })

  it('respects currency symbol for GBP', () => {
    expect(formatRowAmount(34, 'GBP')).toBe('−£34')
  })

  it('formats whole numbers without trailing decimals', () => {
    expect(formatRowAmount(12, 'EUR')).toBe('−€12')
  })

  it('formats fractional amounts with two decimals', () => {
    expect(formatRowAmount(12.5, 'EUR')).toBe('−€12.50')
  })
})

describe('buildLabelRecapTrigger', () => {
  const tx = (id: string, merchant: string): LabelTransactionsTransaction => ({
    id,
    merchant,
    date: '2026-03-08',
    amount: 18.5,
  })

  it('starts with the [System: hidden-trigger envelope', () => {
    const result = buildLabelRecapTrigger([tx('a', 'Glovo')], { a: 'leak' })
    expect(result.startsWith('[System: ')).toBe(true)
    expect(result.endsWith(']')).toBe(true)
  })

  it('groups merchants by quadrant in canonical order (foundation → unsure)', () => {
    const txs = [
      tx('a', 'Mercadona'),
      tx('b', 'Glovo'),
      tx('c', 'Gym'),
    ]
    const labels = { a: 'foundation', b: 'leak', c: 'investment' } as const
    const result = buildLabelRecapTrigger(txs, labels)
    // Canonical order is foundation → investment → leak → burden → unsure,
    // regardless of the order labels were applied in.
    const foundationIdx = result.indexOf('Foundation:')
    const investmentIdx = result.indexOf('Investment:')
    const leakIdx = result.indexOf('Leak:')
    expect(foundationIdx).toBeGreaterThan(-1)
    expect(investmentIdx).toBeGreaterThan(foundationIdx)
    expect(leakIdx).toBeGreaterThan(investmentIdx)
  })

  it('lists merchants inside their quadrant separated by commas', () => {
    const txs = [tx('a', 'Mercadona'), tx('b', 'Lidl')]
    const result = buildLabelRecapTrigger(txs, { a: 'foundation', b: 'foundation' })
    expect(result).toContain('Foundation: Mercadona, Lidl.')
  })

  it('omits quadrants that have no transactions', () => {
    const result = buildLabelRecapTrigger([tx('a', 'Glovo')], { a: 'leak' })
    expect(result).toContain('Leak: Glovo.')
    expect(result).not.toContain('Foundation:')
    expect(result).not.toContain('Investment:')
    expect(result).not.toContain('Burden:')
    expect(result).not.toContain('Unsure:')
  })

  it('falls back to "Unknown" when merchant is empty', () => {
    const txs: LabelTransactionsTransaction[] = [
      { id: 'a', merchant: '', date: '2026-03-08', amount: 5 },
    ]
    const result = buildLabelRecapTrigger(txs, { a: 'unsure' })
    expect(result).toContain('Unsure: Unknown.')
  })

  it('skips transactions that were not labelled (defensive)', () => {
    const txs = [tx('a', 'Glovo'), tx('b', 'Mercadona')]
    // Only 'a' has a label — 'b' is unlabelled. In practice handleSubmit gates
    // on isAllLabelled, but the helper must still produce valid output.
    const result = buildLabelRecapTrigger(txs, { a: 'leak' })
    expect(result).toContain('Leak: Glovo.')
    expect(result).not.toContain('Mercadona')
  })
})
