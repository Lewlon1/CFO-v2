import { describe, it, expect } from 'vitest'
import { computeHeaderHash, extractCsvSample } from '../fingerprint'

describe('computeHeaderHash', () => {
  it('produces the same hash regardless of column order', async () => {
    const a = await computeHeaderHash(['Date', 'Amount', 'Description'])
    const b = await computeHeaderHash(['Description', 'Date', 'Amount'])
    const c = await computeHeaderHash(['Amount', 'Description', 'Date'])
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('is case-insensitive and trims whitespace', async () => {
    const a = await computeHeaderHash(['Date', 'Amount', 'Description'])
    const b = await computeHeaderHash([' date ', 'AMOUNT', 'description'])
    expect(a).toBe(b)
  })

  it('ignores empty header cells', async () => {
    const a = await computeHeaderHash(['Date', 'Amount', 'Description'])
    const b = await computeHeaderHash(['Date', '', 'Amount', '  ', 'Description'])
    expect(a).toBe(b)
  })

  it('returns a 64-char hex string (SHA-256)', async () => {
    const hash = await computeHeaderHash(['Date', 'Amount'])
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('distinguishes different column sets', async () => {
    const a = await computeHeaderHash(['Date', 'Amount', 'Description'])
    const b = await computeHeaderHash(['Date', 'Debit', 'Credit', 'Description'])
    expect(a).not.toBe(b)
  })
})

describe('extractCsvSample', () => {
  it('returns the first N rows including the header', () => {
    const csv = ['h1,h2', 'a,1', 'b,2', 'c,3', 'd,4', 'e,5', 'f,6'].join('\n')
    const sample = extractCsvSample(csv, 5)
    expect(sample.split('\n')).toHaveLength(5)
    expect(sample.split('\n')[0]).toBe('h1,h2')
    expect(sample.split('\n')[4]).toBe('d,4')
  })

  it('handles CRLF line endings', () => {
    const csv = 'h1,h2\r\na,1\r\nb,2\r\nc,3'
    const sample = extractCsvSample(csv, 3)
    expect(sample.split('\n')).toEqual(['h1,h2', 'a,1', 'b,2'])
  })
})
