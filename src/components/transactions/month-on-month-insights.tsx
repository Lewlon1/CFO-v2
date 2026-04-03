"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { TrendingUpIcon, TrendingDownIcon } from "lucide-react"

type CategoryTotals = Record<string, number>

type Props = {
  profileId: string
}

export function MonthOnMonthInsights({ profileId }: Props) {
  const supabase = createClient()
  const [rows, setRows] = useState<{ category: string; current: number; previous: number }[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const now = new Date()
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      const thisMonthEnd = now.toISOString().slice(0, 10)
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10)
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10)

      const [currentRes, previousRes] = await Promise.all([
        supabase
          .from("transactions")
          .select("category_name, amount")
          .eq("profile_id", profileId)
          .eq("type", "expense")
          .gte("transaction_date", thisMonthStart)
          .lte("transaction_date", thisMonthEnd),
        supabase
          .from("transactions")
          .select("category_name, amount")
          .eq("profile_id", profileId)
          .eq("type", "expense")
          .gte("transaction_date", lastMonthStart)
          .lte("transaction_date", lastMonthEnd),
      ])

      const sumByCategory = (
        data: { category_name: string | null; amount: number }[]
      ): CategoryTotals => {
        const totals: CategoryTotals = {}
        for (const row of data) {
          const cat = row.category_name ?? "Uncategorised"
          totals[cat] = (totals[cat] ?? 0) + row.amount
        }
        return totals
      }

      const current = sumByCategory(
        (currentRes.data ?? []) as { category_name: string | null; amount: number }[]
      )
      const previous = sumByCategory(
        (previousRes.data ?? []) as { category_name: string | null; amount: number }[]
      )

      // Need data in both months to show comparison
      const hasPreviousData = Object.keys(previous).length > 0
      if (!hasPreviousData) {
        setLoaded(true)
        return
      }

      // Top 5 categories by current month spend
      const sorted = Object.entries(current)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([category, cur]) => ({
          category,
          current: cur,
          previous: previous[category] ?? 0,
        }))

      setRows(sorted)
      setLoaded(true)
    }

    load()
  }, [profileId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded || rows.length === 0) return null

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">
        Month on month
      </p>
      <div className="space-y-2">
        {rows.map(({ category, current, previous }) => {
          const delta = previous > 0 ? ((current - previous) / previous) * 100 : null
          const isUp = delta !== null && delta > 0
          const isDown = delta !== null && delta < 0

          return (
            <div key={category} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground truncate max-w-[160px]">{category}</span>
              <div className="flex items-center gap-2">
                <span className="font-medium tabular-nums">
                  {current.toLocaleString("en", { minimumFractionDigits: 2 })}
                </span>
                {delta !== null && (
                  <span
                    className={
                      isUp
                        ? "flex items-center gap-0.5 text-xs text-red-500"
                        : isDown
                        ? "flex items-center gap-0.5 text-xs text-green-600"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {isUp ? (
                      <TrendingUpIcon className="size-3" />
                    ) : isDown ? (
                      <TrendingDownIcon className="size-3" />
                    ) : null}
                    {Math.abs(delta).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
