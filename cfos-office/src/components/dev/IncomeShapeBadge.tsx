'use client'

interface ShapeData {
  income_shape: string | null
  income_volatility: number | null
  income_shape_deposit_count: number | null
  financial_posture: string | null
  runway_days: number | null
}

const ENABLED = process.env.NEXT_PUBLIC_DEV_BADGES === 'true'

/**
 * Dev-only badge surfacing the detected income shape and posture on the
 * Cash Flow folder. Hidden in production unless NEXT_PUBLIC_DEV_BADGES=true
 * is explicitly set. Not for user-facing surfaces — it exposes raw
 * classifier internals.
 */
export function IncomeShapeBadge({ data }: { data: ShapeData | null }) {
  if (!ENABLED) return null
  if (!data || !data.income_shape) return null

  const cv = data.income_volatility
  const cvLabel = cv === null ? '—' : Number(cv).toFixed(2)
  const count = data.income_shape_deposit_count ?? 0

  return (
    <div
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono"
      style={{
        background: 'rgba(232,168,76,0.06)',
        color: 'rgba(232,168,76,0.8)',
        border: '0.5px dashed rgba(232,168,76,0.3)',
      }}
    >
      <span>shape · {data.income_shape}</span>
      <span>·</span>
      <span>CV {cvLabel}</span>
      <span>·</span>
      <span>n={count}</span>
      {data.financial_posture && (
        <>
          <span>·</span>
          <span>posture · {data.financial_posture}</span>
          {data.runway_days !== null && (
            <>
              <span>·</span>
              <span>runway {data.runway_days}d</span>
            </>
          )}
        </>
      )}
    </div>
  )
}
