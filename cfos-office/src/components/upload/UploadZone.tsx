'use client'

import { useRef, useState } from 'react'

type Props = {
  onFiles: (files: File[]) => void
  isLoading?: boolean
  /** 'transactions' (default), 'balance_sheet', or 'bills'. Changes the accepted file types and helper text. */
  context?: 'transactions' | 'balance_sheet' | 'bills'
}

const ACCEPTED_TRANSACTIONS = '.csv,.xlsx,.xls,.png,.jpg,.jpeg,.heic,.pdf'
const ACCEPTED_BALANCE_SHEET = '.csv,.xlsx,.xls,.png,.jpg,.jpeg,.heic,.webp,.pdf'
const ACCEPTED_BILLS = '.pdf,.png,.jpg,.jpeg,.heic,.webp'

export function UploadZone({ onFiles, isLoading, context = 'transactions' }: Props) {
  const ACCEPTED =
    context === 'balance_sheet'
      ? ACCEPTED_BALANCE_SHEET
      : context === 'bills'
        ? ACCEPTED_BILLS
        : ACCEPTED_TRANSACTIONS
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const headline =
    context === 'balance_sheet'
      ? 'Drop your holdings files or statements here'
      : context === 'bills'
        ? 'Drop one or more bills here'
        : 'Drop your bank statements here'

  const helper =
    context === 'balance_sheet'
      ? 'Holdings CSV · pension or mortgage PDF · screenshots — drop multiple'
      : context === 'bills'
        ? 'PDF, PNG, JPG — drop multiple or click to browse'
        : 'Revolut CSV · Santander XLSX · screenshots — drop multiple or click to browse'

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragging(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length > 0) onFiles(files)
      }}
      onClick={() => inputRef.current?.click()}
      className={`relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-12 cursor-pointer transition-colors
        ${isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/50'}
        ${isLoading ? 'pointer-events-none opacity-60' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) onFiles(files)
          e.target.value = ''
        }}
      />
      <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center text-2xl">
        {isLoading ? '⏳' : '📄'}
      </div>
      <div className="text-center">
        <p className="font-medium text-foreground">
          {isLoading ? 'Processing…' : headline}
        </p>
        <p className="text-sm text-muted-foreground mt-1">{helper}</p>
      </div>
    </div>
  )
}
