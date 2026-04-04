'use client'

type Props = {
  active: 'spending' | 'values'
  onChange: (view: 'spending' | 'values') => void
}

export function ViewToggle({ active, onChange }: Props) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted p-0.5">
      <button
        onClick={() => onChange('spending')}
        className={`px-4 py-2 text-sm font-medium rounded-md transition-colors min-h-[40px] ${
          active === 'spending'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Spending View
      </button>
      <button
        onClick={() => onChange('values')}
        className={`px-4 py-2 text-sm font-medium rounded-md transition-colors min-h-[40px] ${
          active === 'values'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Values View
      </button>
    </div>
  )
}
