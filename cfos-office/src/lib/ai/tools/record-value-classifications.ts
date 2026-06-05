import { z } from 'zod'
import type { ToolContext } from './types'
import { applyValueClassification } from '@/lib/categorisation/value-classification'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { VCR_ON_CONFLICT, NONE_TIME_CONTEXT } from '@/lib/prediction/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const classificationSchema = z
  .object({
    transaction_id: z
      .string()
      .optional()
      .describe(
        'Specific transaction UUID to classify. Use this when the user is reviewing a specific transaction from their queue. Omit when the user is stating a general merchant rule.'
      ),
    merchant_pattern: z
      .string()
      .optional()
      .describe(
        'Merchant name to create a rule for (e.g. "Aldi", "Uber"). Use this when the user states a general rule about a merchant rather than classifying one specific transaction. Mutually exclusive with transaction_id.'
      ),
    value_category: z
      .enum(['foundation', 'investment', 'burden', 'leak'])
      .describe('The value category the user chose'),
    time_context: z
      .enum([
        'weekday_early', 'weekday_midday', 'weekday_evening', 'weekday_late',
        'weekend_morning', 'weekend_afternoon', 'weekend_evening',
      ])
      .optional()
      .describe(
        'Time context bucket for when this rule applies. ONLY use with merchant_pattern when the user states a contextual rule like "Aldi in the evening = leak". Map user language to the closest bucket.'
      ),
    apply_to_similar: z
      .boolean()
      .optional()
      .describe(
        'Whether to propagate to similar unconfirmed transactions from the same merchant. Default: true. Only meaningful with transaction_id.'
      ),
    context_note: z
      .string()
      .optional()
      .describe(
        'Optional user explanation, e.g. "solo delivery = leak, dinner with friends = investment"'
      ),
  })
  .refine(
    (c) => Boolean(c.transaction_id) !== Boolean(c.merchant_pattern),
    {
      message:
        'Provide exactly one of transaction_id (for a specific transaction) or merchant_pattern (for a general rule)',
    }
  )

type Classification = z.infer<typeof classificationSchema>

/**
 * Split classifications into transaction-id mode, merchant-rule mode, and
 * unrecoverable. Pure (no I/O) so it can be unit-tested.
 *
 * Recovery: first_read narratives name merchants, not transaction rows, so the
 * model frequently lacks a real UUID and crams a merchant name into
 * transaction_id. Rather than erroring ("couldn't be saved"), a non-UUID
 * transaction_id with no merchant_pattern is treated as a merchant_pattern.
 */
export function partitionClassifications(classifications: Classification[]): {
  transactionMode: Classification[]
  merchantMode: Classification[]
  unrecoverable: Classification[]
} {
  const transactionMode = classifications.filter(
    (c) => c.transaction_id && UUID_RE.test(c.transaction_id)
  )

  const merchantMode = classifications
    .filter((c) => !(c.transaction_id && UUID_RE.test(c.transaction_id)))
    .map((c) => {
      if (c.merchant_pattern) return c
      const candidate = c.transaction_id?.trim()
      if (candidate && !UUID_RE.test(candidate)) {
        return { ...c, merchant_pattern: candidate, transaction_id: undefined }
      }
      return c
    })
    .filter((c) => Boolean(c.merchant_pattern))

  const unrecoverable = classifications.filter(
    (c) =>
      !(c.transaction_id && UUID_RE.test(c.transaction_id)) &&
      !c.merchant_pattern &&
      !c.transaction_id?.trim()
  )

  return { transactionMode, merchantMode, unrecoverable }
}

