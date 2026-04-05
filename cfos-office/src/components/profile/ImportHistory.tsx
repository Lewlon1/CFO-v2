'use client'

interface ImportBatch {
  import_batch_id: string
  source: string
  transaction_count: number
  earliest_date: string
  latest_date: string
  imported_at: string
}

interface ImportHistoryProps {
  imports: ImportBatch[]
}

const SOURCE_LABELS: Record<string, string> = {
  csv_revolut: 'Revolut CSV',
  csv_santander: 'Santander CSV',
  csv_generic: 'CSV',
  csv_import: 'CSV',
  CSV: 'CSV',
  xlsx: 'Spreadsheet',
  screenshot: 'Screenshot',
  manual: 'Manual entry',
}

export function ImportHistory({ imports }: ImportHistoryProps) {
  if (imports.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No imports yet. Upload a CSV or screenshot to get started.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {imports.map((imp) => (
        <div
          key={imp.import_batch_id}
          className="flex items-center justify-between py-3 px-3 bg-muted/50 rounded-lg text-sm"
        >
          <div className="flex-1 min-w-0">
            <span className="font-medium">
              {imp.transaction_count} transactions
            </span>
            <span className="text-muted-foreground ml-2">
              via {SOURCE_LABELS[imp.source] ?? imp.source}
            </span>
          </div>
          <div className="text-xs text-muted-foreground text-right flex-shrink-0 ml-4">
            <div>
              {new Date(imp.earliest_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              {' – '}
              {new Date(imp.latest_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
            <div className="mt-0.5">
              Imported {new Date(imp.imported_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
