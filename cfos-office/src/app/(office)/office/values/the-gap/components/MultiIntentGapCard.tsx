'use client'

import type { MultiIntentGapV2 } from '@/lib/analytics/gap-analyser'
import { formatCurrencyRounded } from '@/lib/utils/format-currency-rounded'
import {
  QUADRANT_COLOURS,
  QUADRANT_LABELS,
  formatTimeBucketLabel,
  type Quadrant,
} from './quadrant-tokens'

export interface MultiIntentGapCardLearning {
  state: 'initial' | 'after_labelling'
  learnedMerchants?: Array<{
    merchant: string
    reads: 'foundation' | 'investment' | 'leak' | 'burden' | 'unsure'
    count: number
  }>
  claimableGap?: Array<{
    label: string
    amount: number
    quadrant: 'foundation' | 'investment' | 'burden' | 'leak'
  }>
  verdict?: string
}

export interface MultiIntentGapCardProps {
  gap: MultiIntentGapV2
  currency: string
  learning?: MultiIntentGapCardLearning
  onWalkThrough?: () => void
  onTalkLeak?: () => void
}

// Local subcomponents — match prototype IntentRow / SliceBar / GapLine exactly.

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10px] uppercase mb-2.5"
      style={{
        fontFamily: 'var(--font-data), ui-monospace, monospace',
        color: 'var(--office-text-muted)',
        letterSpacing: '0.1em',
      }}
    >
      {children}
    </div>
  )
}

