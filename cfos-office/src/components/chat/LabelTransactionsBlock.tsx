'use client'

// Inline labelling block rendered when the LLM calls the `label_transactions`
// tool. The tool emits a render_directive with the question, transactions,
// and 5 quadrant options. The user taps a pill per transaction; on submit,
// each label POSTs to /api/corrections/signal (which is already wired through
// the learning engine via after()).
//
// Visual contract: docs/design/prototypes/label-transactions-prototype.jsx.
// Colours for the 5 quadrants come from the tool output itself (the LLM does
// not pick them); the source of truth lives in
// cfos-office/src/lib/ai/tools/label-transactions.ts and is now the canonical
// value-category tokens. Surfaces / borders / text below resolve to the
// canonical design tokens (theme-reactive var() strings) — Visual Phase 3b
// restyle: the block dropped its bespoke walnut prototype palette so it reads
// in both themes off the shared token layer.

import { useState } from 'react'
import { formatAmount, formatDate } from '@/lib/value-map/format'

// ── Types ─────────────────────────────────────────────────────────────────────

export type LabelTransactionsQuadrantId =
  | 'foundation'
  | 'investment'
  | 'leak'
  | 'burden'
  | 'unsure'

export interface LabelTransactionsTransaction {
  id: string
  date: string // ISO date (YYYY-MM-DD)
  merchant: string // raw description
  amount: number // signed (negative for spend, but the tool often passes positive magnitudes — see formatRowAmount)
  category?: string | null // category_id
  time?: string // 'HH:MM' if available
}

export interface LabelTransactionsOption {
  id: LabelTransactionsQuadrantId
  label: string // user-facing copy (e.g. "Foundation")
  color: string // canonical value-category token var() string (e.g. var(--value-foundation))
  desc: string // sub-label e.g. 'Essential'
}

export interface LabelTransactionsBlockProps {
  directiveId: string
  // Renders inside the chat bubble that holds this block. The block does NOT
  // render the question itself — the bubble's markdown body already does.
  question: string
  contextHint?: string // shown in block header eyebrow
  transactions: LabelTransactionsTransaction[]
  options: LabelTransactionsOption[] // exactly 5 (validated by the tool)
  // Optional callback fired after every label POST resolves (or fails). The
  // component handles the API POSTs itself by default.
  onSubmit?: (labels: Record<string, LabelTransactionsQuadrantId>) => Promise<void> | void
  // Hydrate from prior state if the user has already submitted (idempotency).
  completed?: boolean
  existingLabels?: Record<string, LabelTransactionsQuadrantId>
  // Currency for amount display. Defaults to EUR (matches prototype).
  userCurrency?: string
}

// ── Surface tokens ──────────────────────────────────────────────────────────
// Visual Phase 3b: the block's bespoke walnut prototype palette was retired in
// favour of the canonical design tokens (var() strings, theme-reactive in both
// light and dark). The block is inline-style-architected, so tokens are read as
// var() strings rather than utility classes; the drift battery sees zero raw
// hex/rgba here. `bgOnAccent` is the foreground used on the gold CTA fill.

const TOKENS = {
  surface: 'var(--bg-elevated)',
  border: 'var(--border-medium)',
  textPrimary: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  textMuted: 'var(--text-tertiary)',
  accent: 'var(--accent-gold)',
  bgOnAccent: 'var(--primary-foreground)',
} as const

// ── Helpers (exported for tests) ──────────────────────────────────────────────

/**
 * The endpoint /api/corrections/signal accepts the full 5-value union
 * including 'unsure' (route line 8). No special-case event logging.
 */
export interface SignalPayload {
  transaction_id: string
  value_category: LabelTransactionsQuadrantId
}

export function buildSignalPayload(
  transactionId: string,
  quadrant: LabelTransactionsQuadrantId,
): SignalPayload {
  return { transaction_id: transactionId, value_category: quadrant }
}

/**
 * True when every transaction has a label. Used to gate the submit CTA.
 */
