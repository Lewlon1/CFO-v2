import { describe, it, expect } from 'vitest'
import { summariseBatchTelemetry } from './batch-telemetry'
import type { BatchResult } from './BatchSummary'

describe('summariseBatchTelemetry — Issue 2 regression', () => {
  it('reports all 3 files for a fully-successful 3-file batch (the dorcas bug: files 2-3 vanished with no record)', () => {
    const results: BatchResult[] = [
      { fileName: 'jan.csv', ok: true, kind: 'transactions', imported: 72, duplicates: 0, errors: 0 },
      { fileName: 'feb.csv', ok: true, kind: 'transactions', imported: 65, duplicates: 2, errors: 0 },
      { fileName: 'mar.csv', ok: true, kind: 'transactions', imported: 58, duplicates: 1, errors: 0 },
    ]
    const telemetry = summariseBatchTelemetry(results, 3)
    expect(telemetry).toEqual({
      files_attempted: 3,
      files_succeeded: 3,
      files_failed: 0,
      transactions_imported: 72 + 65 + 58,
    })
  })

  it('counts partial failures correctly (2 succeed, 1 fails)', () => {
    const results: BatchResult[] = [
      { fileName: 'jan.csv', ok: true, kind: 'transactions', imported: 72, duplicates: 0, errors: 0 },
      { fileName: 'feb.csv', ok: false, kind: 'error', error: 'Unsupported file type.' },
      { fileName: 'mar.csv', ok: true, kind: 'transactions', imported: 58, duplicates: 0, errors: 0 },
    ]
    const telemetry = summariseBatchTelemetry(results, 3)
    expect(telemetry).toEqual({
      files_attempted: 3,
      files_succeeded: 2,
      files_failed: 1,
      transactions_imported: 72 + 58,
    })
  })

  it('does not count a failed file kind toward transactions_imported', () => {
    const results: BatchResult[] = [
      { fileName: 'bad.csv', ok: false, kind: 'error', error: 'Network error' },
    ]
    const telemetry = summariseBatchTelemetry(results, 1)
    expect(telemetry.transactions_imported).toBe(0)
    expect(telemetry.files_succeeded).toBe(0)
    expect(telemetry.files_failed).toBe(1)
  })
})
