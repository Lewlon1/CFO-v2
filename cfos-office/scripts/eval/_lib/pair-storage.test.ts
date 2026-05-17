import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  assignFold,
  generatePairId,
  hashPrompt,
  deriveWinner,
  buildPair,
  writePair,
  readPair,
  listPairIds,
  listPairs,
  appendJudgePrediction,
  applyRating,
  pairsDir,
  TIE_BAND,
  type NewPairInput,
  type JudgePrediction,
  type GoldenPair,
} from './pair-storage'

// Each test gets a fresh dir. We monkey-patch the pairsDir resolver by
// pointing CFO_EVAL_PAIRS_DIR_OVERRIDE — actually, simpler: we just write to
// the real eval/golden-set/pairs and clean up our test files by their
// fingerprint prefix afterwards. The repo's pairsDir is shared, but tests
// generate uniquely-prefixed pair_ids so collisions can't happen.

const TEST_PREFIX = '__pair-storage-test__'

function makeTestPair(overrides: Partial<NewPairInput> = {}): GoldenPair {
  const pair = buildPair({
    source: 'manual',
    persona_id: null,
    user_id: 'test-user',
    trigger_message: 'test trigger',
    known_merchants: ['Tesco', 'Aldi'],
    user_brief: 'test brief',
    variant_a: { label: 'a', system_prompt: 'prompt a' },
    variant_b: { label: 'b', system_prompt: 'prompt b' },
    response_a: { text: 'response a', tool_calls: [], tokens: { in: 100, out: 50 } },
    response_b: { text: 'response b', tool_calls: [], tokens: { in: 110, out: 55 } },
    ...overrides,
  })
  // Tag with prefix so cleanup can find them
  pair.pair_id = `${TEST_PREFIX}${pair.pair_id}`
  pair.fold = assignFold(pair.pair_id)
  return pair
}

function cleanup() {
  // Best-effort cleanup of test-generated pair files
  try {
    const { readdirSync, unlinkSync } = require('node:fs')
    const dir = pairsDir()
    if (!existsSync(dir)) return
    for (const f of readdirSync(dir)) {
      if (f.startsWith(TEST_PREFIX)) {
        unlinkSync(join(dir, f))
      }
    }
  } catch {
    // ignore
  }
}

afterAll(cleanup)
beforeEach(cleanup)

describe('assignFold', () => {
  it('is deterministic for the same pair_id', () => {
    const id = 'abc-123'
    expect(assignFold(id)).toBe(assignFold(id))
  })

  it('returns either train or holdout', () => {
    for (let i = 0; i < 100; i++) {
      const fold = assignFold(`pair-${i}`)
      expect(fold === 'train' || fold === 'holdout').toBe(true)
    }
  })

  it('produces approximately 20% holdout over many ids', () => {
    let holdout = 0
    const n = 1000
    for (let i = 0; i < n; i++) {
      if (assignFold(`pair-${i}`) === 'holdout') holdout++
    }
    const ratio = holdout / n
    expect(ratio).toBeGreaterThan(0.12)
    expect(ratio).toBeLessThan(0.28)
  })
})