export function isAllLabelled(
  transactions: LabelTransactionsTransaction[],
  labels: Record<string, string>,
): boolean {
  if (transactions.length === 0) return false
  return transactions.every((t) => labels[t.id] != null)
}

// Canonical order used both visually (pill grid below) and in the
// post-submit recap trigger. Keeping this declared once so the two stay in
// sync if quadrants ever change.
const QUADRANT_ORDER: LabelTransactionsQuadrantId[] = [
  'foundation',
  'investment',
  'leak',
  'burden',
  'unsure',
]

const QUADRANT_LABEL: Record<LabelTransactionsQuadrantId, string> = {
  foundation: 'Foundation',
  investment: 'Investment',
  leak: 'Leak',
  burden: 'Burden',
  unsure: 'Unsure',
}

/**
 * Build the hidden `[System: ...]` trigger sent to /api/chat after the user
 * submits their labels. MessageList filters messages starting with `[System:`
 * from the visible chat, so this is invisible to the user but gives the LLM
 * the data it needs to acknowledge what was labelled and ask the next
 * follow-up question.
 *
 * Format mirrors the other automated triggers in ChatProvider.tsx:213-249.
 */
export function buildLabelRecapTrigger(
  transactions: LabelTransactionsTransaction[],
  labels: Record<string, LabelTransactionsQuadrantId>,
): string {
  const byQuadrant = new Map<LabelTransactionsQuadrantId, string[]>()
  for (const tx of transactions) {
    const q = labels[tx.id]
    if (!q) continue
    const list = byQuadrant.get(q) ?? []
    list.push(tx.merchant || 'Unknown')
    byQuadrant.set(q, list)
  }
  const groupedLines: string[] = []
  for (const q of QUADRANT_ORDER) {
    const merchants = byQuadrant.get(q)
    if (!merchants || merchants.length === 0) continue
    groupedLines.push(`${QUADRANT_LABEL[q]}: ${merchants.join(', ')}.`)
  }
  const summary = groupedLines.length > 0 ? ` ${groupedLines.join(' ')}` : ''
  return `[System: User just labelled the transactions you asked about.${summary} Acknowledge what landed in 1-2 sentences, reference one specific thing they revealed, then ask the next logical follow-up. Don't list all the labels back.]`
}

/**
 * Format a transaction row date as "Fri 8 Mar". Matches the prototype's
 * left-aligned date format. The tool emits date as YYYY-MM-DD.
 */
export function formatRowDate(dateIso: string): string {
  if (!dateIso) return ''
  try {
    const d = new Date(dateIso.length <= 10 ? dateIso + 'T00:00:00' : dateIso)
    if (!Number.isFinite(d.getTime())) return formatDate(dateIso)
    // "Fri 8 Mar"
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  } catch {
    return formatDate(dateIso)
  }
}

/**
 * The tool emits amounts as the absolute magnitude. Display the row's signed
 * amount with a minus sign (transactions in this block are always spends —
 * the LLM uses label_transactions to walk through expense patterns).
 */
export function formatRowAmount(amount: number, currency: string): string {
  const magnitude = Math.abs(amount)
  return `−${formatAmount(magnitude, currency)}`
}

// ── Component ─────────────────────────────────────────────────────────────────

const SUBMITTING_MIN_MS = 800

type Phase = 'labelling' | 'submitting' | 'completed'

