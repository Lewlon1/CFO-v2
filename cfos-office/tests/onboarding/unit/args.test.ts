import { describe, it, expect } from 'vitest'
import { parseArgs } from '../runner/args'

describe('parseArgs', () => {
  it('returns defaults when no args', () => {
    expect(parseArgs([])).toEqual({
      personas: null,
      skipJudge: false,
      keepUsers: false,
      concurrency: 2,
      noUnit: false,
      runId: null,
    })
  })

  it('parses --personas as comma-separated list', () => {
    const out = parseArgs(['--personas', 'drifter-expat,builder-classic'])
    expect(out.personas).toEqual(['drifter-expat', 'builder-classic'])
  })

  it('parses --personas=id1,id2 form', () => {
    const out = parseArgs(['--personas=drifter-expat,builder-classic'])
    expect(out.personas).toEqual(['drifter-expat', 'builder-classic'])
  })

  it('parses --skip-judge flag', () => {
    expect(parseArgs(['--skip-judge']).skipJudge).toBe(true)
  })

  it('parses --keep-users flag', () => {
    expect(parseArgs(['--keep-users']).keepUsers).toBe(true)
  })

  it('parses --concurrency value', () => {
    expect(parseArgs(['--concurrency', '1']).concurrency).toBe(1)
  })

  it('parses --run-id value', () => {
    expect(parseArgs(['--run-id', 'my-run']).runId).toBe('my-run')
  })

  it('rejects invalid concurrency', () => {
    expect(() => parseArgs(['--concurrency', 'abc'])).toThrow()
  })

  it('combines multiple flags', () => {
    const out = parseArgs(['--personas', 'drifter-expat', '--skip-judge', '--concurrency', '1'])
    expect(out).toEqual({
      personas: ['drifter-expat'],
      skipJudge: true,
      keepUsers: false,
      concurrency: 1,
      noUnit: false,
      runId: null,
    })
  })
})
