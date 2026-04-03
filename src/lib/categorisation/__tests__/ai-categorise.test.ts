import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("ai", () => ({
  generateText: vi.fn(),
}))

vi.mock("@ai-sdk/google", () => ({
  google: vi.fn(() => "mock-gemini-model"),
}))

import { generateText } from "ai"
import { aiCategoriseBatch } from "../ai-categorise"

const mockGenerateText = vi.mocked(generateText)

const CATEGORIES = ["Groceries", "Dining out", "Transport", "Healthcare", "Other expense"]

function mockResponse(results: Array<{ merchant: string; category: string; confidence: string }>) {
  mockGenerateText.mockResolvedValueOnce({
    text: JSON.stringify({ results }),
  } as Awaited<ReturnType<typeof generateText>>)
}

describe("aiCategoriseBatch", () => {
  const originalKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY

  beforeEach(() => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key"
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalKey
  })

  it("returns high-confidence category for a known merchant", async () => {
    mockResponse([{ merchant: "mercadona", category: "Groceries", confidence: "high" }])
    const result = await aiCategoriseBatch(
      [{ text: "mercadona", amount: 45.20, type: "expense" }],
      CATEGORIES
    )
    expect(result.get("mercadona")).toEqual({ categoryName: "Groceries", confidence: "high" })
  })

  it("returns medium-confidence category", async () => {
    mockResponse([{ merchant: "farmacia torres", category: "Healthcare", confidence: "medium" }])
    const result = await aiCategoriseBatch(
      [{ text: "farmacia torres", amount: 12.50, type: "expense" }],
      CATEGORIES
    )
    expect(result.get("farmacia torres")).toEqual({ categoryName: "Healthcare", confidence: "medium" })
  })

  it("filters out low-confidence results", async () => {
    mockResponse([{ merchant: "xyz unknown", category: "Other expense", confidence: "low" }])
    const result = await aiCategoriseBatch(
      [{ text: "xyz unknown", amount: 5.00, type: "expense" }],
      CATEGORIES
    )
    expect(result.size).toBe(0)
  })

  it("returns empty map when generateText throws", async () => {
    mockGenerateText.mockRejectedValueOnce(new Error("API error"))
    const result = await aiCategoriseBatch(
      [{ text: "some merchant", amount: 10, type: "expense" }],
      CATEGORIES
    )
    expect(result.size).toBe(0)
  })

  it("returns empty map when API key is not set", async () => {
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    const result = await aiCategoriseBatch(
      [{ text: "mercadona", amount: 45, type: "expense" }],
      CATEGORIES
    )
    expect(result.size).toBe(0)
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it("returns empty map for empty merchant list without calling API", async () => {
    const result = await aiCategoriseBatch([], CATEGORIES)
    expect(result.size).toBe(0)
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it("batches >20 merchants into multiple API calls", async () => {
    const merchants = Array.from({ length: 25 }, (_, i) => ({
      text: `merchant-${i}`,
      amount: 10,
      type: "expense",
    }))

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        results: Array.from({ length: 20 }, (_, i) => ({
          merchant: `merchant-${i}`,
          category: "Shopping",
          confidence: "high",
        })),
      }),
    } as Awaited<ReturnType<typeof generateText>>)

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        results: Array.from({ length: 5 }, (_, i) => ({
          merchant: `merchant-${20 + i}`,
          category: "Shopping",
          confidence: "high",
        })),
      }),
    } as Awaited<ReturnType<typeof generateText>>)

    const result = await aiCategoriseBatch(merchants, CATEGORIES)
    expect(mockGenerateText).toHaveBeenCalledTimes(2)
    expect(result.size).toBe(25)
  })

  it("handles malformed JSON response gracefully", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "this is not json ```markdown stuff```",
    } as Awaited<ReturnType<typeof generateText>>)

    const result = await aiCategoriseBatch(
      [{ text: "some merchant", amount: 10, type: "expense" }],
      CATEGORIES
    )
    expect(result.size).toBe(0)
  })
})
