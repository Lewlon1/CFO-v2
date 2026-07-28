import type { BatchResult } from './BatchSummary'

export type BatchTelemetry = {
  files_attempted: number
  files_succeeded: number
  files_failed: number
  transactions_imported: number
}

/**
 * Pure summarisation of a completed upload batch, extracted from
 * UploadWizard's advanceOrFinish so the counting rules are unit-testable in
 * isolation (the shape of bug this fixes — files silently dropped from a
 * multi-file batch — is invisible without a durable per-batch count to check
 * against; see Issue 2 of the beta-blockers remediation plan).
 */
export function summariseBatchTelemetry(
  results: BatchResult[],
  filesAttempted: number,
): BatchTelemetry {
  const filesSucceeded = results.filter((r) => r.ok).length
  const transactionsImported = results.reduce(
    (sum, r) => sum + (r.kind === 'transactions' ? (r.imported ?? 0) : 0),
    0,
  )
  return {
    files_attempted: filesAttempted,
    files_succeeded: filesSucceeded,
    files_failed: filesAttempted - filesSucceeded,
    transactions_imported: transactionsImported,
  }
}
