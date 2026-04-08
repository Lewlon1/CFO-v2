import Link from 'next/link'

interface Props {
  completeness: number
  className?: string
}

export function ProfileCompleteness({ completeness, className }: Props) {
  const pct = Math.max(0, Math.min(100, Math.round(completeness)))

  return (
    <Link
      href="/profile"
      className={`block px-3 py-3 rounded-lg hover:bg-accent transition-colors ${className ?? ''}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-muted-foreground">CFO profile</span>
        <span className="text-xs tabular-nums font-medium text-muted-foreground">
          {pct}%
        </span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground/70 mt-1.5 leading-snug">
        The more I know, the sharper my advice.
      </p>
    </Link>
  )
}
