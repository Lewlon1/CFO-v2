import { describe, it, expect, vi, beforeEach } from 'vitest'
import { detectLeaks, sanitisePersona } from './persona-sanitiser'

vi.mock('./provider', () => ({
  utilityModel: 'mock-haiku' as unknown as object,
  utilityModelId: 'mock-haiku-id',
}))

const generateTextMock = vi.fn()

vi.mock('ai', () => ({
  generateText: (args: unknown) => generateTextMock(args),
}))

describe('detectLeaks', () => {
  it('counts every forbidden pattern match (patterns may overlap)', () => {
    const report = detectLeaks("I'd suggest you take my advice")
    // \bI'd\b (1) + \bI\b matches the I in I'd (1) + \bmy\b (1) + \badvice\b (1) = 4
    expect(report.count).toBe(4)
  })

  it('returns 0 for clean text', () => {
    const report = detectLeaks('Your spending on groceries dropped 12% last month.')
    expect(report.count).toBe(0)
  })

  it('detects "let me"', () => {
    const report = detectLeaks('Let me know how that went.')
    expect(report.count).toBeGreaterThan(0)
  })

  it('detects "the system" / "the app"', () => {
    expect(detectLeaks('the system found three subscriptions').count).toBeGreaterThan(0)
    expect(detectLeaks('the app does not track that yet').count).toBeGreaterThan(0)
  })
})

describe('sanitisePersona', () => {
  beforeEach(() => {
    generateTextMock.mockReset()
  })

  it('returns text unchanged when clean — no LLM call', async () => {
    const r = await sanitisePersona('Groceries dropped 12% last month.')
    expect(r.rewritten).toBe(false)
    expect(r.text).toBe('Groceries dropped 12% last month.')
    expect(r.leaks_detected).toBe(0)
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('rewrites via Haiku when leaks present', async () => {
    generateTextMock.mockResolvedValueOnce({ text: 'Your spending dropped 12% last month.' })
    const r = await sanitisePersona("I'd note that your spending dropped 12% last month.")
    expect(r.rewritten).toBe(true)
    expect(r.leaks_detected).toBeGreaterThan(0)
    expect(r.text).toBe('Your spending dropped 12% last month.')
    expect(generateTextMock).toHaveBeenCalledOnce()
  })

  it('persists original when Haiku throws', async () => {
    const original = "I'd recommend pausing that subscription."
    generateTextMock.mockRejectedValueOnce(new Error('bedrock down'))
    const r = await sanitisePersona(original)
    expect(r.rewritten).toBe(false)
    expect(r.text).toBe(original)
    expect(r.leaks_detected).toBeGreaterThan(0)
  })
})
