import { describe, it, expect } from 'vitest'
import { buildMemoryFilesContract } from '../context-builder'

/**
 * The filing-cabinet contract is the static half of the feature: it ships on
 * every turn and carries no user data, which is what allows it to sit inside
 * the cached prompt prefix. These tests pin the two properties that are easy to
 * break by accident — byte-stability, and the rules that stop the cabinet
 * turning into a second, staler copy of the user's numbers.
 */
describe('buildMemoryFilesContract', () => {
  it('is byte-identical across calls', () => {
    // A date, a count, or anything else user- or time-derived slipping in here
    // would invalidate the cache prefix on every turn.
    expect(buildMemoryFilesContract()).toBe(buildMemoryFilesContract())
  })

  it('carries no clock- or user-derived content', () => {
    const contract = buildMemoryFilesContract()
    const thisYear = String(new Date().getUTCFullYear())

    // The only years allowed are the ones inside the illustrative examples.
    const yearsOutsideExamples = contract
      .split('\n')
      .filter((line) => line.includes(thisYear) && !line.includes('€40k'))

    expect(yearsOutsideExamples).toEqual([])
    expect(contract).not.toMatch(/\bundefined\b|\bnull\b|\bNaN\b/)
  })

  it('makes reading mandatory, not advisory', () => {
    const contract = buildMemoryFilesContract()
    expect(contract).toContain('WHEN TO READ (MANDATORY)')
    expect(contract).toMatch(/You MUST call `read_memory_file`/)
  })

  it('bans current figures and anything a structured tool owns', () => {
    const contract = buildMemoryFilesContract()
    expect(contract).toContain('NEVER put in a file')
    expect(contract).toMatch(/figure presented as current/i)
    // The four structured tools whose data must never be duplicated into prose.
    for (const tool of [
      'create_goal',
      'upsert_asset',
      'update_user_profile',
      'record_value_classifications',
    ]) {
      expect(contract).toContain(tool)
    }
  })

  it('states that user edits win', () => {
    const contract = buildMemoryFilesContract()
    expect(contract).toContain('USER EDITS ARE AUTHORITATIVE')
    expect(contract).toMatch(/[Nn]ever contradict or rewrite them/)
  })

  it('keeps the mechanism out of the CFO’s mouth', () => {
    const contract = buildMemoryFilesContract()
    expect(contract).toContain('Never name the mechanism')
    // The folders must be named the way the user sees them in the office.
    for (const label of ['Goals', 'Cash Flow', 'Values & You', 'Net Worth']) {
      expect(contract).toContain(label)
    }
  })

  it('stays inside its token budget', () => {
    // ~4 chars per token. The contract is the fixed cost of the feature on
    // every turn, so it has to stay small enough to be worth the retrieval.
    expect(buildMemoryFilesContract().length).toBeLessThan(3600)
  })
})
