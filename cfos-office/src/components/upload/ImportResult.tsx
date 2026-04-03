type Props = {
  imported: number
  duplicates: number
  errors: number
  onDone: () => void
}

export function ImportResult({ imported, duplicates, errors, onDone }: Props) {
  return (
    <div className="text-center space-y-4 py-4">
      <div className="text-4xl">{errors === 0 ? '✅' : '⚠️'}</div>
      <div>
        <p className="font-semibold text-foreground text-lg">Import complete</p>
        <div className="text-sm text-muted-foreground mt-2 space-y-1">
          <p>
            <span className="font-medium text-foreground">{imported}</span> transactions imported
          </p>
          {duplicates > 0 && <p>{duplicates} duplicates skipped</p>}
          {errors > 0 && <p className="text-destructive">{errors} errors</p>}
        </div>
      </div>
      <button
        onClick={onDone}
        className="rounded-md bg-primary text-primary-foreground px-6 py-2 text-sm font-medium"
      >
        View transactions
      </button>
    </div>
  )
}
