import { z } from 'zod'
import type { ToolContext } from './types'
import { ACTION_TYPES, type ActionType } from '@/lib/actions/types'

/**
 * Structured action emission. The model uses this in place of the old
 * `<ACTION:start_value_map>` text-token mechanism. Each call:
 *
 *   - May trigger a server-side side effect (e.g. flip an offered-in-chat
 *     ratchet).
 *   - Always returns a JSON-serialisable `{ type, metadata, emitted_at }`
 *     object, which extractMessageAudit folds into actionsCreated and the
 *     chat route persists to messages.actions_created.
 */
export function createEmitActionTool(ctx: ToolContext) {
  return {
    description:
      "Emit a structured action that affects the user interface. Call this when you have decided the next step is a concrete action — for example, offering the Value Map exercise, or asking the user to upload a statement. Do NOT describe the call to the user; the call is internal plumbing. Available types: 'start_value_map' (offers the Value Map exercise), 'upload_statement' (prompts upload), 'open_folder' (placeholder for future folder routing).",
    inputSchema: z.object({
      type: z.enum(ACTION_TYPES),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Optional metadata payload — depends on the action type.'),
    }),
    execute: async ({
      type,
      metadata,
    }: {
      type: ActionType
      metadata?: Record<string, unknown>
    }) => {
      try {
        if (type === 'start_value_map') {
          // Idempotent ratchet: only flips when currently false. The chat
          // route reads value_map_offered_in_chat next turn.
          await ctx.supabase
            .from('user_profiles')
            .update({ value_map_offered_in_chat: true })
            .eq('id', ctx.userId)
            .eq('value_map_offered_in_chat', false)
        }

        // upload_statement / open_folder: no server-side side effect today;
        // they're pure UI directives the frontend renders or routes on.

        return {
          success: true,
          type,
          metadata: metadata ?? null,
          emitted_at: new Date().toISOString(),
        }
      } catch (err) {
        console.error('[tool:emit_action] unexpected error:', err)
        return { error: 'Could not emit action.' }
      }
    },
  }
}
