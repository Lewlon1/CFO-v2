import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateObjectMock = vi.fn()
vi.mock('ai', () => ({
  generateObject: (args: unknown) => generateObjectMock(args),
}))

vi.mock('@/lib/ai/provider', () => ({
  utilityModel: 'mock-haiku' as unknown as object,
  utilityModelId: 'mock-haiku-id',
}))

vi.mock('@/lib/analytics/track-llm-usage', () => ({
  trackLLMUsage: vi.fn(),
}))

vi.mock('@/lib/ai/usage-logger', () => ({
  logBedrockUsage: vi.fn(),
}))

// Import AFTER mocks are set up so module-load reads our shims.
import { generateHypothesis, meanConfidence, renderSignalsForLLM } from './generator'
import type { HypothesisSourceSignals } from './source-signals'

const baseSignals: HypothesisSourceSignals = {
  user_id: 'u1',
  display_name: 'Test',
  country: 'GB',
  currency: 'GBP',
  income: { confidence: 0.85, cadence: 'monthly' },
  goal: {
    present: true,
    type: 'savings',
    has_target_amount: false,
    has_target_date: false,
    structure_quality: 'nameless',
  },
  value_map: {
    completed: false,
    archetype: null,
    dominant_quadrant: null,
    has_personal_data: false,
    top_foundation_categories: [],
    top_leak_categories: [],
  },
  behaviour: {
    transaction_count: 120,
    months_of_data: 4,
    discipline_label: 'disciplined',
    has_zero_spend_days: true,
    subscription_density: 'medium',
  },
  entry: { struggle_type: 'planning', free_text_excerpt: null },
}

beforeEach(() => {
  generateObjectMock.mockReset()
})

describe('renderSignalsForLLM', () => {
  it('renders sparse signals plainly without money amounts or currency', () => {
    const text = renderSignalsForLLM({
      ...baseSignals,
      income: { confidence: 0, cadence: 'unknown' },
      goal: { present: false, type: null, has_target_amount: false, has_target_date: false, structure_quality: 'nameless' },
    })
    // No currency symbols
    expect(text).not.toMatch(/[£$€¥]/)
    // No money-like patterns (e.g. "1234.56" or "1,234")
    expect(text).not.toMatch(/\d[\d.,]*\.\d{2}\b/)
    expect(text).not.toMatch(/\b\d{1,3}(?:,\d{3})+\b/)
    expect(text).toContain('No goal stated')
    expect(text).toContain('Cadence: unknown')
  })

  it('labels income confidence by band', () => {
    const high = renderSignalsForLLM({ ...baseSignals, income: { confidence: 0.85, cadence: 'monthly' } })
    expect(high).toContain('Confidence: high')

    const medium = renderSignalsForLLM({ ...baseSignals, income: { confidence: 0.5, cadence: 'monthly' } })
    expect(medium).toContain('Confidence: medium')

    const low = renderSignalsForLLM({ ...baseSignals, income: { confidence: 0.2, cadence: 'irregular' } })
    expect(low).toContain('Confidence: low')
  })

  it('renders personal value profile section when present', () => {
    const text = renderSignalsForLLM({
      ...baseSignals,
      value_map: {
        completed: true,
        archetype: 'The Builder',
        dominant_quadrant: 'foundation',
        has_personal_data: true,
        top_foundation_categories: ['groceries', 'transit'],
        top_leak_categories: ['gambling'],
      },
    })
    expect(text).toContain('Archetype: The Builder')
    expect(text).toContain('Dominant perception: foundation')
    expect(text).toContain('Top Foundation: groceries, transit')
    expect(text).toContain('Top Leak: gambling')
  })

  it('marks personal value profile as not-yet-derived when absent', () => {
    const text = renderSignalsForLLM(baseSignals)
    expect(text).toContain('Personal value profile not yet derived from real spending.')
  })
})

describe('meanConfidence', () => {
  it('averages the per-line confidence to 2 decimals', () => {
    expect(
      meanConfidence([
        { text: 'a'.repeat(30), confidence: 0.9 },
        { text: 'b'.repeat(30), confidence: 0.6 },
        { text: 'c'.repeat(30), confidence: 0.3 },
      ]),
    ).toBe(0.6)
  })

  it('returns 0 for an empty list', () => {
    expect(meanConfidence([])).toBe(0)
  })
})

describe('generateHypothesis', () => {
  it('returns 3 valid lines on a clean Bedrock response', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        lines: [
          { text: 'Salaried with steady cadence — discretionary headroom but not endless.', confidence: 0.85 },
          { text: 'Value Map not yet completed — values orientation is still unread.', confidence: 0.6 },
          { text: 'Savings goal stated but unsculpted — gap is structural, not behavioural.', confidence: 0.7 },
        ],
      },
      usage: { inputTokens: 300, outputTokens: 120 },
    })

    const out = await generateHypothesis(baseSignals)
    expect(out?.lines).toHaveLength(3)
    expect(out?.lines[0].confidence).toBeCloseTo(0.85)
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
  })

  it('returns null on Bedrock failure (timeout, network, etc.)', async () => {
    generateObjectMock.mockRejectedValue(new Error('Bedrock timeout'))
    const out = await generateHypothesis(baseSignals)
    expect(out).toBeNull()
  })

  it('returns null when schema validation rejects the response', async () => {
    // generateObject throws on schema mismatch; simulate that
    generateObjectMock.mockRejectedValue(new Error('Schema validation failed'))
    const out = await generateHypothesis(baseSignals)
    expect(out).toBeNull()
  })

  it('passes through the structured-output schema and a system prompt', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        lines: [
          { text: 'a'.repeat(30), confidence: 0.5 },
          { text: 'b'.repeat(30), confidence: 0.5 },
          { text: 'c'.repeat(30), confidence: 0.5 },
        ],
      },
      usage: { inputTokens: 100, outputTokens: 50 },
    })
    await generateHypothesis(baseSignals)
    const args = generateObjectMock.mock.calls[0][0]
    expect(args.schema).toBeDefined()
    expect(args.system).toContain('CFO')
    expect(args.temperature).toBe(0.4)
    expect(args.maxOutputTokens).toBe(600)
  })
})
