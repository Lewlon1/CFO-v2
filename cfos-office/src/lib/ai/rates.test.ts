import { describe, it, expect } from 'vitest'
import { computeCostUsd, RATES, RATE_VERSION } from './rates'

describe('computeCostUsd', () => {
  it('throws on an unknown inference profile rather than silent-zeroing', () => {
    expect(() =>
      computeCostUsd('eu.anthropic.claude-made-up-9', { inputTokens: 100, outputTokens: 100 }),
    ).toThrow(/no rate for Bedrock inference profile/)
  })

  it('throws (not returns 0) even for a zero-token call on an unknown profile', () => {
    // A zero result would be indistinguishable from a real free call; the guard
    // must be the profile lookup, not the token math.
    expect(() => computeCostUsd('global.anthropic.claude-sonnet-4-6', {})).toThrow()
  })

  it('prices Sonnet 4.6 input + output at the list rate ($3 / $15 per MTok)', () => {
    // 1M input @ $3 + 1M output @ $15 = $18.
    const cost = computeCostUsd('eu.anthropic.claude-sonnet-4-6', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(18, 6)
  })

  it('prices cache reads at ~0.1x input and cache writes at ~1.25x input', () => {
    // 1M cache-read @ (0.1 * $3) = $0.30; 1M cache-write @ (1.25 * $3) = $3.75.
    const cost = computeCostUsd('eu.anthropic.claude-sonnet-4-6', {
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(0.3 + 3.75, 6)
  })

  it('computes a realistic chat turn (1.5k out, small in) as a fraction of a cent', () => {
    const cost = computeCostUsd('eu.anthropic.claude-sonnet-4-6', {
      inputTokens: 800,
      outputTokens: 1_500,
    })
    // 800 * 3/1e6 + 1500 * 15/1e6 = 0.0024 + 0.0225 = 0.0249
    expect(cost).toBeCloseTo(0.0249, 6)
  })

  it('keys the rate table on exact eu. inference-profile strings in use', () => {
    expect(Object.keys(RATES)).toEqual(
      expect.arrayContaining([
        'eu.anthropic.claude-sonnet-4-6',
        'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
        'eu.anthropic.claude-opus-4-6',
        'eu.amazon.nova-pro-v1:0',
        'eu.amazon.nova-lite-v1:0',
      ]),
    )
    expect(RATE_VERSION).toBe('2026-08-C1')
  })

  it('prices Nova Pro input + output at the on-demand rate ($0.80 / $3.20 per MTok)', () => {
    const cost = computeCostUsd('eu.amazon.nova-pro-v1:0', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(0.8 + 3.2, 6)
  })

  it('prices Nova Lite input + output at the on-demand rate ($0.06 / $0.24 per MTok)', () => {
    const cost = computeCostUsd('eu.amazon.nova-lite-v1:0', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(0.06 + 0.24, 6)
  })
})
