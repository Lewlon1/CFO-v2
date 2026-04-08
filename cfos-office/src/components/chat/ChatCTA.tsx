import Link from 'next/link'

interface Props {
  type: string
  label: string
}

export function ChatCTA({ type, label }: Props) {
  if (type === 'value_checkin') {
    return (
      <div className="mt-3 px-3">
        <Link
          href="/value-map?mode=checkin"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl
                     bg-[#E8A84C] text-black text-sm font-semibold
                     hover:opacity-90 transition-opacity min-h-[44px]"
        >
          <span>✓</span> {label}
        </Link>
      </div>
    )
  }
  return null
}
