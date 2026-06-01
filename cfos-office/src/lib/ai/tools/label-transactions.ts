// cfos-office/src/lib/ai/tools/label-transactions.ts
//
// Dialogue tool: the centrepiece of the Dialogue-as-Moat architecture.
// When the LLM detects a category/merchant pattern with 2-3 plausible
// value-category reads, it calls this tool with a question and a set of
// transactions to walk through. The tool returns a render_directive — the
// frontend renders inline pills, the user labels each row, and the labels
// POST through /api/corrections/signal automatically. This tool does NOT
// capture labels itself; it just hydrates a display-ready payload.
//
// The 5 options (foundation / investment / leak / burden / unsure) are
// fixed. The LLM must pass all 5; an `unsure` quadrant is mandatory because
// it's the only honest answer when a transaction sits in autopilot.

import { z } from 'zod';
import type { ToolContext } from './types';
import { valueColors } from '@/lib/tokens';

// All 5 quadrants — required in input.options and emitted in the output
// options array in this exact order. Colours are canonical value-category
// tokens (theme-reactive var() strings from @/lib/tokens) — the LLM does not
// pick them and the block renders them straight into CSS.
const QUADRANT_IDS = [
  'foundation',
  'investment',
  'leak',
  'burden',
  'unsure',
] as const;
type QuadrantId = (typeof QUADRANT_IDS)[number];

interface QuadrantOption {
  id: QuadrantId;
  label: string;
  color: string;
  desc: string;
}

const OUTPUT_OPTIONS: QuadrantOption[] = [
  { id: 'foundation', label: 'Foundation', color: valueColors.foundation, desc: 'Essential' },
  { id: 'investment', label: 'Investment', color: valueColors.investment, desc: 'Worth it' },
  { id: 'leak', label: 'Leak', color: valueColors.leak, desc: 'Drains me' },
  { id: 'burden', label: 'Burden', color: valueColors.burden, desc: 'Heavy, stuck' },
  { id: 'unsure', label: 'Unsure', color: valueColors.unsure, desc: 'On autopilot' },
];

const inputSchema = z.object({
  question: z
    .string()
    .min(1)
    .describe(
      'The question the CFO asks the user. Renders as part of the chat message body, NOT inside the labelling block.',
    ),
  transactions: z
    .array(z.string().uuid())
    .min(1)
    .max(10)
    .describe(
      'Transaction IDs to label. Typically 3-7. Max 10 — beyond that the block becomes a chore.',
    ),
  label_type: z
    .enum(['value_category'])
    .default('value_category')
    .describe(
      'What the user labels each transaction with. Currently only value_category; future could add social_context, intent, etc.',
    ),
  options: z
    .array(z.enum(QUADRANT_IDS))
    .length(5)
    .describe(
      'REQUIRED: must include all 5 quadrants including unsure. The tool will reject if any are omitted.',
    ),
  context_hint: z
    .string()
    .optional()
    .describe(
      'Optional one-line context that appears in the block header, e.g. "Friday eating-out · last 3 weeks"',
    ),
});

export type LabelTransactionsInput = z.infer<typeof inputSchema>;

interface DbRow {
  id: string;
  date: string | null;
  description: string | null;
  amount: number | string;
  category_id: string | null;
}

interface HydratedTransaction {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string | null;
  time?: string;
}

