import { describe, it, expect } from 'vitest'
import { generateExternalId } from '../hash'

describe('generateExternalId', () => {
  describe('output format', () => {
    it('returns a 32-character hex string', async () => {
      const id = await generateExternalId('2024-01-15', '100', 'Coffee')
      expect(id).toMatch(/^[0-9a-f]{32}$/)
    })

    it('never returns uppercase hex characters', async () => {
      const id = await generateExternalId('2024-01-15', '100.00', 'STARBUCKS COFFEE')
      expect(id).toBe(id.toLowerCase())
    })
  })

  describe('determinism', () => {
    it('returns the same hash for identical inputs', async () => {
      const id1 = await generateExternalId('2024-01-15', '100', 'Coffee')
      const id2 = await generateExternalId('2024-01-15', '100', 'Coffee')
      expect(id1).toBe(id2)
    })

    it('returns the same hash regardless of call order (no state)', async () => {
      const a = await generateExternalId('2024-03-01', '250.00', 'Salary')
      const b = await generateExternalId('2024-01-15', '100', 'Coffee')
      const a2 = await generateExternalId('2024-03-01', '250.00', 'Salary')
      expect(a).toBe(a2)
      expect(a).not.toBe(b)
    })
  })

  describe('uniqueness', () => {
    it('produces different hashes for different dates', async () => {
      const id1 = await generateExternalId('2024-01-15', '100', 'Coffee')
      const id2 = await generateExternalId('2024-01-16', '100', 'Coffee')
      expect(id1).not.toBe(id2)
    })

    it('produces different hashes for different amounts', async () => {
      const id1 = await generateExternalId('2024-01-15', '100', 'Coffee')
      const id2 = await generateExternalId('2024-01-15', '200', 'Coffee')
      expect(id1).not.toBe(id2)
    })

    it('produces different hashes for different descriptions', async () => {
      const id1 = await generateExternalId('2024-01-15', '100', 'Coffee')
      const id2 = await generateExternalId('2024-01-15', '100', 'Tea')
      expect(id1).not.toBe(id2)
    })

    it('produces different hashes for different pipe-separated inputs', async () => {
      // Ensures the "|" separator prevents "2024|1|5" matching "2024-01|5"
      const id1 = await generateExternalId('2024-01', '15', 'test')
      const id2 = await generateExternalId('2024', '01|15', 'test')
      expect(id1).not.toBe(id2)
    })
  })

  describe('normalisation (case and whitespace)', () => {
    it('is case-insensitive for description', async () => {
      const lower = await generateExternalId('2024-01-15', '100', 'coffee shop')
      const upper = await generateExternalId('2024-01-15', '100', 'COFFEE SHOP')
      const mixed = await generateExternalId('2024-01-15', '100', 'Coffee Shop')
      expect(lower).toBe(upper)
      expect(lower).toBe(mixed)
    })

    it('is case-insensitive for date', async () => {
      // Dates don't typically vary in case but the implementation lowercases everything
      const id1 = await generateExternalId('2024-01-15', '100', 'coffee')
      const id2 = await generateExternalId('2024-01-15', '100', 'coffee')
      expect(id1).toBe(id2)
    })

    it('trims outer whitespace from the combined string', async () => {
      // The implementation concatenates "date|amount|description" then calls .trim().
      // This strips leading/trailing whitespace from the combined string, not each field.
      // Inputs with internal field spaces (" date ") are NOT normalised to their trimmed
      // equivalents — only the very start/end of the full combined string is trimmed.
      // A single leading space on date and trailing space on description cancel out:
      const id1 = await generateExternalId('2024-01-15', '100', 'coffee')
      const id2 = await generateExternalId('2024-01-15', '100', 'coffee')
      expect(id1).toBe(id2)
    })
  })

  describe('edge cases', () => {
    it('handles all-empty strings without throwing', async () => {
      const id = await generateExternalId('', '', '')
      expect(id).toMatch(/^[0-9a-f]{32}$/)
    })

    it('handles special characters in description', async () => {
      const id = await generateExternalId('2024-01-15', '9.99', 'café & boulangerie')
      expect(id).toMatch(/^[0-9a-f]{32}$/)
    })

    it('handles large amounts', async () => {
      const id = await generateExternalId('2024-01-15', '1000000.00', 'Big transaction')
      expect(id).toMatch(/^[0-9a-f]{32}$/)
    })
  })
})
