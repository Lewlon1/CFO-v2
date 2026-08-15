import { z } from 'zod';
import type { ToolContext } from './types';
import { archiveFile } from '@/lib/memory/files';
import type { MemoryFolder } from '@/lib/memory/constants';

const FOLDER_ENUM = z.enum(['goals', 'cashflow', 'values', 'networth']);

/**
 * The Filing Cabinet — archive.
 *
 * Soft only: the file drops out of listings, the prompt index and the per-folder
 * cap, but survives for export and for the user to restore from the office UI.
 * Nothing here can destroy the user's data.
 */
export function createArchiveMemoryFileTool(ctx: ToolContext) {
  return {
    description:
      'Archive one of your files on this user when it is out of date or no longer true. The file leaves your index but the user can still see and restore it. Confirm with the user before archiving anything — it is their filing cabinet. To correct a file rather than retire it, write to it instead.',
    inputSchema: z.object({
      folder: FOLDER_ENUM.describe('Which folder the file is in.'),
      slug: z.string().describe("The file's slug, as shown in the index."),
      reason: z
        .string()
        .optional()
        .describe('Why it is being retired — for your own note back to the user.'),
    }),
    execute: async ({ folder, slug }: { folder: MemoryFolder; slug: string; reason?: string }) => {
      try {
        const archived = await archiveFile(ctx.supabase, ctx.userId, folder, slug);
        if (!archived.ok) return { error: archived.error };

        return {
          archived: true,
          folder,
          slug,
          already_archived: archived.value.alreadyArchived,
        };
      } catch (err) {
        console.error('[tool:archive_memory_file] error:', err);
        return { error: 'Could not archive that file.' };
      }
    },
  };
}