export function LabelTransactionsBlock({
  directiveId,
  contextHint,
  transactions,
  options,
  onSubmit,
  completed = false,
  existingLabels,
  userCurrency = 'EUR',
}: LabelTransactionsBlockProps) {
  const [labels, setLabels] = useState<Record<string, LabelTransactionsQuadrantId>>(
    () => existingLabels ?? {},
  )
  const [phase, setPhase] = useState<Phase>(completed ? 'completed' : 'labelling')

  const labelCount = Object.keys(labels).length
  const total = transactions.length
  const allLabelled = isAllLabelled(transactions, labels)

  const isInteractive = phase === 'labelling'

  const handleLabel = (txId: string, quadrantId: LabelTransactionsQuadrantId) => {
    if (!isInteractive) return
    setLabels((prev) => ({ ...prev, [txId]: quadrantId }))
  }

  const handleSubmit = async () => {
    if (!allLabelled || phase !== 'labelling') return
    setPhase('submitting')

    const startedAt = Date.now()
    const snapshot = { ...labels }

    // Fire all labels in parallel. Errors are logged but do NOT block the UI
    // transition — the user labelled, the signal was attempted, the visual
    // state should reflect that.
    const submission = Promise.all(
      transactions.map(async (tx) => {
        const quadrant = snapshot[tx.id]
        if (!quadrant) return
        try {
          const res = await fetch('/api/corrections/signal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildSignalPayload(tx.id, quadrant)),
          })
          if (!res.ok) {
            console.error(
              '[LabelTransactionsBlock] correction signal POST failed',
              { directiveId, txId: tx.id, quadrant, status: res.status },
            )
          }
        } catch (err) {
          console.error(
            '[LabelTransactionsBlock] correction signal threw',
            { directiveId, txId: tx.id, quadrant, err },
          )
        }
      }),
    )

    try {
      await submission
      if (onSubmit) {
        try {
          await onSubmit(snapshot)
        } catch (err) {
          console.error('[LabelTransactionsBlock] onSubmit callback threw', err)
        }
      }
    } finally {
      // Hold the "C. is reading..." beat for at least SUBMITTING_MIN_MS so it
      // doesn't feel instant.
      const elapsed = Date.now() - startedAt
      const remaining = Math.max(0, SUBMITTING_MIN_MS - elapsed)
      if (remaining > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining))
      }
      setPhase('completed')
    }
  }

  return (
    <div className="mt-3 px-3">
      <div
        // Block container — bordered card. Width naturally caps via parent bubble.
        style={{
          background: TOKENS.surface,
          border: `1px solid ${TOKENS.border}`,
          borderRadius: '12px',
          padding: '16px',
          opacity: phase === 'submitting' ? 0.5 : 1,
          transition: 'opacity 300ms ease',
        }}
      >
        {/* Block header — context hint (eyebrow) + X/N progress */}
        <div
          className="font-mono"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '14px',
            paddingBottom: '12px',
            borderBottom: `1px solid ${TOKENS.border}`,
            gap: '8px',
          }}
        >
          <span
            style={{
              fontSize: '11px',
              color: TOKENS.textMuted,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              flex: '1 1 auto',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {contextHint ?? 'Label these'}
          </span>
          <span
            style={{
              fontSize: '12px',
              color: allLabelled ? TOKENS.accent : TOKENS.textMuted,
              fontWeight: 500,
              transition: 'color 200ms ease',
              flex: '0 0 auto',
            }}
          >
            {labelCount}/{total}
          </span>
        </div>

        {/* Transaction rows */}
        {transactions.map((tx, idx) => (
          <TransactionRow
            key={tx.id}
            tx={tx}
            isLast={idx === transactions.length - 1}
            currentLabel={labels[tx.id]}
            options={options}
            onLabel={(q) => handleLabel(tx.id, q)}
            disabled={!isInteractive}
            currency={userCurrency}
          />
        ))}
      </div>

      {/* Submit button — only in labelling phase */}
      {phase === 'labelling' && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allLabelled}
          className="font-sans"
          style={{
            width: '100%',
            padding: '14px',
            background: allLabelled ? TOKENS.accent : TOKENS.surface,
            color: allLabelled ? TOKENS.bgOnAccent : TOKENS.textMuted,
            border: `1px solid ${allLabelled ? TOKENS.accent : TOKENS.border}`,
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 500,
            letterSpacing: '0.02em',
            cursor: allLabelled ? 'pointer' : 'not-allowed',
            transition: 'all 200ms ease',
            marginTop: '16px',
            minHeight: '44px',
          }}
        >
          {allLabelled ? 'Send to C.' : `Label ${total - labelCount} more`}
        </button>
      )}

      {/* "C. is reading..." beat */}
      {phase === 'submitting' && (
        <div
          className="font-mono"
          style={{
            textAlign: 'center',
            padding: '20px',
            color: TOKENS.textMuted,
            fontSize: '13px',
            letterSpacing: '0.05em',
          }}
        >
          <span style={{ opacity: 0.6 }}>C. is reading…</span>
        </div>
      )}
    </div>
  )
}

