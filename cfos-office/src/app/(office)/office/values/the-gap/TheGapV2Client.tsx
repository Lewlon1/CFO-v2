'use client'

import { useRouter } from 'next/navigation'
import type {
  GapV2,
  ValueMapMetadata,
  SingleIntentGapV2,
  MultiIntentGapV2,
  CoverageGapV2,
} from '@/lib/analytics/gap-analyser'
import { SingleIntentGapCard } from './components/SingleIntentGapCard'
import { MultiIntentGapCard } from './components/MultiIntentGapCard'
import { CoverageGapCard } from './components/CoverageGapCard'
import {
  ValueMapSummary,
  type VmRowsByQuadrant,
} from './components/ValueMapSummary'

interface TheGapV2ClientProps {
  gaps: GapV2[]
  metadata: ValueMapMetadata
  vmRowsByQuadrant: VmRowsByQuadrant
  currency: string
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

export function TheGapV2Client({
  gaps,
  metadata,
  vmRowsByQuadrant,
  currency,
  transactionCount,
  hasValueMap,
}: TheGapV2ClientProps) {
  const router = useRouter()

  // Retake the Value Map. Mirrors the same target the rest of the app uses
  // (see /value-map/page.tsx — mode='personal').
  const handleRetake = () => {
    router.push('/value-map?mode=personal')
  }

  // Generic chat-with-category handler. The in-chat capture flow (labelling
  // walkthrough / propose_experiment / coverage capture) is out of scope this
  // session — for now, deep-link into chat with an intent + category hint so
  // the system prompt can recognise the entry. If the server-side chat
  // handler doesn't honour these params yet, the chat still opens cleanly.
  const openChatWithIntent = (intent: string, categoryId: string) => {
    const params = new URLSearchParams({ intent, category: categoryId })
    router.push(`/chat?${params.toString()}`)
  }

  // Empty state — no gaps surfaced. Keep parity with the v1 client's copy.
  if (gaps.length === 0 && !hasValueMap) {
    return (
      <div className="px-3.5 pt-4 pb-24">
        <div
          className="text-[13px] mb-1.5 leading-[1.6]"
          style={{ color: 'var(--office-text-secondary)' }}
        >
          What you believe about your money vs what the data shows.
        </div>
        <p
          className="text-[13px] mt-6 leading-[1.55] max-w-md mx-auto text-center"
          style={{ color: 'var(--office-text-secondary)' }}
        >
          {emptyStateMessage(transactionCount, hasValueMap)}
        </p>
      </div>
    )
  }

  return (
    <div className="px-3.5 pt-1.5 pb-24">
      {/* Breadcrumb */}
      <div
        className="text-[10px] uppercase mb-2"
        style={{
          fontFamily: 'var(--font-data), ui-monospace, monospace',
          color: 'var(--office-text-muted)',
          letterSpacing: '0.1em',
        }}
      >
        Values &amp; You / The Gap
      </div>

      {/* Page title */}
      <h1
        className="text-[34px] m-0 leading-tight"
        style={{
          fontFamily: 'var(--font-instrument-serif), Georgia, serif',
          fontWeight: 400,
          color: 'var(--office-text)',
          letterSpacing: '-0.02em',
          marginBottom: '6px',
        }}
      >
        The Gap
      </h1>
      <p
        className="italic text-[16px] m-0"
        style={{
          fontFamily: 'var(--font-instrument-serif), Georgia, serif',
          color: 'var(--office-text-muted)',
          marginBottom: '18px',
        }}
      >
        What you said, vs where the money goes.
      </p>

      {/* Value Map summary header */}
      <ValueMapSummary
        metadata={metadata}
        vmRowsByQuadrant={vmRowsByQuadrant}
        onRetake={handleRetake}
      />

      {/* By category */}
      <h2
        className="text-[11px] uppercase font-medium"
        style={{
          fontFamily: 'var(--font-data), ui-monospace, monospace',
          color: 'var(--office-text-muted)',
          letterSpacing: '0.12em',
          marginTop: '32px',
          marginBottom: '14px',
        }}
      >
        By category
      </h2>

      {gaps.length === 0 ? (
        <p
          className="text-[13px] leading-[1.55] max-w-md mx-auto text-center"
          style={{ color: 'var(--office-text-secondary)' }}
        >
          {emptyStateMessage(transactionCount, hasValueMap)}
        </p>
      ) : (
        gaps.map((gap, i) => {
          switch (gap.shape) {
            case 'single_intent': {
              const g = gap as SingleIntentGapV2
              return (
                <SingleIntentGapCard
                  key={`single-${g.category_id}-${i}`}
                  gap={g}
                  currency={currency}
                />
              )
            }
            case 'multi_intent': {
              const g = gap as MultiIntentGapV2
              return (
                <MultiIntentGapCard
                  key={`multi-${g.category_id}-${i}`}
                  gap={g}
                  currency={currency}
                  learning={g.learning}
                  onWalkThrough={() =>
                    openChatWithIntent('label_walkthrough', g.category_id)
                  }
                  onTalkLeak={() =>
                    openChatWithIntent('discuss_leak', g.category_id)
                  }
                />
              )
            }
            case 'coverage_gap': {
              const g = gap as CoverageGapV2
              return (
                <CoverageGapCard
                  key={`coverage-${g.category_id}-${i}`}
                  gap={g}
                  currency={currency}
                  onTellC={() =>
                    openChatWithIntent('coverage_capture', g.category_id)
                  }
                />
              )
            }
            default:
              return null
          }
        })
      )}
    </div>
  )
}
