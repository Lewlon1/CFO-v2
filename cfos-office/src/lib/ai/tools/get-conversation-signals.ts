import { z } from 'zod';
import type { ToolContext } from './types';
import { createServiceClient } from '@/lib/supabase/service';

const SIGNAL_TYPE_ENUM = z.enum([
  'regret',
  'enjoyment',
  'context_person',
  'context_event',
  'context_situation',
]);

/**
 * Layer 4 — Conversational signals about the user's spending.
 *
 * Returns previously-extracted signals (regret, enjoyment, who/event/situation
 * context) from the user's prior chat. Use when about to make an observation
 * about a merchant or category to recall what the user has already said about it.
 *
 * Reads chat_signals via service-role to bypass RLS (RLS allows users to read
 * their own rows, but the chat route runs under a user-authenticated client
 * already; service-role is simpler and equivalent here since we filter by userId).
 */
export function createGetConversationSignalsTool(ctx: ToolContext) {
  return {
    description:
      "Get signals extracted from previous chat conversations about the user's spending. Returns signals like regret, enjoyment, and context (who they were with, what occasion, what situation). Use when discussing a specific merchant or category to recall what the user has said about it before. Cite verbatim phrases when referencing prior chat — e.g. 'you mentioned regretting Deliveroo two weeks ago'. Do not invent signals.",
    inputSchema: z.object({
      target_merchant: z
        .string()
        .optional()
        .describe('Filter to signals attributed to this merchant.'),
      target_category: z
        .string()
        .optional()
        .describe('Filter to signals attributed to this category slug.'),
      signal_types: z
        .array(SIGNAL_TYPE_ENUM)
        .optional()
        .describe('Optional filter by signal types.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('Max number of signals to return. Default 10, most recent first.'),
    }),
    execute: async ({
      target_merchant,
      target_category,
      signal_types,
      limit,
    }: {
      target_merchant?: string;
      target_category?: string;
      signal_types?: Array<z.infer<typeof SIGNAL_TYPE_ENUM>>;
      limit?: number;
    }) => {
      try {
        const supabase = createServiceClient();
        let q = supabase
          .from('chat_signals')
          .select('signal_type, target_merchant, target_category, marker_phrase, confidence, extraction_method, created_at')
          .eq('user_id', ctx.userId)
          .order('created_at', { ascending: false })
          .limit(limit ?? 10);

        if (target_merchant) q = q.eq('target_merchant', target_merchant);
        if (target_category) q = q.eq('target_category', target_category);
        if (signal_types && signal_types.length > 0) q = q.in('signal_type', signal_types);

        const { data, error } = await q;
        if (error) {
          console.error('[tool:get_conversation_signals] query error:', error);
          return { error: 'Could not load prior conversation signals.' };
        }
        return { signals: data ?? [] };
      } catch (err) {
        console.error('[tool:get_conversation_signals] error:', err);
        return { error: 'Could not load prior conversation signals.' };
      }
    },
  };
}
