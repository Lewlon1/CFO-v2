import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from './types';
import { createReadMemoryFileTool } from './read-memory-file';
import { createWriteMemoryFileTool } from './write-memory-file';
import { createArchiveMemoryFileTool } from './archive-memory-file';

// The data layer's own behaviour (caps, revisions, the user-edit refusal) is
// covered in src/lib/memory/files.test.ts against an in-memory table. These
// tests are about the adapter: what the model is handed back, and whether a
// layer error reaches it as { error } instead of a thrown turn.
vi.mock('@/lib/memory/files', () => ({
  getFile: vi.fn(),
  listFolder: vi.fn(),
  writeFile: vi.fn(),
  archiveFile: vi.fn(),
}));

import { getFile, listFolder, writeFile, archiveFile } from '@/lib/memory/files';

const ctx: ToolContext = {
  supabase: {} as SupabaseClient,
  userId: 'user-1',
  conversationId: 'conv-1',
  currency: 'EUR',
};

const FILE = {
  id: 'f1',
  folder: 'goals' as const,
  slug: 'house-deposit-plan',
  title: 'House deposit plan',
  description: 'Saving €40k by 2028; tension with the wedding fund',
  content: 'They want €40k down by spring 2028.',
  updated_at: '2026-08-12T09:00:00.000Z',
  created_at: '2026-06-01T09:00:00.000Z',
  archived_at: null,
  pinned: false,
  source: 'cfo' as const,
  updated_by: 'cfo' as const,
  user_edited_at: null as string | null,
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('read_memory_file', () => {
  it('returns the body and warns that figures in it are historical', async () => {
    vi.mocked(getFile).mockResolvedValue({ ok: true, value: FILE });

    const result = await createReadMemoryFileTool(ctx).execute({
      folder: 'goals',
      slug: 'house-deposit-plan',
    });

    expect(result).toMatchObject({
      slug: 'house-deposit-plan',
      content: 'They want €40k down by spring 2028.',
      edited_by_user: false,
    });
    expect(result.note).toContain('historical');
  });

  it('flags a user-edited file as authoritative', async () => {
    vi.mocked(getFile).mockResolvedValue({
      ok: true,
      value: { ...FILE, user_edited_at: '2026-08-11T10:00:00.000Z' },
    });

    const result = await createReadMemoryFileTool(ctx).execute({
      folder: 'goals',
      slug: 'house-deposit-plan',
    });

    expect(result.edited_by_user).toBe(true);
    expect(result.note).toContain('authoritative');
    expect(result.note).toMatch(/do not contradict or rewrite/i);
  });

  it('lists the folder when no slug is given, without bodies', async () => {
    vi.mocked(listFolder).mockResolvedValue({ ok: true, value: [FILE] });

    const result = await createReadMemoryFileTool(ctx).execute({ folder: 'goals' });

    expect(result.files).toHaveLength(1);
    expect(result.files?.[0]).toEqual({
      slug: 'house-deposit-plan',
      title: 'House deposit plan',
      description: 'Saving €40k by 2028; tension with the wedding fund',
      updated_at: '2026-08-12T09:00:00.000Z',
      pinned: false,
      edited_by_user: false,
    });
    // The whole point of the index is not paying for bodies.
    expect(JSON.stringify(result)).not.toContain('spring 2028');
  });

  it('tells the model how to recover when the file is absent', async () => {
    vi.mocked(getFile).mockResolvedValue({ ok: true, value: null });

    const result = await createReadMemoryFileTool(ctx).execute({
      folder: 'goals',
      slug: 'nope',
    });

    expect(result.error).toContain('goals/nope');
    expect(result.error).toMatch(/list the folder/i);
  });

  it('surfaces a layer error rather than throwing', async () => {
    vi.mocked(getFile).mockResolvedValue({ ok: false, error: 'Could not read goals/x.' });

    const result = await createReadMemoryFileTool(ctx).execute({ folder: 'goals', slug: 'x' });

    expect(result).toEqual({ error: 'Could not read goals/x.' });
  });

  it('returns an error object when the layer throws', async () => {
    vi.mocked(getFile).mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await createReadMemoryFileTool(ctx).execute({ folder: 'goals', slug: 'x' });

    expect(result).toEqual({ error: 'Could not read that file.' });
  });
});

describe('write_memory_file', () => {
  it('hands back the folder as it now stands after the write', async () => {
    vi.mocked(writeFile).mockResolvedValue({ ok: true, value: FILE });
    vi.mocked(listFolder).mockResolvedValue({ ok: true, value: [FILE] });

    const result = await createWriteMemoryFileTool(ctx).execute({
      folder: 'goals',
      mode: 'create',
      title: 'House deposit plan',
      description: 'Saving €40k by 2028',
      content: 'They want €40k down by spring 2028.',
    });

    expect(result).toMatchObject({ saved: true, slug: 'house-deposit-plan', mode: 'create' });
    expect(result.folder_contents).toEqual([
      { slug: 'house-deposit-plan', description: 'Saving €40k by 2028; tension with the wedding fund' },
    ]);
  });

  it('still reports the save when the follow-up listing fails', async () => {
    vi.mocked(writeFile).mockResolvedValue({ ok: true, value: FILE });
    vi.mocked(listFolder).mockResolvedValue({ ok: false, error: 'Could not read the goals folder.' });

    const result = await createWriteMemoryFileTool(ctx).execute({
      folder: 'goals',
      mode: 'append',
      slug: 'house-deposit-plan',
      content: 'They pushed the date back a year.',
    });

    expect(result.saved).toBe(true);
    expect(result.folder_contents).toBeUndefined();
  });

  it('passes the user-edit refusal straight through to the model', async () => {
    vi.mocked(writeFile).mockResolvedValue({
      ok: false,
      error:
        "You cannot replace goals/house-deposit-plan — the user has edited this file and their words are authoritative. Use mode 'append' to add to it instead.",
    });

    const result = await createWriteMemoryFileTool(ctx).execute({
      folder: 'goals',
      mode: 'replace',
      slug: 'house-deposit-plan',
      content: 'Rewritten.',
    });

    expect(result.error).toMatch(/authoritative/);
    expect(result.saved).toBeUndefined();
    expect(listFolder).not.toHaveBeenCalled();
  });
});

describe('archive_memory_file', () => {
  it('reports a soft archive', async () => {
    vi.mocked(archiveFile).mockResolvedValue({
      ok: true,
      value: { folder: 'values', slug: 'old-note', alreadyArchived: false },
    });

    const result = await createArchiveMemoryFileTool(ctx).execute({
      folder: 'values',
      slug: 'old-note',
    });

    expect(result).toEqual({
      archived: true,
      folder: 'values',
      slug: 'old-note',
      already_archived: false,
    });
  });

  it('surfaces a missing file as an error', async () => {
    vi.mocked(archiveFile).mockResolvedValue({
      ok: false,
      error: 'There is no file at values/ghost.',
    });

    const result = await createArchiveMemoryFileTool(ctx).execute({
      folder: 'values',
      slug: 'ghost',
    });

    expect(result).toEqual({ error: 'There is no file at values/ghost.' });
  });
});
