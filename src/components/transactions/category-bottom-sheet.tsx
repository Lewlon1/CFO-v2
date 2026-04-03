"use client"

import { useEffect, useRef, useState } from "react"
import ReactDOM from "react-dom"
import type { Category } from "@/lib/types/database"

const GROUPS = [
  { label: "Essentials", names: ["Housing", "Groceries", "Utilities", "Transport"] },
  { label: "Lifestyle", names: ["Dining out", "Shopping", "Entertainment", "Subscriptions", "Travel"] },
  { label: "Financial", names: ["Healthcare", "Insurance"] },
] as const

type GroupName = (typeof GROUPS)[number]["names"][number]

function buildSections(categories: Category[]) {
  const assigned = new Set<string>()
  const sections: { label: string; items: Category[] }[] = []

  for (const group of GROUPS) {
    const items = categories.filter((c) =>
      (group.names as readonly string[]).some(
        (n) => n.toLowerCase() === c.name.toLowerCase()
      )
    )
    if (items.length > 0) {
      items.forEach((c) => assigned.add(c.id))
      sections.push({ label: group.label, items })
    }
  }

  const other = categories.filter((c) => !assigned.has(c.id))
  if (other.length > 0) {
    sections.push({ label: "Other", items: other })
  }

  return sections
}

type Props = {
  open: boolean
  onClose: () => void
  categories: Category[]
  onSelect: (categoryId: string) => void
  includeNoCategory?: boolean
}

export function CategoryBottomSheet({
  open,
  onClose,
  categories,
  onSelect,
  includeNoCategory = false,
}: Props) {
  // visible controls DOM presence; animate controls translate class
  const [visible, setVisible] = useState(false)
  const [animate, setAnimate] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) {
      if (closeTimer.current) clearTimeout(closeTimer.current)
      setVisible(true)
      // next tick so the translate-y-full baseline renders first
      requestAnimationFrame(() => setAnimate(true))
    } else {
      setAnimate(false)
      closeTimer.current = setTimeout(() => setVisible(false), 300)
    }
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [open])

  if (!visible) return null

  const sections = buildSections(categories)

  function handleSelect(id: string) {
    onSelect(id)
    onClose()
  }

  const sheet = (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sheet panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Select category"
        className={[
          "absolute bottom-0 left-0 right-0",
          "rounded-t-2xl border-t border-border bg-background shadow-xl",
          "flex flex-col",
          "transition-transform duration-300 ease-out",
          animate ? "translate-y-0" : "translate-y-full",
        ].join(" ")}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Title */}
        <p className="px-4 pb-2 pt-1 text-sm font-medium text-foreground shrink-0">
          Select category
        </p>

        {/* Scrollable list */}
        <div className="overflow-y-auto" style={{ maxHeight: "70vh" }}>
          {includeNoCategory && (
            <button
              type="button"
              className="flex w-full min-h-[44px] items-center px-4 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent transition-colors"
              onClick={() => handleSelect("")}
            >
              No category
            </button>
          )}

          {sections.map((section) => (
            <div key={section.label}>
              <p className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {section.label}
              </p>
              {section.items.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className="flex w-full min-h-[44px] items-center px-4 text-sm text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent transition-colors"
                  onClick={() => handleSelect(cat.id)}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          ))}

          {/* Safe area spacer for iOS */}
          <div className="h-6 shrink-0" />
        </div>
      </div>
    </div>
  )

  return ReactDOM.createPortal(sheet, document.body)
}
