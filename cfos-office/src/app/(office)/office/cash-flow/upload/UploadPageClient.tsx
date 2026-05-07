'use client'

import { useRouter } from 'next/navigation'
import { UploadWizard } from '@/components/upload/UploadWizard'
import type { Category } from '@/lib/parsers/types'

export function UploadPageClient({ categories }: { categories: Category[] }) {
  const router = useRouter()

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Upload Statement</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Import a bank statement to update your cash flow
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 md:p-6">
        <UploadWizard
          categories={categories}
          context="transactions"
          onImported={() => {
            // Data refreshed — ImportResult component shows summary automatically
          }}
          onDone={() => {
            router.push('/office/cash-flow/transactions')
          }}
        />
      </div>
    </div>
  )
}
