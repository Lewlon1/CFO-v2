"use client"

import { useRef, useState } from "react"
import { ImageIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type Props = {
  onFile: (file: File) => void
  onError: (message: string) => void
  disabled?: boolean
}

export function ImageDropzone({ onFile, onError, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      onError("Please upload an image file (PNG, JPG, or screenshot).")
      return
    }
    onFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // Reset input so the same file can be re-selected after an error
    e.target.value = ""
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition-colors",
        disabled
          ? "border-input opacity-50 cursor-not-allowed"
          : "cursor-pointer hover:border-primary/50",
        dragging && !disabled ? "border-primary bg-primary/5" : "border-input"
      )}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={disabled ? undefined : handleDrop}
      onClick={() => { if (!disabled) inputRef.current?.click() }}
    >
      <ImageIcon className="size-10 text-muted-foreground mb-3" />
      <p className="font-medium text-sm">Drop a screenshot here, or tap to browse</p>
      <p className="text-xs text-muted-foreground mt-1">
        Screenshot of your banking app or statement
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled}
      />
    </div>
  )
}