describe('generatePairId', () => {
  it('produces unique ids across calls', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) ids.add(generatePairId())
    expect(ids.size).toBe(100)
  })

  it('produces uuid-shaped ids', () => {
    expect(generatePairId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})

describe('hashPrompt', () => {
  it('produces a stable 16-char hex hash', () => {
    const h = hashPrompt('hello world')
    expect(h).toMatch(/^[0-9a-f]{16}$/)
    expect(h).toBe(hashPrompt('hello world'))
  })

  it('differs for different inputs', () => {
    expect(hashPrompt('a')).not.toBe(hashPrompt('b'))
  })
})

describe('deriveWinner', () => {
  it('returns "a" when score_a exceeds score_b by more than tie band', () => {
    expect(deriveWinner(0.8, 0.7)).toBe('a')
  })

  it('returns "b" when score_b exceeds score_a by more than tie band', () => {
    expect(deriveWinner(0.5, 0.8)).toBe('b')
  })

  it('returns "tie" when scores are within tie band', () => {
    expect(deriveWinner(0.5, 0.5)).toBe('tie')
    expect(deriveWinner(0.5, 0.51)).toBe('tie')
    expect(deriveWinner(0.5, 0.519)).toBe('tie')
  })

  it('respects custom tie band', () => {
    expect(deriveWinner(0.51, 0.5, 0.001)).toBe('a')
    expect(deriveWinner(0.51, 0.5, 0.05)).toBe('tie')
  })

  it('uses default TIE_BAND of 0.02', () => {
    expect(TIE_BAND).toBe(0.02)
  })
})

describe('buildPair', () => {
  it('produces a well-formed pair with rating=null and empty predictions', () => {
    const pair = makeTestPair()
    expect(pair.pair_id).toBeDefined()
    expect(pair.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(pair.fold).toMatch(/^(train|holdout)$/)
    expect(pair.rating).toBeNull()
    expect(pair.judge_predictions).toEqual([])
    expect(pair.input.prompt_variants.a.hash).toMatch(/^[0-9a-f]{16}$/)
    expect(pair.input.prompt_variants.b.hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('preserves the variant labels and responses', () => {
    const pair = makeTestPair({
      variant_a: { label: 'v1', system_prompt: 'sysprompt v1' },
      variant_b: { label: 'v2', system_prompt: 'sysprompt v2' },
    })
    expect(pair.input.prompt_variants.a.label).toBe('v1')
    expect(pair.input.prompt_variants.b.label).toBe('v2')
    expect(pair.input.prompt_variants.a.hash).toBe(hashPrompt('sysprompt v1'))
    expect(pair.input.prompt_variants.b.hash).toBe(hashPrompt('sysprompt v2'))
  })
})

describe('writePair / readPair round-trip', () => {
  it('round-trips a pair through disk without data loss', () => {
    const pair = makeTestPair()
    writePair(pair)
    const read = readPair(pair.pair_id)
    expect(read).toEqual(pair)
  })

  it('listPairIds includes a freshly written pair', () => {
    const pair = makeTestPair()
    writePair(pair)
    expect(listPairIds()).toContain(pair.pair_id)
  })
})

describe('applyRating', () => {
  it('writes back the rating and clears nothing else', () => {
    const pair = makeTestPair()
    writePair(pair)
    const updated = applyRating(pair.pair_id, {
      winner: 'a',
      rater: 'lewis',
      rated_at: '2026-05-17T12:00:00Z',
      notes: null,
    })
    expect(updated.rating?.winner).toBe('a')
    const reread = readPair(pair.pair_id)
    expect(reread.rating?.winner).toBe('a')
    expect(reread.responses.a.text).toBe('response a')
  })
})

describe('appendJudgePrediction', () => {
  it('appends without overwriting existing predictions', () => {
    const pair = makeTestPair()
    writePair(pair)
    const pred1: JudgePrediction = {
      judge_id: 'champion-1',
      run_at: '2026-05-17T12:00:00Z',
      score_a: 0.7,
      score_b: 0.6,
      predicted_winner: 'a',
      diagnostic: {},
    }
    const pred2: JudgePrediction = {
      judge_id: 'champion-2',
      run_at: '2026-05-17T13:00:00Z',
      score_a: 0.5,
      score_b: 0.8,
      predicted_winner: 'b',
      diagnostic: {},
    }
    appendJudgePrediction(pair.pair_id, pred1)
    appendJudgePrediction(pair.pair_id, pred2)
    const reread = readPair(pair.pair_id)
    expect(reread.judge_predictions).toHaveLength(2)
    expect(reread.judge_predictions[0].judge_id).toBe('champion-1')
    expect(reread.judge_predictions[1].judge_id).toBe('champion-2')
  })
})

describe('listPairs filter', () => {
  it('filters by rated=false (unrated only)', () => {
    const rated = makeTestPair()
    const unrated = makeTestPair()
    writePair(rated)
    writePair(unrated)
    applyRating(rated.pair_id, {
      winner: 'a',
      rater: 'lewis',
      rated_at: '2026-05-17T12:00:00Z',
      notes: null,
    })
    const unratedIds = listPairs({ rated: false }).map((p) => p.pair_id)
    expect(unratedIds).toContain(unrated.pair_id)
    expect(unratedIds).not.toContain(rated.pair_id)
  })

  it('filters by fold', () => {
    // Build a few pairs and check that listPairs({fold: 'holdout'}) only
    // returns the holdout fold ones.
    const pairs: GoldenPair[] = []
    for (let i = 0; i < 20; i++) {
      const p = makeTestPair()
      writePair(p)
      pairs.push(p)
    }
    const holdout = listPairs({ fold: 'holdout' })
    for (const p of holdout) {
      expect(p.fold).toBe('holdout')
    }
    // Should include at least one of our holdout pairs
    const ourHoldout = pairs.filter((p) => p.fold === 'holdout')
    if (ourHoldout.length > 0) {
      expect(holdout.map((p) => p.pair_id)).toEqual(
        expect.arrayContaining(ourHoldout.map((p) => p.pair_id)),
      )
    }
  })
})
