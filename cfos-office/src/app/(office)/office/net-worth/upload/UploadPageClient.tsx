'use client'

import { useRouter } from 'next/navigation'
import { UploadWizard } from '@/components/upload/UploadWizard'
import type { Category } from '@/lib/parsers/types'

export function UploadPageClient({ categories }: { categories: Category[] }) {
  const router = useRouter()

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Add to Balance Sheet</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload a holdings CSV, pension or loan statement, or a screenshot of any account balance — I&apos;ll extract the key numbers.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 md:p-6">
        <UploadWizard
          categories={categories}
          context="balance_sheet"
          onImported={() => {
            // Data refreshed — balance_sheet_done state in UploadWizard shows the summary
          }}
          onDone={() => {
            router.push('/office/net-worth')
          }}
        />
      </div>
    </div>
  )
}
