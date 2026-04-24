'use client'

export type BatchResult = {
  fileName: string
  ok: boolean
  kind: 'transactions' | 'balance_sheet' | 'error'
  imported?: number
  duplicates?: number
  errors?: number
  balanceSheet?: {
    assets_created: number
    assets_updated: number
    liabilities_created: number
    liabilities_updated: number
    holdings_created: number
    holdings_updated: number
  }
  error?: string
}

function summariseBalanceSheet(s: NonNullable<BatchResult['balanceSheet']>) {
  const bits: string[] = []
  if (s.assets_created) bits.push(`${s.assets_created} new asset${s.assets_created === 1 ? '' : 's'}`)
  if (s.assets_updated) bits.push(`${s.assets_updated} updated`)
  if (s.holdings_created) bits.push(`${s.holdings_created} holding${s.holdings_created === 1 ? '' : 's'} added`)
  if (s.holdings_updated) bits.push(`${s.holdings_updated} updated`)
  if (s.liabilities_created) bits.push(`${s.liabilities_created} new debt${s.liabilities_created === 1 ? '' : 's'}`)
  if (s.liabilities_updated) bits.push(`${s.liabilities_updated} updated`)
  return bits.join(', ') || 'no changes'
}

export function BatchSummary({ results, onDone }: { results: BatchResult[]; onDone: () => void }) {
  const succeeded = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)

  return (
    <div className="space-y-4 py-4">
      <div className="text-center">
        <div className="text-2xl">{failed.length === 0 ? '✅' : '⚠️'}</div>
        <p className="text-sm text-foreground mt-1">
          Imported {succeeded.length} of {results.length} file{results.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="space-y-2">
        {results.map((r, i) => (
          <div key={i} className="flex items-start gap-2 text-sm border-b border-border pb-2 last:border-0">
            <span className={r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
              {r.ok ? '✓' : '✗'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-foreground truncate">{r.fileName}</div>
              {r.ok && r.kind === 'transactions' && (
                <div className="text-xs text-muted-foreground">
                  {r.imported} imported
                  {r.duplicates ? `, ${r.duplicates} duplicate${r.duplicates === 1 ? '' : 's'}` : ''}
                  {r.errors ? `, ${r.errors} error${r.errors === 1 ? '' : 's'}` : ''}
                </div>
              )}
              {r.ok && r.kind === 'balance_sheet' && r.balanceSheet && (
                <div className="text-xs text-muted-foreground">
                  {summariseBalanceSheet(r.balanceSheet)}
                </div>
              )}
              {!r.ok && r.error && (
                <div className="text-xs text-red-600 dark:text-red-400">{r.error}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {failed.length > 0 && failed.length < results.length && (
        <p className="text-xs text-muted-foreground text-center">
          Successful imports are saved — you can retry the failed files separately.
        </p>
      )}

      <button
        onClick={onDone}
        className="w-full rounded-md border border-input px-4 py-2 text-sm min-h-[44px]"
      >
        Continue
      </button>
    </div>
  )
}
