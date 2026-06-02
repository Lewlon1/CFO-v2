import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ImportableTransaction } from './pipeline'
import type { Category } from '@/lib/parsers/types'

// The LLM fallback (Pass 2 of runImportPipeline) was unreachable in production
// for months: the client sends a categoryId for every row, rules-uncategorised
// rows arrived as explicit `null`, and the preset branch swallowed them with
// needsLLM:false. These tests pin the contract so Pass 2 can't silently go dark
// again:
//   - presetCategoryId == null/undefined → re-derive (rules + LLM)
//   - presetCategoryId === ''            → explicit "Uncategorised", honour, no LLM
//   - presetCategoryId === '<id>'        → user pick, honour, no LLM

vi.mock('@/lib/categorisation/llm-categoriser', () => ({
  llmCategorise: vi.fn().mockResolvedValue([]),
  saveLearnedMerchantRules: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/prediction/predictor', () => ({
  loadUserRules: vi.fn().mockResolvedValue([]),
  resolveValueCategory: vi
    .fn()
    .mockReturnValue({ value_category: 'unsure', confidence: 0.5, source: 'global' }),
}))
vi.mock('./duplicate-detector', () => ({
  loadExistingKeys: vi.fn().mockResolvedValue(new Set<string>()),
  isDuplicate: vi.fn().mockReturnValue(false),
  computeDedupeHash: vi.fn((date: string, amount: number, desc: string) => `${date}|${amount}|${desc}`),
}))
vi.mock('@/lib/alerts/notify', () => ({ sendAlert: vi.fn() }))

import { runImportPipeline } from './pipeline'
import { llmCategorise } from '@/lib/categorisation/llm-categoriser'

const CATEGORIES: Category[] = [
  {
    id: 'groceries',
    name: 'Groceries',
    tier: 'core',
    icon: '',
    color: '',
    description: null,
    examples: [],
    default_value_category: null,
  },
]

// Minimal chainable Supabase stub: select()/eq() return self; the builder is a
// thenable resolving to { data }. transactions.insert() resolves { error: null }.
function makeSupabase(): SupabaseClient {
  const thenable = (result: unknown) => {
    const b = {
      select: () => b,
      eq: () => b,
      upsert: () => Promise.resolve({ error: null }),
      then: (resolve: (v: unknown) => void) => resolve(result),
    }
    return b
  }
  return {
    from(table: string) {
      if (table === 'categories') return thenable({ data: CATEGORIES })
      if (table === 'transactions') return { insert: () => Promise.resolve({ error: null }) }
      return thenable({ data: [] })
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  } as unknown as SupabaseClient
}

// A description deliberately unmatched by every rules-engine tier.
const UNMATCHABLE = 'Zzz Unknown Merchant 90210'

function txn(overrides: Partial<ImportableTransaction> = {}): ImportableTransaction {
  return {
    date: '2026-01-05T00:00:00Z',
    description: UNMATCHABLE,
    raw_description: UNMATCHABLE,
    amount: -12.34,
    currency: 'EUR',
    source: 'csv_universal',
    ...overrides,
  }
}

describe('runImportPipeline — LLM fallback reachability (regression guard)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes rules-uncategorised rows with an explicit null preset to the LLM fallback', async () => {
    await runImportPipeline([txn({ presetCategoryId: null })], makeSupabase(), {
      userId: 'u1',
      importBatchId: 'b1',
      skipDuplicates: false,
    })

    expect(llmCategorise).toHaveBeenCalledTimes(1)
    const descriptions = vi.mocked(llmCategorise).mock.calls[0][0]
    expect(descriptions).toContain(UNMATCHABLE)
  })

  it('routes rules-uncategorised rows with no preset at all to the LLM fallback', async () => {
    await runImportPipeline([txn()], makeSupabase(), {
      userId: 'u1',
      importBatchId: 'b1',
      skipDuplicates: false,
    })

    expect(llmCategorise).toHaveBeenCalledTimes(1)
  })

  it('does NOT call the LLM when the user explicitly chose Uncategorised (preset "")', async () => {
    await runImportPipeline([txn({ presetCategoryId: '' })], makeSupabase(), {
      userId: 'u1',
      importBatchId: 'b1',
      skipDuplicates: false,
    })

    expect(llmCategorise).not.toHaveBeenCalled()
  })

  it('does NOT call the LLM when the user picked a category (preset is a real id)', async () => {
    await runImportPipeline([txn({ presetCategoryId: 'groceries' })], makeSupabase(), {
      userId: 'u1',
      importBatchId: 'b1',
      skipDuplicates: false,
    })

    expect(llmCategorise).not.toHaveBeenCalled()
  })
})
