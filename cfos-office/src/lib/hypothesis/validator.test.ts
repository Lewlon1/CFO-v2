import { describe, it, expect } from 'vitest'
import { validateHypothesis } from './validator'

const clean = {
  lines: [
    {
      text: 'Salaried with steady cadence — discretionary headroom but not endless.',
      confidence: 0.85,
    },
    {
      text: 'Values orientation is still unread — Value Map not yet completed.',
      confidence: 0.6,
    },
    {
      text: 'Property goal stated but unsculpted — gap is structural, not behavioural.',
      confidence: 0.7,
    },
  ],
}

describe('validateHypothesis', () => {
  it('passes a clean 3-line hypothesis', () => {
    const r = validateHypothesis(clean)
    expect(r.ok).toBe(true)
  })

  it('fails on a digit anywhere in any line', () => {
    const r = validateHypothesis({
      lines: [
        { text: 'Spending around 400 per month on meals out is the dominant pattern.', confidence: 0.7 },
        clean.lines[1],
        clean.lines[2],
      ],
    })
    expect(r.ok).toBe(false)
    expect(r.offenders?.[0]).toContain('line 1')
    expect(r.offenders?.[0]).toContain('digit')
  })

  it('fails on currency symbols', () => {
    const r = validateHypothesis({
      lines: [
        { text: 'Discretionary headroom suggests £ in reserve each month consistently.', confidence: 0.6 },
        clean.lines[1],
        clean.lines[2],
      ],
    })
    expect(r.ok).toBe(false)
    expect(r.offenders?.some((o) => o.includes('currency_symbol'))).toBe(true)
  })

  it.each(['Hello — welcome to the office walkthrough today.', 'Hi there, glad to see you in your books.'])(
    'fails on greeting: %s',
    (greeting) => {
      const r = validateHypothesis({
        lines: [
          { text: greeting, confidence: 0.5 },
          clean.lines[1],
          clean.lines[2],
        ],
      })
      expect(r.ok).toBe(false)
    },
  )

  it('fails on default merchant name', () => {
    const r = validateHypothesis({
      lines: [
        { text: 'Glovo dominates dining spend across recent weeks consistently.', confidence: 0.5 },
        clean.lines[1],
        clean.lines[2],
      ],
    })
    expect(r.ok).toBe(false)
    expect(r.offenders?.[0]).toContain('merchant')
  })

  it('respects extra merchants supplied via opts', () => {
    const r = validateHypothesis(
      {
        lines: [
          { text: 'Bizum dominates peer transfers across recent weeks consistently.', confidence: 0.5 },
          clean.lines[1],
          clean.lines[2],
        ],
      },
      { knownMerchants: ['Bizum'] },
    )
    expect(r.ok).toBe(false)
  })

  it('fails on 6-gram overlap between two lines', () => {
    const dup = 'gap is structural not behavioural and well worth'
    const r = validateHypothesis({
      lines: [
        { text: `Salaried with steady cadence the ${dup} watching closely.`, confidence: 0.6 },
        { text: `Savings goal stated unsculpted the ${dup} examining now.`, confidence: 0.6 },
        clean.lines[2],
      ],
    })
    expect(r.ok).toBe(false)
    expect(r.offenders?.some((o) => o.includes('6-gram'))).toBe(true)
  })

  it('accepts lines that share short phrases (<6 tokens) but differ otherwise', () => {
    const r = validateHypothesis({
      lines: [
        { text: 'Salaried with steady cadence — discretionary headroom but not endless.', confidence: 0.8 },
        { text: 'Values still unread — Value Map not yet completed in any session.', confidence: 0.6 },
        { text: 'Goal posture loose — no anchor amount or anchor date attached.', confidence: 0.6 },
      ],
    })
    expect(r.ok).toBe(true)
  })
})
