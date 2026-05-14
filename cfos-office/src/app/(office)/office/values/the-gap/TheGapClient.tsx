'use client'

import { GapCard, ProvenanceLine } from '@/components/data'

interface GapItem {
  trait_key: string
  trait_value: string
  confidence: number
}

interface TheGapClientProps {
  gaps: GapItem[]
  transactionCount: number
  hasValueMap: boolean
}

function emptyStateMessage(transactionCount: number, hasValueMap: boolean): string {
  if (!hasValueMap && transactionCount === 0) {
    return 'Complete the Value Map and upload a statement to see your Gap analysis.'
  }
  if (!hasValueMap) {
    return 'Complete the Value Map to see your Gap analysis — sort a few sample transactions so I know what each line of your spending means to you.'
  }
  if (transactionCount === 0) {
    return 'Upload a recent bank statement to see your Gap. Once I have your real spending, I can compare it against the Value Map you just completed.'
  }
  return "Nothing's diverging yet — your money is moving the way you said it should. I'll surface a Gap here as soon as something drifts."
}

function parseGapValue(value: string): { belief: string; reality: string; status: 'aligned' | 'gap' | 'eliminated' | 'partial' } {
  // Gap analysis trait_value is typically JSON or a structured string
  try {
    const parsed = JSON.parse(value)
    return {
      belief: parsed.belief ?? parsed.self_perception ?? value,
      reality: parsed.reality ?? parsed.actual ?? '',
      status: parsed.status ?? 'partial',
    }
  } catch {
    // Fallback: use raw text
    return {
      belief: value,
      reality: '',
      status: 'partial',
    }
  }
}

export function TheGapClient({ gaps, transactionCount, hasValueMap }: TheGapClientProps) {
  if (gaps.length === 0) {
    return (
      <div className="px-3.5 pt-4 pb-24">
        <div className="text-[13px] text-text-secondary mb-1.5 leading-[1.6]">
          What you believe about your money vs what the data shows.
        </div>
        <p className="text-[13px] text-text-secondary mt-6 leading-[1.55] max-w-md mx-auto text-center">
          {emptyStateMessage(transactionCount, hasValueMap)}
        </p>
      </div>
    )
  }

  return (
    <div className="px-3.5 pt-1.5 pb-24">
      <div className="text-[13px] text-text-secondary mb-1.5 leading-[1.6]">
        What you believe about your money vs what the data shows.
      </div>
      <ProvenanceLine text={`Based on Value Map + ${transactionCount} transactions`} />

      <div className="mt-4">
        {gaps.map((gap, i) => {
          const { belief, reality, status } = parseGapValue(gap.trait_value)
          return (
            <GapCard
              key={gap.trait_key + i}
              belief={belief}
              reality={reality}
              status={status}
            />
          )
        })}
      </div>
    </div>
  )
}