export interface LabelTransactionsOutput {
  render_directive: 'label_transactions';
  directive_id: string;
  question: string;
  context_hint?: string;
  transactions: HydratedTransaction[];
  options: QuadrantOption[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// `transactions.date` is timestamptz (migration 021). When the ISO string
// carries a non-zero time-of-day, surface it as HH:MM so the labelling block
// can show "Fri 8 Mar · 23:14". If the time component is 00:00 (legacy rows
// imported as plain date), omit `time` entirely rather than print "00:00".
function extractTime(rawDate: string | null): string | undefined {
  if (!rawDate) return undefined;
  const t = new Date(rawDate);
  if (!Number.isFinite(t.getTime())) return undefined;
  const hours = t.getUTCHours();
  const minutes = t.getUTCMinutes();
  if (hours === 0 && minutes === 0) return undefined;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Render the date as YYYY-MM-DD regardless of whether the source is a date
// or a timestamptz string. The block formats it for display itself.
function toIsoDate(rawDate: string | null): string {
  if (!rawDate) return '';
  // Already in YYYY-MM-DD shape — pass through.
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;
  const t = new Date(rawDate);
  if (!Number.isFinite(t.getTime())) return rawDate.slice(0, 10);
  return t.toISOString().slice(0, 10);
}

export function createLabelTransactionsTool(ctx: ToolContext) {
  return {
    description:
      "Use when you've detected a category/merchant pattern that has 2-3 plausible value-category reads, and the user's answer would unblock real learning. Strong fit: multi-intent gap categories, recurring-merchant clusters with unclear value_category, follow-ups after the user expresses surprise at a finding. Don't use as small talk or to fill conversation space — only when learning is the genuine objective. Returns a render_directive the chat UI renders inline; the user's labels POST through /api/corrections/signal automatically (no further tool calls from you).",
    inputSchema,
    execute: async (input: LabelTransactionsInput) => {
      try {
        // Set-equality check: the zod .length(5) only catches length. The LLM
        // could still pass duplicates (e.g. four uniques + one repeat). The
        // valid input IS the full 5-quadrant set; anything else is invalid.
        const provided = new Set<QuadrantId>(input.options);
        const allFive = QUADRANT_IDS.every((q) => provided.has(q));
        if (!allFive || provided.size !== 5) {
          return {
            error:
              'options must be exactly the 5 quadrants: foundation, investment, leak, burden, unsure',
          };
        }

        // PostgREST builder chain — same `any` convention as sibling tools.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query: any = ctx.supabase
          .from('transactions')
          .select('id, description, amount, date, category_id')
          .eq('user_id', ctx.userId)
          .is('deleted_at', null)
          .in('id', input.transactions);

        const { data: rawRows, error } = (await query) as {
          data: DbRow[] | null;
          error: { message: string } | null;
        };

        if (error) {
          console.error('[tool:label_transactions] DB error:', error);
          return {
            error: 'Could not fetch transactions for labelling. Please try again.',
          };
        }

        const rows = rawRows ?? [];

        if (rows.length === 0) {
          return {
            error: 'None of the requested transactions were found or accessible',
          };
        }

        // If any requested IDs are missing from the result, log a warning
        // but proceed with what we have. Reasons this can happen: a
        // transaction got soft-deleted between the LLM seeing it and the
        // tool call, the LLM hallucinated an ID, or RLS hid one.
        if (rows.length < input.transactions.length) {
          const returnedIds = new Set(rows.map((r) => r.id));
          const missing = input.transactions.filter((id) => !returnedIds.has(id));
          console.warn(
            `[tool:label_transactions] Partial hydration: ${missing.length} of ${input.transactions.length} IDs missing`,
            { missing, userId: ctx.userId },
          );
        }

        // Preserve the LLM's requested order when possible so the block
        // mirrors what it told the user it would walk through.
        const byId = new Map<string, DbRow>(rows.map((r) => [r.id, r]));
        const orderedRows: DbRow[] = input.transactions
          .map((id) => byId.get(id))
          .filter((r): r is DbRow => r !== undefined);

        const transactions: HydratedTransaction[] = orderedRows.map((r) => {
          const time = extractTime(r.date);
          const hydrated: HydratedTransaction = {
            id: r.id,
            date: toIsoDate(r.date),
            merchant: r.description ?? '',
            amount: round2(Number(r.amount)),
            category: r.category_id ?? null,
          };
          if (time) hydrated.time = time;
          return hydrated;
        });

        const output: LabelTransactionsOutput = {
          render_directive: 'label_transactions',
          // Enables the frontend to dedupe re-renders and tag every
          // /api/corrections/signal POST with the source directive.
          directive_id: crypto.randomUUID(),
          question: input.question,
          transactions,
          options: OUTPUT_OPTIONS,
        };
        if (input.context_hint !== undefined) {
          output.context_hint = input.context_hint;
        }

        return output;
      } catch (err) {
        console.error('[tool:label_transactions] unexpected error:', err);
        return {
          error:
            'Something went wrong preparing the labelling block. Please try again.',
        };
      }
    },
  };
}
