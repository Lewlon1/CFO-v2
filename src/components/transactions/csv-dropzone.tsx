"use client"

import { useRef, useState } from "react"
import Papa from "papaparse"
import { UploadCloudIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type Props = {
  onParsed: (result: Papa.ParseResult<Record<string, string>>) => void
  onError: (message: string) => void
}

export function CsvDropzone({ onParsed, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function parseFile(file: File) {
    if (!file.name.match(/\.(csv|tsv)$/i)) {
      onError("Please upload a .csv or .tsv file.")
      return
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      delimiter: file.name.endsWith(".tsv") ? "\t" : "",
      complete: (result) => {
        if (!result.data.length) {
          onError("The file appears to be empty.")
          return
        }
        onParsed(result)
      },
      error: (err) => {
        onError(`Parse error: ${err.message}`)
      },
    })
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) parseFile(file)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) parseFile(file)
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition-colors cursor-pointer",
        dragging ? "border-primary bg-primary/5" : "border-input hover:border-primary/50"
      )}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <UploadCloudIcon className="size-10 text-muted-foreground mb-3" />
      <p className="font-medium text-sm">Drop your CSV here, or click to browse</p>
      <p className="text-xs text-muted-foreground mt-1">Supports .csv and .tsv files</p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}
