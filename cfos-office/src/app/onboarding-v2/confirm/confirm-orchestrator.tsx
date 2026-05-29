'use client'

import { useRouter } from 'next/navigation'
import { ConfirmFixedCosts } from '@/components/onboarding-v2/confirm-fixed-costs'
import type { ReconciledBill } from '@/lib/analytics/reconcile-fixed-costs'

type Props = {
  items: ReconciledBill[]
  total: number
  currency: string
}

/**
 * Thin client wrapper around the confirm component so the server entry
 * stays purely server-side (the reconcile helper is server-only). Pushes
 * the redirect on submit.
 */
export function ConfirmOrchestrator({ items, total, currency }: Props) {
  const router = useRouter()
  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <div className="flex-1 flex flex-col max-w-[430px] mx-auto w-full px-4 py-6">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <ConfirmFixedCosts
            initialItems={items}
            initialTotal={total}
            currency={currency}
            onAdvance={(redirectTo) => router.push(redirectTo)}
          />
        </div>
      </div>
    </div>
  )
}
