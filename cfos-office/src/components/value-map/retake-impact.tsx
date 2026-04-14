'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CfoAvatar } from '@/components/chat/cfo-avatar'

interface RetakeImpactProps {
  retakeId: string | null
  onContinue: () => void
}

type ImpactData = {
  confirmed_count: number
  propagated_count: number
  rules_learned: number
  high_confidence_pct: number
  transaction_count: number
}

export function RetakeImpact({ retakeId, onContinue }: RetakeImpactProps) {
  const [impact, setImpact] = useState<ImpactData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!retakeId) {
      setLoading(false)
      return
    }
    const load = async () => {
      try {
        // Small delay lets the async learning pipeline finish before we query
        await new Promise((r) => setTimeout(r, 1500))
        const res = await fetch(
          `/api/value-map/personal/impact?retake_id=${encodeURIComponent(retakeId)}`,
          { cache: 'no-store' },
        )
        if (!res.ok) {
          setLoading(false)
          return
        }
        const body = await res.json()
        setImpact({
          confirmed_count: body.confirmed_count ?? 0,
          propagated_count: body.propagated_count ?? 0,
          rules_learned: body.rules_learned ?? 0,
          high_confidence_pct: body.high_confidence_pct ?? 0,
          transaction_count: body.transaction_count ?? 0,
        })
      } catch (err) {
        console.error('[retake-impact] load error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [retakeId])

  // No retake id — render success without numbers
  if (!retakeId) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 gap-6 text-center">
        <CfoAvatar size="lg" />
        <div className="space-y-2 max-w-sm">
          <h1 className="text-xl font-semibold text-foreground">Thanks for the help</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            I&apos;ve logged your answers and I&apos;m working through them.
          </p>
        </div>
        <Button
          onClick={onContinue}
          className="bg-[#E8A84C] hover:bg-[#d4963f] text-black font-semibold px-8 py-5 text-base min-h-[44px]"
        >
          Back to chat
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 gap-4 text-center">
        <CfoAvatar size="lg" />
        <p className="text-sm text-muted-foreground">Measuring the impact of your answers…</p>
      </div>
    )
  }

  const confirmed = impact?.confirmed_count ?? 0
  const propagated = impact?.propagated_count ?? 0
  const rules = impact?.rules_learned ?? 0
  const pct = impact?.high_confidence_pct ?? 0
  const totalImproved = confirmed + propagated

  return (
    <div className="flex flex-col items-center justify-start h-full px-6 pt-12 pb-8 gap-6 text-center overflow-y-auto">
      <CfoAvatar size="lg" />
      <div className="space-y-2 max-w-sm">
        <h1 className="text-xl font-semibold text-foreground">That just paid off</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Your answers rippled through your whole spending picture.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-3">
        <ImpactRow
          icon={<Sparkles className="h-4 w-4" />}
          label="You classified"
          value={`${confirmed} transaction${confirmed === 1 ? '' : 's'}`}
        />
        {propagated > 0 && (
          <ImpactRow
            icon={<span className="text-sm">→</span>}
            label="I backfilled"
            value={`${propagated} more from the same merchants`}
          />
        )}
        {rules > 0 && (
          <ImpactRow
            icon={<span className="text-sm">✦</span>}
            label="Rules learned"
            value={`${rules} new pattern${rules === 1 ? '' : 's'} about how you value spending`}
          />
        )}
        <div className="pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground">
            Your Values View is now{' '}
            <span className="font-semibold text-foreground">{pct}%</span> confidently categorised.
          </p>
        </div>
      </div>

      <Button
        onClick={onContinue}
        className="bg-[#E8A84C] hover:bg-[#d4963f] text-black font-semibold px-8 py-5 text-base min-h-[44px] mt-2"
      >
        {totalImproved > 0 ? `See the ${totalImproved} I improved` : 'Back to chat'}
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  )
}

function ImpactRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 text-left">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-background text-muted-foreground">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  )
}