export function createRecordValueClassificationsTool(ctx: ToolContext) {
  return {
    description:
      'Save the user\'s value category decisions. YOU MUST CALL THIS TOOL whenever the user ' +
      'classifies a transaction or states a merchant rule — do NOT say "Saved", "Done", or ' +
      '"Got it" without calling this first.\n\n' +
      'TWO MODES:\n' +
      '1. Specific transaction: pass `transaction_id` (a real UUID from the review queue or ' +
      'context). Use ONLY when you have a real transaction UUID in front of you.\n' +
      '2. Merchant rule: pass `merchant_pattern` (e.g. "Aldi") plus optional `time_context` ' +
      '(e.g. "weekday_evening"). This is the DEFAULT for the first read and any time you are ' +
      'classifying by merchant name (e.g. "Claude.ai is investment"): you almost never have a ' +
      'real UUID there, so pass the merchant name as `merchant_pattern`. ' +
      'NEVER fabricate or guess a transaction_id — use merchant_pattern instead.\n\n' +
      'For contextual rules ("Aldi in the evening = leak, daytime = foundation"), call this tool ' +
      'TWICE — once with time_context="weekday_evening" and category=leak, once with ' +
      'time_context="weekday_midday" and category=foundation.',
    inputSchema: z.object({
      classifications: z
        .array(classificationSchema)
        .min(1)
        .max(25)
        .describe('Array of value classification decisions'),
    }),
    execute: async ({ classifications }: { classifications: Classification[] }) => {
      try {
        let classified = 0
        let propagated = 0
        let merchantRulesCreated = 0
        const merchantsLearned = new Set<string>()
        const errors: string[] = []

        // Split into modes, recovering merchant-rule items from non-UUID
        // transaction_ids (see partitionClassifications).
        const { transactionMode, merchantMode, unrecoverable } =
          partitionClassifications(classifications)

        for (const c of unrecoverable) {
          void c
          errors.push('Classification missing both transaction_id and merchant_pattern')
        }

        // ── Mode 1: specific transactions ──
        if (transactionMode.length > 0) {
          const ids = transactionMode.map((c) => c.transaction_id!) as string[]
          const { data: transactions, error } = await ctx.supabase
            .from('transactions')
            .select('id, description, date, amount, category_id')
            .eq('user_id', ctx.userId)
            .in('id', ids)

          if (error) {
            console.error('[tool:record_value_classifications] DB error:', error)
            return { error: 'Could not fetch transactions. Please try again.' }
          }

          const txnMap = new Map((transactions ?? []).map((t) => [t.id, t]))

          for (const c of transactionMode) {
            const txn = txnMap.get(c.transaction_id!)
            if (!txn) {
              errors.push(`Transaction ${c.transaction_id} not found`)
              continue
            }

            const result = await applyValueClassification(ctx.supabase, ctx.userId, {
              transactionId: c.transaction_id!,
              newValue: c.value_category,
              applyToSimilar: c.apply_to_similar ?? true,
              description: txn.description,
              date: txn.date,
              amount: txn.amount,
              categoryId: txn.category_id,
              contextNote: c.context_note,
            })

            if (result.ok) {
              classified++
              propagated += result.propagatedCount
              merchantsLearned.add(txn.description)
            } else {
              errors.push(`Failed to classify ${c.transaction_id}: ${result.error}`)
            }
          }
        }

        // ── Mode 2: merchant-level rules ──
        for (const c of merchantMode) {
          const normDesc = normaliseMerchant(c.merchant_pattern!)
          const { error: ruleErr } = await ctx.supabase
            .from('value_category_rules')
            .upsert(
              {
                user_id: ctx.userId,
                match_type: c.time_context ? 'merchant_time' as const : 'merchant' as const,
                match_value: normDesc,
                value_category: c.value_category,
                confidence: 0.9,
                time_context: c.time_context ?? NONE_TIME_CONTEXT,
                source: 'correction',
                last_signal_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              { onConflict: VCR_ON_CONFLICT }
            )

          if (ruleErr) {
            errors.push(`Failed to save rule for ${c.merchant_pattern}: ${ruleErr.message}`)
            continue
          }

          merchantRulesCreated++
          merchantsLearned.add(c.merchant_pattern!)

          // Also propagate the value to existing unconfirmed transactions if requested
          if (c.apply_to_similar !== false) {
            const { data: propagatedRows } = await ctx.supabase
              .from('transactions')
              .update({ value_category: c.value_category, value_confidence: 0.8 })
              .eq('user_id', ctx.userId)
              .eq('value_confirmed_by_user', false)
              .ilike('description', `%${normDesc}%`)
              .select('id')

            propagated += propagatedRows?.length ?? 0
          }
        }

        const merchantList = [...merchantsLearned]
        const summary = buildSummary(
          classified,
          propagated,
          merchantList.length,
          merchantRulesCreated
        )

        return {
          // Explicit, unambiguous signal for the chat route's hallucination
          // recovery and for the model: did anything actually persist?
          success: classified + merchantRulesCreated > 0,
          classified,
          merchant_rules_created: merchantRulesCreated,
          propagated,
          merchants_learned: merchantList,
          summary,
          ...(errors.length > 0 ? { errors } : {}),
        }
      } catch (err) {
        console.error('[tool:record_value_classifications] unexpected error:', err)
        return {
          error: 'Something went wrong saving classifications. Please try again.',
        }
      }
    },
  }
}

function buildSummary(
  classified: number,
  propagated: number,
  merchantCount: number,
  merchantRulesCreated: number
): string {
  const parts: string[] = []
  if (classified > 0) {
    parts.push(`Classified ${classified} transaction${classified !== 1 ? 's' : ''}`)
  }
  if (merchantRulesCreated > 0) {
    parts.push(
      `Saved ${merchantRulesCreated} merchant rule${merchantRulesCreated !== 1 ? 's' : ''}`
    )
  }
  if (merchantCount > 1) {
    parts.push(`across ${merchantCount} merchants`)
  }
  if (propagated > 0) {
    parts.push(
      `Updated ${propagated} similar transaction${propagated !== 1 ? 's' : ''} automatically`
    )
  }
  return parts.length > 0 ? parts.join('. ') + '.' : 'Nothing was saved.'
}
