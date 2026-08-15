import { z } from 'zod';
import type { ToolContext } from './types';
import { getFile, listFolder } from '@/lib/memory/files';
import { MEMORY_FOLDER_LABELS, type MemoryFolder } from '@/lib/memory/constants';

const FOLDER_ENUM = z.enum(['goals', 'cashflow', 'values', 'networth']);

/**
 * The Filing Cabinet — read side.
 *
 * The system prompt carries only the index (one line per file). This is how the
 * CFO gets an actual body. Omitting `slug` lists a folder, which matters when
 * the index has been truncated by its per-folder cap.
 *
 * Uses ctx.supabase (the user-authenticated client), so RLS is the real
 * boundary rather than the userId filter alone.
 */
export function createReadMemoryFileTool(ctx: ToolContext) {
  return {
    description:
      "Read one of your files on this user. Files hold durable narrative knowledge you have written down — their situation, plans, decisions and the reasoning behind them. Pass folder + slug to read a file in full; pass folder alone to list what is in it. Read before advising on a topic that has a file, so you build on what you already know instead of asking again. Files never hold current figures — call the data tools for those.",
    inputSchema: z.object({
      folder: FOLDER_ENUM.describe('Which folder to read from.'),
      slug: z
        .string()
        .optional()
        .describe('The file to read, as shown in the index. Omit to list the folder instead.'),
    }),
    execute: async ({ folder, slug }: { folder: MemoryFolder; slug?: string }) => {
      try {
        if (!slug) {
          const listed = await listFolder(ctx.supabase, ctx.userId, folder);
          if (!listed.ok) return { error: listed.error };
          return {
            folder,
            folder_label: MEMORY_FOLDER_LABELS[folder],
            files: listed.value.map((f) => ({
              slug: f.slug,
              title: f.title,
              description: f.description,
              updated_at: f.updated_at,
              pinned: f.pinned,
              edited_by_user: f.user_edited_at !== null,
            })),
          };
        }

        const found = await getFile(ctx.supabase, ctx.userId, folder, slug);
        if (!found.ok) return { error: found.error };
        if (!found.value) {
          return {
            error: `There is no file at ${folder}/${slug}. List the folder (omit the slug) to see what exists.`,
          };
        }

        const file = found.value;
        return {
          folder,
          slug: file.slug,
          title: file.title,
          description: file.description,
          content: file.content,
          updated_at: file.updated_at,
          edited_by_user: file.user_edited_at !== null,
          // Two standing reminders, returned with every body because they are
          // what stops the file being misused: the user's own edits outrank
          // anything the CFO wrote, and prose in a file is never a live figure.
          note: file.user_edited_at
            ? 'The user edited this file. Their words are authoritative — do not contradict or rewrite them. Any figures here are historical; call a data tool for current numbers.'
            : 'Any figures here are historical context, not current values — call a data tool for current numbers.',
        };
      } catch (err) {
        console.error('[tool:read_memory_file] error:', err);
        return { error: 'Could not read that file.' };
      }
    },
  };
}
