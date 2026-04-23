'use client'

import { ChevronLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface DetailHeaderProps {
  title: string
  color: string
  sub?: string
  backHref?: string
}

export function DetailHeader({ title, color, sub, backHref }: DetailHeaderProps) {
  const router = useRouter()

  const handleBack = () => {
    if (backHref) router.push(backHref)
    else router.back()
  }

  return (
    <div className="flex items-center gap-1.5 mb-[14px]">
      <button
        onClick={handleBack}
        aria-label="Back"
        className="flex items-center justify-center min-h-[44px] min-w-[44px] -ml-2"
        style={{ color }}
      >
        <ChevronLeft size={20} strokeWidth={2.2} />
      </button>
      <span
        className="text-[19px] font-bold tracking-[-0.01em]"
        style={{ color }}
      >
        {title}
      </span>
      {sub && (
        <span className="ml-auto text-[11px] text-text-tertiary">{sub}</span>
      )}
    </div>
  )
}

export default DetailHeader
