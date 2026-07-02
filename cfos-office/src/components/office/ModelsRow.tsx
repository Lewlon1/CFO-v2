'use client'

import { useRouter } from 'next/navigation'
import { ChevronRight, TrendingUp } from 'lucide-react'

export function ModelsRow() {
  const router = useRouter()

  return (
    <button
      onClick={() => router.push('/office/models')}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-control border border-border-subtle hover:bg-tap-highlight transition-colors min-h-[48px] mt-2"
    >
      <TrendingUp size={18} className="shrink-0 text-text-tertiary" />
      <div className="flex-1 min-w-0 text-left">
        <span className="text-[13px] font-semibold text-text-primary">Models</span>
        <p className="font-data text-[10px] text-text-tertiary">Weigh a property decision — keep, sell, or redeploy</p>
      </div>
      <ChevronRight size={14} className="shrink-0 opacity-[0.15]" />
    </button>
  )
}
