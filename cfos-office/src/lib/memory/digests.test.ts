import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  recordTraitDismissal,
  refreshMemoryDigests,
  renderDigest,
  type PortraitTrait,
} from './digests'
import { getFile, setFileFlags, writeFile } from './files'
import type { MemoryFile } from './files'

vi.mock('./files', () => ({
  getFile: vi.fn(),
  writeFile: vi.fn(),
  setFileFlags: vi.fn(),
}))

const mockGetFile = vi.mocked(getFile)
const mockWriteFile = vi.mocked(writeFile)
const mockSetFileFlags = vi.mocked(setFileFlags)

const USER = 'user-1'

function trait(partial: Partial<PortraitTrait> & { trait_key: string }): PortraitTrait {
  return {
    trait_type: 'behavioral',
    trait_value: 'Spends in bursts after payday.',
    confidence: 0.8,
    updated_at: '2026-08-01T09:00:00.000Z',
    created_at: '2026-08-01T09:00:00.000Z',
    ...partial,
  }
}

/** A client whose only job is to hand back a portrait. */
function clientWith(traits: PortraitTrait[], error: unknown = null): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => Promise.resolve({ data: error ? null : traits, error }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

function filed(partial: Partial<MemoryFile> = {}): MemoryFile {
  return {
    id: 'file-1',
    folder: 'values',
    slug: 'patterns',
    title: 'The pattern so far',
    description: 'A description',
    content: 'Previous body.',
    source: 'system',
    updated_by: 'system',
    user_edited_at: null,
    pinned: true,
    archived_at: null,
    created_at: '2026-07-01T09:00:00.000Z',
    updated_at: '2026-08-02T09:00:00.000Z',
    ...partial,
  }
}

/** getFile answers for one folder and null for the rest. */
function onlyFiled(folder: string, file: MemoryFile | null) {
  mockGetFile.mockImplementation(async (_client, _user, f) =>
    ({ ok: true, value: f === folder ? file : null }) as never,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetFile.mockResolvedValue({ ok: true, value: null })
  mockWriteFile.mockResolvedValue({ ok: true, value: filed() as never })
  mockSetFileFlags.mockResolvedValue({ ok: true, value: filed() as never })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('renderDigest', () => {
  it('groups traits under headings in a fixed order', () => {
    const body = renderDigest('values', [
      trait({ trait_key: 'values_travel', trait_type: 'value_preference', trait_value: 'Travel earns its cost.' }),
      trait({ trait_key: 'payday_burst', trait_type: 'behavioral', trait_value: 'Spends in bursts after payday.' }),
    ])

    expect(body.indexOf('How you behave with money')).toBeLessThan(body.indexOf('What you value'))
    expect(body).toContain('- Spends in bursts after payday.')
    expect(body).toContain('- Travel earns its cost.')
  })

  it('sorts by confidence, then by key, so the render is stable', () => {
    const traits = [
      trait({ trait_key: 'b_key', confidence: 0.7, trait_value: 'Second.' }),
      trait({ trait_key: 'a_key', confidence: 0.7, trait_value: 'First.' }),
      trait({ trait_key: 'z_key', confidence: 0.95, trait_value: 'Most certain.' }),
    ]

    const body = renderDigest('values', traits)
    expect(body.indexOf('Most certain.')).toBeLessThan(body.indexOf('First.'))
    expect(body.indexOf('First.')).toBeLessThan(body.indexOf('Second.'))

    // Reordering the input must not change a byte — an unstable render would
    // rewrite the file (and bust the prompt cache) on every portrait write.
    expect(renderDigest('values', [...traits].reverse())).toBe(body)
  })

  it('drops traits the system is not confident about', () => {
    const body = renderDigest('values', [
      trait({ trait_key: 'sure', confidence: 0.6, trait_value: 'Kept.' }),
      trait({ trait_key: 'unsure', confidence: 0.59, trait_value: 'Dropped.' }),
    ])

    expect(body).toContain('Kept.')
    expect(body).not.toContain('Dropped.')
  })

  it('files nothing for the trait types the cabinet is not for', () => {
    expect(
      renderDigest('values', [
        trait({ trait_key: 'archetype_x', trait_type: 'archetype', trait_value: 'The Provider.' }),
        trait({ trait_key: 'follow_up_1', trait_type: 'follow_up_suggestion', trait_value: 'Ask about the car.' }),
      ]),
    ).toBe('')

    // asset_profile rows are machine flags ('yes', 'under_10k') and figures a
    // structured tool owns — Net Worth deliberately has no digest.
    expect(
      renderDigest('networth', [
        trait({ trait_key: 'has_pension', trait_type: 'asset_profile', trait_value: 'yes', confidence: 1 }),
      ]),
    ).toBe('')
  })

  it('routes goal-flavoured traits to Goals whatever their type', () => {
    const traits = [
      trait({ trait_key: 'goal_commitment', trait_value: 'Commits hard, then drifts by month three.' }),
    ]

    expect(renderDigest('goals', traits)).toContain('Commits hard')
    expect(renderDigest('values', traits)).toBe('')
  })

  it('does not mistake a passing mention of a goal for a goal trait', () => {
    const traits = [trait({ trait_key: 'goalkeeper_hobby', trait_value: 'Plays in goal on Sundays.' })]

    expect(renderDigest('goals', traits)).toBe('')
    expect(renderDigest('values', traits)).toContain('Plays in goal')
  })

  it('returns nothing when there is nothing worth filing', () => {
    expect(renderDigest('values', [])).toBe('')
  })
})

describe('refreshMemoryDigests', () => {
  it('creates the digest and pins it', async () => {
    const client = clientWith([trait({ trait_key: 'payday_burst' })])

    await refreshMemoryDigests(client, USER)

    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    const [, , args, options] = mockWriteFile.mock.calls[0]
    expect(args.folder).toBe('values')
    expect(args.slug).toBe('patterns')
    expect(args.mode).toBe('create')
    expect(options?.actor).toBe('system')
    expect(mockSetFileFlags).toHaveBeenCalledWith(client, USER, 'file-1', { pinned: true })
  })

  it('rewrites an unedited digest when the portrait has moved', async () => {
    onlyFiled('values', filed({ content: 'Something older.' }))

    await refreshMemoryDigests(clientWith([trait({ trait_key: 'payday_burst' })]), USER)

    const [, , args] = mockWriteFile.mock.calls[0]
    expect(args.mode).toBe('replace')
    expect(args.content).toContain('Spends in bursts after payday.')
  })

  it('writes nothing when the render is unchanged', async () => {
    const traits = [trait({ trait_key: 'payday_burst' })]
    onlyFiled('values', filed({ content: renderDigest('values', traits) }))

    await refreshMemoryDigests(clientWith(traits), USER)

    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('never rewrites a digest the user has taken over', async () => {
    onlyFiled(
      'values',
      filed({ content: 'My own words.', user_edited_at: '2026-08-02T09:00:00.000Z' }),
    )

    // Nothing newer than the file — so nothing at all should happen.
    await refreshMemoryDigests(clientWith([trait({ trait_key: 'payday_burst' })]), USER)

    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('appends only what has landed since the user edited it', async () => {
    onlyFiled(
      'values',
      filed({ content: 'My own words.', user_edited_at: '2026-08-02T09:00:00.000Z' }),
    )

    await refreshMemoryDigests(
      clientWith([
        trait({ trait_key: 'old_one', trait_value: 'Known before the edit.' }),
        trait({
          trait_key: 'new_one',
          trait_value: 'Learned after the edit.',
          updated_at: '2026-08-09T09:00:00.000Z',
        }),
      ]),
      USER,
    )

    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    const [, , args] = mockWriteFile.mock.calls[0]
    expect(args.mode).toBe('append')
    expect(args.content).toContain('Since you edited this')
    expect(args.content).toContain('Learned after the edit.')
    expect(args.content).not.toContain('Known before the edit.')
  })

  it('leaves a digest standing when its last trait goes', async () => {
    onlyFiled('values', filed({ content: 'Something that was true.' }))

    await refreshMemoryDigests(clientWith([]), USER)

    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('swallows a failed portrait read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      refreshMemoryDigests(clientWith([], { message: 'boom' }), USER),
    ).resolves.toBeUndefined()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})

describe('recordTraitDismissal', () => {
  it('strikes the trait out on a digest the user has frozen', async () => {
    onlyFiled(
      'values',
      filed({ content: 'My own words.', user_edited_at: '2026-08-02T09:00:00.000Z' }),
    )

    await recordTraitDismissal(clientWith([]), USER, trait({
      trait_key: 'payday_burst',
      trait_value: 'Spends in bursts after payday.',
    }))

    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    const [, , args] = mockWriteFile.mock.calls[0]
    expect(args.folder).toBe('values')
    expect(args.mode).toBe('append')
    expect(args.content).toContain('Struck out')
    expect(args.content).toContain('Spends in bursts after payday.')
  })

  it('does not strike it out in a folder it was never in', async () => {
    onlyFiled(
      'cashflow',
      filed({
        folder: 'cashflow',
        content: 'My own words.',
        user_edited_at: '2026-08-02T09:00:00.000Z',
      }),
    )

    await recordTraitDismissal(clientWith([]), USER, trait({ trait_key: 'payday_burst' }))

    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('just re-renders when the digest is still the system’s', async () => {
    onlyFiled('values', filed({ content: 'Spends in bursts.' }))

    // The dismissed trait is already gone from the portrait, so the re-render
    // drops it — no retraction line needed, and none written.
    await recordTraitDismissal(
      clientWith([trait({ trait_key: 'other', trait_value: 'Still true.' })]),
      USER,
      trait({ trait_key: 'payday_burst' }),
    )

    const [, , args] = mockWriteFile.mock.calls[0]
    expect(args.mode).toBe('replace')
    expect(args.content).toContain('Still true.')
    expect(args.content).not.toContain('Struck out')
  })
})
