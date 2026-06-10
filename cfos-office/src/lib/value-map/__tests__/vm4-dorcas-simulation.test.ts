import { describe, it, expect } from 'vitest'
import { classifyArchetype, type AnsweredCard } from '../classify-archetype'
import { buildReceiptLines } from '../receipt-templates'
import { detectTension, type TensionTxnRow } from '../tension-detector'
import { computePayback, type PaybackTxnRow } from '../payback'
import { FAMILY_PAYBACK_CTA, FAMILY_FRAME_LINES } from '../taxonomy-config'
import type { RevealPayload } from '../reveal'

// VM-4 Dorcas simulation — the deterministic pipeline end-to-end, exactly as
// POST /api/value-map/onboarding sequences it: answered cards → classify →
// receipt lines → tension → reveal payload, with payback computed alongside
// and asserted untouched. The two seams not exercised here are auth and
// Bedrock (covered by generate-reading.test.ts) and the actual DB write
// (schema applied + verified on staging). GBP, broad merchant mix — the
// established Dorcas fixture style.

const TODAY = new Date('2026-06-10T12:00:00Z')

// Dorcas sorts 10 cards: foundation-heavy with two flagged cuts.
const DORCAS_CARDS: Array<AnsweredCard & { merchant: string }> = [
  { merchant: 'tesco', quadrant: 'foundation', confidence: 5, hardToDecide: false, deliberationMs: 600 },
  { merchant: 'thames water', quadrant: 'foundation', confidence: 5, hardToDecide: false, deliberationMs: 450 },
  { merchant: 'edf energy', quadrant: 'foundation', confidence: 4, hardToDecide: false, deliberationMs: 700 },
  { merchant: 'tfl', quadrant: 'foundation', confidence: 4, hardToDecide: false, deliberationMs: 500 },
  { merchant: 'boots', quadrant: 'foundation', confidence: 4, hardToDecide: false, deliberationMs: 800 },
  { merchant: 'puregym', quadrant: 'investment', confidence: 4, hardToDecide: false, deliberationMs: 900 },
  { merchant: 'coursera', quadrant: 'investment', confidence: 5, hardToDecide: false, deliberationMs: 650 },
  { merchant: 'vodafone', quadrant: 'burden', confidence: 4, hardToDecide: false, deliberationMs: 1100 },
  { merchant: 'deliveroo', quadrant: 'leak', confidence: 4, hardToDecide: false, deliberationMs: 1300 },
  { merchant: 'mubi', quadrant: 'leak', confidence: 3, hardToDecide: false, deliberationMs: 1600 },
]

function txn(date: string, amount: number, description: string, value_category: string | null = null): TensionTxnRow & PaybackTxnRow {
  return {
    description,
    amount,
    date,
    value_category,
    value_confidence: value_category ? 1.0 : null,
    value_confirmed_by_user: value_category ? true : null,
  }
}

// Post-rescore history: foundation-dominant (agrees with the sorting).
const DORCAS_HISTORY = [
  txn('2026-03-04', -320, 'TESCO', 'foundation'),
  txn('2026-04-04', -310, 'TESCO', 'foundation'),
  txn('2026-05-04', -335, 'TESCO', 'foundation'),
  txn('2026-03-12', -45, 'THAMES WATER', 'foundation'),
  txn('2026-04-12', -45, 'THAMES WATER', 'foundation'),
  txn('2026-05-12', -45, 'THAMES WATER', 'foundation'),
  txn('2026-03-20', -30, 'PUREGYM', 'investment'),
  txn('2026-04-20', -30, 'PUREGYM', 'investment'),
  txn('2026-05-20', -30, 'PUREGYM', 'investment'),
  txn('2026-03-15', -60, 'DELIVEROO', 'leak'),
  txn('2026-04-15', -85, 'DELIVEROO', 'leak'),
  txn('2026-05-15', -70, 'DELIVEROO', 'leak'),
]