// ── Transaction row ───────────────────────────────────────────────────────────

interface TransactionRowProps {
  tx: LabelTransactionsTransaction
  isLast: boolean
  currentLabel: LabelTransactionsQuadrantId | undefined
  options: LabelTransactionsOption[]
  onLabel: (q: LabelTransactionsQuadrantId) => void
  disabled: boolean
  currency: string
}

function TransactionRow({
  tx,
  isLast,
  currentLabel,
  options,
  onLabel,
  disabled,
  currency,
}: TransactionRowProps) {
  return (
    <div
      style={{
        paddingBottom: isLast ? 0 : '14px',
        marginBottom: isLast ? 0 : '14px',
        borderBottom: isLast ? 'none' : `1px solid ${TOKENS.border}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '8px',
          gap: '12px',
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 auto' }}>
          <div
            className="font-sans"
            style={{
              fontSize: '15px',
              color: TOKENS.textPrimary,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {tx.merchant || 'Unknown'}
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: '11px',
              color: TOKENS.textMuted,
              marginTop: '2px',
              letterSpacing: '0.04em',
            }}
          >
            {formatRowDate(tx.date)}
            {tx.time ? ` · ${tx.time}` : ''}
          </div>
        </div>
        <div
          className="font-mono tabular-nums"
          style={{
            fontSize: '15px',
            color: TOKENS.textSecondary,
            flex: '0 0 auto',
          }}
        >
          {formatRowAmount(tx.amount, currency)}
        </div>
      </div>

      {/* 5-pill grid laid out as 2 rows (3 + 2) so labels never clip on
          mobile. Five-across at 11px clips "Unsure" inside the chat sheet
          width; the prototype's repeat(4, 1fr) was already wrong for five
          quadrants. */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '6px',
          marginTop: '10px',
        }}
      >
        {options.map((q) => {
          const selected = currentLabel === q.id
          return (
            <PillButton
              key={q.id}
              option={q}
              selected={selected}
              disabled={disabled}
              onClick={() => onLabel(q.id)}
            />
          )
        })}
      </div>
    </div>
  )
}

// ── Pill button ───────────────────────────────────────────────────────────────

interface PillButtonProps {
  option: LabelTransactionsOption
  selected: boolean
  disabled: boolean
  onClick: () => void
}

function PillButton({ option, selected, disabled, onClick }: PillButtonProps) {
  const [hover, setHover] = useState(false)

  const showAccent = selected || (hover && !disabled)
  const background = selected ? option.color : 'transparent'
  const color = selected
    ? TOKENS.bgOnAccent
    : showAccent
      ? option.color
      : TOKENS.textSecondary
  const borderColor = selected
    ? option.color
    : showAccent
      ? option.color
      : TOKENS.border

  return (
    <button
      type="button"
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      aria-pressed={selected}
      aria-label={`${option.label} — ${option.desc}`}
      title={option.desc}
      className="font-sans"
      style={{
        padding: '9px 4px',
        background,
        color,
        border: `1px solid ${borderColor}`,
        borderRadius: '6px',
        fontSize: '11px',
        fontWeight: selected ? 600 : 400,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 180ms ease',
        letterSpacing: '0.02em',
        // Touch target: keep at least 44px tall so mobile taps are reliable.
        // The prototype was 32px; we raise to the project's CLAUDE.md rule.
        minHeight: '44px',
        opacity: disabled && !selected ? 0.65 : 1,
      }}
    >
      {option.label}
    </button>
  )
}
