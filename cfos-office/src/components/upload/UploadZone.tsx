'use client'

import { useRef, useState } from 'react'

type Props = {
  onFile: (file: File) => void
  isLoading?: boolean
}

const ACCEPTED = '.csv,.xlsx,.xls,.png,.jpg,.jpeg,.heic'

export function UploadZone({ onFile, isLoading }: Props) {
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
          {isLoading ? 'Processing…' : 'Drop your bank statement here'}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Revolut CSV · Santander XLSX · or a screenshot — or click to browse
        </p>
      </div>
    </div>
  )
}
