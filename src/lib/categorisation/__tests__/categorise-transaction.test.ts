import { describe, it, expect } from "vitest"
import {
  categoriseTransaction,
  categoriseTransactions,
  type MerchantMapping,
} from "../categorise-transaction"

const systemMappings: MerchantMapping[] = [
  { merchant_pattern: "deliveroo", category_name: "Dining out", source: "system", profile_id: null },
  { merchant_pattern: "uber eats", category_name: "Dining out", source: "system", profile_id: null },
  { merchant_pattern: "uber", category_name: "Transport", source: "system", profile_id: null },
  { merchant_pattern: "netflix", category_name: "Subscriptions", source: "system", profile_id: null },
  { merchant_pattern: "amazon prime", category_name: "Subscriptions", source: "system", profile_id: null },
  { merchant_pattern: "amazon", category_name: "Shopping", source: "system", profile_id: null },
  { merchant_pattern: "tesco", category_name: "Groceries", source: "system", profile_id: null },
  { merchant_pattern: "salary", category_name: "Salary", source: "system", profile_id: null },
]

const userMappings: MerchantMapping[] = [
  { merchant_pattern: "tesco", category_name: "Shopping", source: "user", profile_id: "user-1" },
]

const allMappings = [...systemMappings, ...userMappings]

describe("categoriseTransaction", () => {
  it("matches a simple system pattern", () => {
    expect(categoriseTransaction("Netflix monthly charge", systemMappings)).toBe("Subscriptions")
  })

  it("is case-insensitive", () => {
    expect(categoriseTransaction("DELIVEROO ORDER", systemMappings)).toBe("Dining out")
  })

  it("returns Uncategorised when no match found", () => {
    expect(categoriseTransaction("random shop xyz", systemMappings)).toBe("Uncategorised")
  })

  it("returns Uncategorised for empty string", () => {
    expect(categoriseTransaction("", systemMappings)).toBe("Uncategorised")
  })

  it("longest match wins: 'uber eats' beats 'uber'", () => {
    expect(categoriseTransaction("Uber Eats London", systemMappings)).toBe("Dining out")
  })

  it("shorter match works when longer does not apply", () => {
    expect(categoriseTransaction("Uber trip to airport", systemMappings)).toBe("Transport")
  })

  it("longest match wins: 'amazon prime' beats 'amazon'", () => {
    expect(categoriseTransaction("Amazon Prime Video", systemMappings)).toBe("Subscriptions")
  })

  it("shorter match for plain amazon", () => {
    expect(categoriseTransaction("Amazon.co.uk order", systemMappings)).toBe("Shopping")
  })

  it("user override takes priority over system default", () => {
    expect(categoriseTransaction("Tesco Express", allMappings)).toBe("Shopping")
  })

  it("system default used when no user override exists", () => {
    expect(categoriseTransaction("Netflix", allMappings)).toBe("Subscriptions")
  })

  it("handles mappings with empty array", () => {
    expect(categoriseTransaction("anything", [])).toBe("Uncategorised")
  })
})

describe("categoriseTransactions (batch)", () => {
  it("categorises multiple texts", () => {
    const results = categoriseTransactions(
      ["Netflix", "Tesco Express", "Unknown shop"],
      systemMappings
    )
    expect(results).toEqual(["Subscriptions", "Groceries", "Uncategorised"])
  })
})

describe("keyword heuristics — European merchants + new categories", () => {
  it("Primaprix Barcelona → Groceries", () => {
    expect(categoriseTransaction("Primaprix Barcelona", [])).toBe("Groceries")
  })

  it("La Salumeria → Dining out", () => {
    expect(categoriseTransaction("La Salumeria", [])).toBe("Dining out")
  })

  it("REWE Markt → Groceries", () => {
    expect(categoriseTransaction("REWE Markt", [])).toBe("Groceries")
  })

  it("Iberia flight → Travel", () => {
    expect(categoriseTransaction("Iberia flight BCN-LHR", [])).toBe("Travel")
  })

  it("Alquiler mensual → Housing", () => {
    expect(categoriseTransaction("Alquiler mensual enero", [])).toBe("Housing")
  })

  it("Peluqueria Barcelona → Healthcare (was Personal care)", () => {
    expect(categoriseTransaction("Peluqueria Barcelona", [])).toBe("Healthcare")
  })

  it("Rossmann → Healthcare", () => {
    expect(categoriseTransaction("Rossmann Drogerie", [])).toBe("Healthcare")
  })

  it("Deutsche Bahn → Transport", () => {
    expect(categoriseTransaction("Deutsche Bahn ICE ticket", [])).toBe("Transport")
  })

  it("Media Markt → Shopping", () => {
    expect(categoriseTransaction("Media Markt Berlin", [])).toBe("Shopping")
  })
})
