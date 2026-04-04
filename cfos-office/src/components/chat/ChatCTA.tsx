import Link from 'next/link'

interface Props {
  type: string
  label: string
}

export function ChatCTA({ type, label }: Props) {
  if (type === 'value_map') {
    return (
      <div className="mt-3 px-3">
        <Link
          href="/demo"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl
                     bg-foreground text-background text-sm font-medium
                     hover:opacity-90 transition-opacity min-h-[44px]"
        >
          <span>◇</span> {label}
        </Link>
      </div>
    )
  }
  return null
}