describe('VM-4 Dorcas simulation — full deterministic pipeline', () => {
  const classification = classifyArchetype(DORCAS_CARDS)

  it('classifies into a named cell with a valid, JSON-serialisable receipt', () => {
    // 5/10 foundation (ratio 1.0804), 2/10 investment (0.6897), 1/10 burden
    // (0.5876), 2/10 leak (2.6008) → candor wins, 'several times the typical
    // rate'. Certainty: avg conf 4.2 (z +6.205), no hard cards, median delib
    // 750ms (z −0.9596 → +0.9596) → composite > 0 → certain → The Editor.
    expect(classification.taxonomyVersion).toBe('v1')
    expect(classification.family).toBe('candor')
    expect(classification.certainty).toBe('certain')
    expect(classification.displayName).toBe('The Editor')
    expect(classification.usedFallback).toBe(false)

    // Receipt JSON valid: survives a round-trip intact (what the session row stores).
    const roundTrip = JSON.parse(JSON.stringify(classification.receipt))
    expect(roundTrip).toEqual(classification.receipt)
    expect(roundTrip.ratiosByQuadrant.leak).toBeCloseTo(2.6008, 3)
  })

  it('builds receipt lines with bands only — no raw milliseconds anywhere', () => {
    const lines = buildReceiptLines('candor', classification.receipt)
    expect(lines.headline).toBe(
      'You sorted 10 transactions. 2 went to Leak — several times the typical rate.',
    )
    // 7 cards ≤914ms (quick), 1100/1300ms (considered), 1600ms (slow).
    expect(lines.bands).toBe('7 quick calls, 2 considered, 1 took real thought.')
    for (const text of [lines.headline, lines.bands]) {
      expect(text).not.toMatch(/\d{3,}\s?ms|deliberation|_ms/i)
    }
  })

  it('tension detector: D1 fires (candor-stated vs foundation-observed) and is logged', () => {
    const tension = detectTension('candor', 'certain', {
      rows: DORCAS_HISTORY,
      protectedMerchants: [
        { merchant: 'tesco', quadrant: 'foundation' },
        { merchant: 'puregym', quadrant: 'investment' },
      ],
      currency: 'GBP',
      today: TODAY,
    })
    // Displayable money is foundation-dominant (£1,150 of £1,405) while the
    // sorting over-indexed leak → stated–observed mismatch, both sides named.
    expect(tension.type).toBe('stated_observed_mismatch')
    expect(tension.line).toContain('Leak')
    expect(tension.line).toContain('Foundation')
    console.log('[VM-4 Dorcas] tension detector choice:', tension.type, '—', tension.line)
  })

  it('payback is unchanged to the cent by VM-4 (same inputs → same output)', () => {
    const answeredMerchants = new Set(DORCAS_CARDS.map((c) => c.merchant))
    const payback = computePayback(DORCAS_HISTORY, answeredMerchants, 10)
    // 12 mapped transactions, £1,405 over 3 months → £468.33/mo to the cent.
    expect(payback.mappedTransactions).toBe(12)
    expect(payback.monthsSpanned).toBe(3)
    expect(payback.monthlyMapped).toBe(468.33)
  })

  it('reveal payload renders-ready and CTA/frame flavour resolve deterministically', () => {
    const lines = buildReceiptLines('candor', classification.receipt)
    const reveal: RevealPayload = {
      sessionId: 'dorcas-session',
      family: classification.family,
      certainty: classification.certainty,
      displayName: classification.displayName,
      usedFallback: false,
      receiptHeadline: lines.headline,
      receiptBands: lines.bands,
      tensionLine: 'stub',
    }
    expect(reveal.displayName).toBe('The Editor')
    expect(FAMILY_PAYBACK_CTA[classification.family!]).toBe('On to the honest plan')
    expect(FAMILY_FRAME_LINES[classification.family!][classification.certainty!]).toBe(
      'An Editor plan cuts what you’ve already called waste.',
    )
  })
})
