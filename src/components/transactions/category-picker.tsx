"use client"

import { useEffect, useState } from "react"
import { ChevronDownIcon } from "lucide-react"
import {
  Select,
  SelectTrigger,
  SelectPopup,
  SelectItem,
} from "@/components/ui/select"
import { CategoryBottomSheet } from "./category-bottom-sheet"
import { cn } from "@/lib/utils"
import type { Category } from "@/lib/types/database"

type Props = {
  categories: Category[]
  value: string | null
  onValueChange: (catId: string) => void
  placeholder?: string
  rowType?: Category["type"]
  includeNoCategory?: boolean
  className?: string
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < 640)
    }
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])

  return isMobile
}

export function CategoryPicker({
  categories,
  value,
  onValueChange,
  placeholder = "Select…",
  rowType,
  includeNoCategory = false,
  className,
}: Props) {
  const isMobile = useIsMobile()
  const [sheetOpen, setSheetOpen] = useState(false)

  const displayName = value ? categories.find((c) => c.id === value)?.name : null

  if (!isMobile) {
    // Desktop: existing Select dropdown
    return (
      <Select
        value={value ?? ""}
        onValueChange={(v: unknown) => onValueChange(v as string)}
      >
        <SelectTrigger className={cn("text-xs", className)}>
          {displayName ? (
            <span>{displayName}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </SelectTrigger>
        <SelectPopup>
          {includeNoCategory && (
            <SelectItem value="">No category</SelectItem>
          )}
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    )
  }

  // Mobile: button trigger + bottom sheet
  return (
    <>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className={cn(
          // mirrors SelectTrigger styling
          "inline-flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          className
        )}
      >
        {displayName ? (
          <span className="truncate text-xs">{displayName}</span>
        ) : (
          <span className="truncate text-xs text-muted-foreground">{placeholder}</span>
        )}
        <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
      </button>

      <CategoryBottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        categories={categories}
        onSelect={onValueChange}
        includeNoCategory={includeNoCategory}
      />
    </>
  )
}
