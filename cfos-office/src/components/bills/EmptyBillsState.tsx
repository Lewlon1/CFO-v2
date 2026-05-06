'use client'

import { UploadZone } from '@/components/upload/UploadZone'

interface Props {
  onFiles: (files: File[]) => void
}

export function EmptyBillsState({ onFiles }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">No bills tracked yet</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Upload one or more bills to extract plan details, track costs, and get savings recommendations.
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <UploadZone onFiles={onFiles} context="bills" />
      </div>
    </div>
  )
}
