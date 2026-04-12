'use client'

import { useRef, useState } from 'react'

type Props = {
  onFile: (file: File) => void
  isLoading?: boolean
  /** 'transactions' (default) or 'balance_sheet'. Changes the accepted file types and helper text. */
  context?: 'transactions' | 'balance_sheet'
}

const ACCEPTED_TRANSACTIONS = '.csv,.xlsx,.xls,.png,.jpg,.jpeg,.heic,.pdf'
const ACCEPTED_BALANCE_SHEET = '.csv,.xlsx,.xls,.png,.jpg,.jpeg,.heic,.webp,.pdf'

export function UploadZone({ onFile, isLoading, context = 'transactions' }: Props) {
  const ACCEPTED = context === 'balance_sheet' ? ACCEPTED_BALANCE_SHEET : ACCEPTED_TRANSACTIONS
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

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
        const file = e.dataTransfer.files[0]
        if (file) onFile(file)
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
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
      <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center text-2xl">
        {isLoading ? '⏳' : '📄'}
      </div>
      <div className="text-center">
        <p className="font-medium text-foreground">
          {isLoading
            ? 'Processing…'
            : context === 'balance_sheet'
              ? 'Drop your holdings file or statement here'
              : 'Drop your bank statement here'}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {context === 'balance_sheet'
            ? 'Holdings CSV · pension or mortgage PDF · or a screenshot'
            : 'Revolut CSV · Santander XLSX · or a screenshot — or click to browse'}
        </p>
      </div>
    </div>
  )
}