function IntentRow({ card, quadrant }: { card: string; quadrant: Quadrant }) {
  const colour = QUADRANT_COLOURS[quadrant]
  return (
    <div
      className="flex items-center justify-between rounded-control"
      style={{
        padding: '8px 10px',
        background: 'var(--office-bg-tertiary)',
        border: '1px solid var(--office-border)',
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="rounded-full"
          style={{ width: '6px', height: '6px', background: colour }}
        />
        <span className="text-[13px]" style={{ color: 'var(--office-text)' }}>
          {card}
        </span>
      </div>
      <span
        className="text-[12px] font-medium"
        style={{ color: colour, letterSpacing: '0.02em' }}
      >
        {QUADRANT_LABELS[quadrant]}
      </span>
    </div>
  )
}

function SliceBar({
  label,
  total,
  share,
  merchants,
  currency,
}: {
  label: string
  total: number
  share: number
  merchants: string[]
  currency: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span
          className="text-[13px] font-medium"
          style={{ color: 'var(--office-text)' }}
        >
          {label}
        </span>
        <div className="flex items-baseline gap-2">
          <span
            className="text-[13px] tabular-nums font-medium"
            style={{
              fontFamily: 'var(--font-data), ui-monospace, monospace',
              color: 'var(--office-text)',
            }}
          >
            {formatCurrencyRounded(Math.round(total), currency)}
          </span>
          <span
            className="text-[11px] tabular-nums"
            style={{
              fontFamily: 'var(--font-data), ui-monospace, monospace',
              color: 'var(--office-text-muted)',
            }}
          >
            {Math.round(share)}%
          </span>
        </div>
      </div>

      {/* The bar */}
      <div
        className="rounded-sm overflow-hidden mb-1.5"
        style={{
          height: '4px',
          background: 'var(--office-bg-tertiary)',
        }}
      >
        <div
          className="h-full rounded-sm transition-[width] duration-[600ms] ease-out"
          style={{
            width: `${Math.max(0, Math.min(100, share))}%`,
            // Phase 3b: gold progress fill onto the theme-reactive accent token.
            background:
              'linear-gradient(90deg, color-mix(in oklab, var(--accent-gold) 67%, transparent), var(--accent-gold))',
          }}
        />
      </div>

      {/* Merchant list */}
      <div
        className="text-[11px]"
        style={{
          fontFamily: 'var(--font-data), ui-monospace, monospace',
          color: 'var(--office-text-muted)',
          letterSpacing: '0.02em',
        }}
      >
        {merchants.length > 0 ? merchants.join(' · ') : '—'}
      </div>
    </div>
  )
}

function GapLine({
  label,
  amount,
  colour,
  currency,
}: {
  label: string
  amount: number
  colour: string
  currency: string
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div
          className="rounded-full"
          style={{ width: '6px', height: '6px', background: colour }}
        />
        <span className="text-[13px]" style={{ color: 'var(--office-text)' }}>
          {label}
        </span>
      </div>
      <span
        className="text-[14px] tabular-nums font-medium"
        style={{
          fontFamily: 'var(--font-data), ui-monospace, monospace',
          color: 'var(--office-text)',
        }}
      >
        {formatCurrencyRounded(Math.round(amount), currency)}/mo
      </span>
    </div>
  )
}

// CTA button — outlined gold, hover fill. Matches prototype's primary CTA.
function PrimaryAccentButton({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-md text-[14px] font-medium transition-all duration-200 flex items-center justify-center gap-1.5 min-h-[44px]"
      style={{
        padding: '13px 14px',
        background: 'transparent',
        color: 'var(--accent-gold)',
        border: '1px solid var(--accent-gold)',
        letterSpacing: '0.02em',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--accent-gold)'
        e.currentTarget.style.color = 'var(--office-bg)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--accent-gold)'
      }}
    >
      {children}
    </button>
  )
}

// ── After-labelling sub-block ─────────────────────────────────────────────────

function AfterLabellingState({
  learnedMerchants,
  claimableGap,
  verdict,
  currency,
  onTalkLeak,
}: {
  learnedMerchants: NonNullable<MultiIntentGapCardLearning['learnedMerchants']>
  claimableGap: NonNullable<MultiIntentGapCardLearning['claimableGap']>
  verdict?: string
  currency: string
  onTalkLeak?: () => void
}) {
  return (
    <>
      <SectionLabel>What you confirmed</SectionLabel>
      <div className="flex flex-col gap-2 mb-4">
        {learnedMerchants.map((l, idx) => {
          const colour = QUADRANT_COLOURS[l.reads]
          const isLast = idx === learnedMerchants.length - 1
          return (
            <div
              key={`${l.merchant}-${idx}`}
              className="flex items-center justify-between"
              style={{
                paddingBottom: isLast ? 0 : '6px',
                borderBottom: isLast
                  ? 'none'
                  : '1px solid var(--office-border)',
              }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="rounded-full"
                  style={{ width: '6px', height: '6px', background: colour }}
                />
                <span
                  className="text-[13px] font-medium"
                  style={{ color: 'var(--office-text)' }}
                >
                  {l.merchant}
                </span>
                <span className="text-[12px]" style={{ color: colour }}>
                  {QUADRANT_LABELS[l.reads]}
                </span>
              </div>
              <span
                className="text-[10px]"
                style={{
                  fontFamily: 'var(--font-data), ui-monospace, monospace',
                  color: 'var(--office-text-muted)',
                  letterSpacing: '0.04em',
                }}
              >
                {l.count} visits
              </span>
            </div>
          )
        })}
      </div>

      <SectionLabel>The gap, now claimable</SectionLabel>
      <div
        className="rounded-control mb-3.5"
        style={{
          padding: '14px',
          background: 'var(--office-bg-tertiary)',
          border: '1px solid var(--office-border)',
          borderLeft: '2px solid var(--accent-gold)',
        }}
      >
        <div className="flex flex-col gap-2 mb-3">
          {claimableGap.map((g, idx) => (
            <GapLine
              key={`${g.label}-${idx}`}
              label={g.label}
              amount={g.amount}
              colour={QUADRANT_COLOURS[g.quadrant]}
              currency={currency}
            />
          ))}
        </div>
        {verdict && (
          <p
            className="italic m-0 text-[15px] leading-[1.45]"
            style={{
              fontFamily: 'var(--font-instrument-serif), Georgia, serif',
              color: 'var(--office-text-secondary)',
              marginTop: '8px',
              paddingTop: '10px',
              borderTop: '1px solid var(--office-border)',
            }}
          >
            {verdict}
          </p>
        )}
      </div>

      <PrimaryAccentButton onClick={onTalkLeak}>
        Talk through what to do about the leak  →
      </PrimaryAccentButton>
    </>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function MultiIntentGapCard({
  gap,
  currency,
  learning,
  onWalkThrough,
  onTalkLeak,
}: MultiIntentGapCardProps) {
  const monthly = Math.round(gap.category_monthly_total)
  const share = Math.round(gap.pct_of_total_spending)

  // Build slice rows from gap.time_slices, sorted by share desc. Skip the
  // 'undated'/'unknown' synthetic buckets — the analyser stores those in
  // skipped_undated_count, not time_slices, but be defensive.
  const sliceEntries = Object.entries(gap.time_slices)
    .filter(([key]) => key !== 'undated' && key !== 'unknown')
    .sort(([, a], [, b]) => b.share_pct - a.share_pct)

  // Fallback: no usable time slices. Surface a single line of mono prose
  // explaining the data limitation. The CTA still works — the LLM/chat can
  // still walk the user through the un-bucketed transactions.
  const hasUsableSlices = sliceEntries.length > 0

  const isAfterLabelling =
    learning?.state === 'after_labelling' &&
    learning.learnedMerchants &&
    learning.learnedMerchants.length > 0 &&
    learning.claimableGap &&
    learning.claimableGap.length > 0

  return (
    <div
      className="rounded-lg mb-3.5"
      style={{
        padding: '18px',
        background: 'var(--office-bg-secondary)',
        border: '1px solid var(--office-border)',
      }}
    >
      {/* Header: category + monthly + share */}
      <div className="flex items-baseline justify-between mb-3.5">
        <div
          className="text-[20px] leading-tight"
          style={{
            fontFamily: 'var(--font-instrument-serif), Georgia, serif',
            color: 'var(--office-text)',
          }}
        >
          {gap.category_name}
        </div>
        <div className="text-right">
          <div
            className="text-[15px] tabular-nums"
            style={{
              fontFamily: 'var(--font-data), ui-monospace, monospace',
              color: 'var(--office-text)',
            }}
          >
            {formatCurrencyRounded(monthly, currency)}/mo
          </div>
          <div
            className="text-[11px]"
            style={{
              fontFamily: 'var(--font-data), ui-monospace, monospace',
              color: 'var(--office-text-muted)',
              letterSpacing: '0.03em',
            }}
          >
            {share}% of spend
          </div>
        </div>
      </div>

      {/* What you said — stated intent rows */}
      <SectionLabel>What you said</SectionLabel>
      <div className="flex flex-col gap-1.5 mb-4">
        {gap.stated_intents.map((intent, idx) => (
          <IntentRow
            key={`${intent.card_label}-${idx}`}
            card={intent.card_label}
            quadrant={intent.quadrant as Quadrant}
          />
        ))}
      </div>

      {isAfterLabelling ? (
        <AfterLabellingState
          learnedMerchants={learning!.learnedMerchants!}
          claimableGap={learning!.claimableGap!}
          verdict={learning!.verdict}
          currency={currency}
          onTalkLeak={onTalkLeak}
        />
      ) : (
        <>
          <SectionLabel>Where the money moved</SectionLabel>
          {hasUsableSlices ? (
            <div className="flex flex-col gap-3.5 mb-4">
              {sliceEntries.map(([bucket, data]) => (
                <SliceBar
                  key={bucket}
                  label={formatTimeBucketLabel(bucket)}
                  total={data.total}
                  share={data.share_pct}
                  merchants={data.top_merchants}
                  currency={currency}
                />
              ))}
            </div>
          ) : (
            <div
              className="rounded-control mb-4"
              style={{
                padding: '12px 14px',
                background: 'var(--office-bg-tertiary)',
                border: '1px solid var(--office-border)',
              }}
            >
              <p
                className="italic m-0 text-[13px] leading-[1.45]"
                style={{
                  fontFamily: 'var(--font-instrument-serif), Georgia, serif',
                  color: 'var(--office-text-muted)',
                }}
              >
                Time-of-day data isn&apos;t available for this category.
              </p>
            </div>
          )}

          {/* Honest framing block */}
          <div
            className="rounded-control mb-3.5"
            style={{
              padding: '12px 14px',
              background: 'var(--office-bg-tertiary)',
              border: '1px solid var(--office-border)',
              borderLeft: '2px solid var(--office-text-muted)',
            }}
          >
            <p
              className="italic m-0 text-[15px] leading-[1.45]"
              style={{
                fontFamily: 'var(--font-instrument-serif), Georgia, serif',
                color: 'var(--office-text-secondary)',
              }}
            >
              You said {gap.stated_intents.length === 2 ? 'two' : 'a few'}{' '}
              different things about {gap.category_name.toLowerCase()}. The data
              can show the category and the time, but not which of these were
              which. The pattern&apos;s yours to read.
            </p>
          </div>

          <PrimaryAccentButton onClick={onWalkThrough}>
            Walk me through these  →
          </PrimaryAccentButton>
        </>
      )}
    </div>
  )
}
