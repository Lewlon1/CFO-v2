import { z } from 'zod';
import type { ToolContext } from './types';
import { listFolder, writeFile } from '@/lib/memory/files';
import {
  MAX_CONTENT_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_TITLE_CHARS,
  type MemoryFolder,
} from '@/lib/memory/constants';

const FOLDER_ENUM = z.enum(['goals', 'cashflow', 'values', 'networth']);
const MODE_ENUM = z.enum(['create', 'append', 'replace']);

/**
 * The Filing Cabinet — write side.
 *
 * Durable narrative knowledge only. Structured facts belong in the tools that
 * own them (create_goal, upsert_asset, update_user_profile, …); a file holds the
 * story around a fact, never the fact itself, and never a figure presented as
 * current.
 *
 * The data layer enforces the rules that matter — folder caps, size caps, and
 * the refusal to overwrite anything the user has edited. This tool's job is to
 * make those refusals legible to the model and to hand back the folder listing
 * so it can see the result of its own write.
 */
export function createWriteMemoryFileTool(ctx: ToolContext) {
  return {
    description:
      "Write to one of your files on this user. Use for durable narrative knowledge: their situation, plans, decisions and the reasoning behind them, and preferences with their nuance. Do NOT use it for figures presented as current, or for anything a structured tool owns (goals, assets, liabilities, bills, profile fields) — call that tool instead; a file may hold the story around such a fact but not the fact itself. mode 'create' starts a file (needs title + description), 'append' adds a dated entry to one that exists, 'replace' rewrites it. Prefer append: it keeps the history. Write when something durable is shared or decided, not every turn.",
    inputSchema: z.object({
      folder: FOLDER_ENUM.describe(
        'Which folder this belongs in. Personal and life context goes in values.',
      ),
      mode: MODE_ENUM.describe(
        "'create' for a new file, 'append' to add a dated entry, 'replace' to rewrite.",
      ),
      slug: z
        .string()
        .optional()
        .describe(
          "Required for append and replace — the file's slug from the index. On create, derived from the title when omitted.",
        ),
      title: z
        .string()
        .max(MAX_TITLE_CHARS)
        .optional()
        .describe('Required on create. A short human title — the user sees this.'),
      description: z
        .string()
        .max(MAX_DESCRIPTION_CHARS)
        .optional()
        .describe(
          'Required on create. One line, and the only thing about this file you will see in future conversations — write it so it earns a re-read.',
        ),
      content: z
        .string()
        .max(MAX_CONTENT_CHARS)
        .describe(
          'The prose to write. On append, just the new entry — the date header is added for you.',
        ),
    }),
    execute: async (args: {
      folder: MemoryFolder;
      mode: 'create' | 'append' | 'replace';
      slug?: string;
      title?: string;
      description?: string;
      content: string;
    }) => {
      try {
        const written = await writeFile(ctx.supabase, ctx.userId, args);
        if (!written.ok) return { error: written.error };

        const file = written.value;
        // Hand back the folder as it now stands: the model writes mid-turn and
        // otherwise has no way to see what its own write did to the index.
        const listed = await listFolder(ctx.supabase, ctx.userId, args.folder);

        return {
          saved: true,
          folder: args.folder,
          slug: file.slug,
          title: file.title,
          mode: args.mode,
          folder_contents: listed.ok
            ? listed.value.map((f) => ({ slug: f.slug, description: f.description }))
            : undefined,
          note: "Tell the user plainly that you have noted this, in your own voice — say it is in their files, never name the tool or the slug.",
        };
      } catch (err) {
        console.error('[tool:write_memory_file] error:', err);
        return { error: 'Could not save that file.' };
      }
    },
  };
}
