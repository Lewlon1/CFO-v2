import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fileComposedRead } from './documents'
import { getFile, writeFile } from './files'

// The data layer has its own (large) test suite; these tests are about what the
// filing hook adds on top of it — which mode it picks, what it strips, and its
// one hard promise: it never throws into a Read delivery path.
vi.mock('./files', () => ({
  getFile: vi.fn(),
  writeFile: vi.fn(),
}))

const mockGetFile = vi.mocked(getFile)
const mockWriteFile = vi.mocked(writeFile)

const client = {} as SupabaseClient
const USER = 'user-1'

function existingFile(present: boolean) {
  mockGetFile.mockResolvedValue({
    ok: true,
    value: present ? ({ slug: 'first-read' } as never) : null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteFile.mockResolvedValue({ ok: true, value: {} as never })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fileComposedRead', () => {
  it('creates the document on the first Read', async () => {
    existingFile(false)

    await fileComposedRead(client, USER, { content: 'Your money, read back.', variant: 'first_read' })

    expect(mockWriteFile).toHaveBeenCalledTimes(1)
    const [, userId, args, options] = mockWriteFile.mock.calls[0]
    expect(userId).toBe(USER)
    expect(args.folder).toBe('values')
    expect(args.slug).toBe('first-read')
    expect(args.mode).toBe('create')
    expect(args.title).toBe('Your first read')
    expect(args.content).toBe('Your money, read back.')
    expect(options?.actor).toBe('system')
  })

  it('appends a headed entry when the Read is rewritten', async () => {
    existingFile(true)

    await fileComposedRead(client, USER, {
      content: 'Now that you have sorted them…',
      variant: 'value_first_recompose',
    })

    const [, , args] = mockWriteFile.mock.calls[0]
    expect(args.mode).toBe('append')
    expect(args.content).toContain('Rewritten after your Value Map')
    expect(args.content).toContain('Now that you have sorted them…')
  })

  it('names the declared upgrade for what it is', async () => {
    existingFile(true)

    await fileComposedRead(client, USER, {
      content: 'Your statement says something else.',
      variant: 'declared_upgrade',
    })

    const [, , args] = mockWriteFile.mock.calls[0]
    expect(args.content).toContain('Rewritten against your real statement')
  })

  it('strips the chat-only chips block', async () => {
    existingFile(false)

    await fileComposedRead(client, USER, {
      content: 'The body.\n\n[OPTIONS]\n- Tell me more\n[/OPTIONS]',
      variant: 'first_read',
    })

    const [, , args] = mockWriteFile.mock.calls[0]
    expect(args.content).toBe('The body.')
  })

  it('writes nothing when the Read is empty once stripped', async () => {
    existingFile(false)

    await fileComposedRead(client, USER, {
      content: '[OPTIONS]\n- Tell me more\n[/OPTIONS]',
      variant: 'first_read',
    })

    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('swallows a refused write — a filing failure must not cost the Read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    existingFile(true)
    mockWriteFile.mockResolvedValue({ ok: false, error: 'The folder is full.' })

    await expect(
      fileComposedRead(client, USER, { content: 'A read.', variant: 'first_read' }),
    ).resolves.toBeUndefined()
  })

  it('swallows a thrown data-layer error too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetFile.mockRejectedValue(new Error('connection reset'))

    await expect(
      fileComposedRead(client, USER, { content: 'A read.', variant: 'first_read' }),
    ).resolves.toBeUndefined()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})
