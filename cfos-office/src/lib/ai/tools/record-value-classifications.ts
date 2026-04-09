import { z } from 'zod'
import type { ToolContext } from './types'
import { applyValueClassification } from '@/lib/categorisation/value-classification'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'

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
    context_conditions: z
      .object({
        hour_range: z
          .object({ from: z.number().min(0).max(23), to: z.number().min(0).max(23) })
          .optional()
          .describe(
            'Hour-of-day window when this rule applies. Wraps midnight, e.g. {from:18,to:24} = "6pm onwards".'
          ),
        day_type: z
          .enum(['weekday', 'weekend', 'friday_evening'])
          .optional(),
        amount_range: z
          .object({ min: z.number().optional(), max: z.number().optional() })
          .optional(),
      })
      .optional()
      .describe(
        'Explicit context for when this rule applies. ONLY use with merchant_pattern when the user states a contextual rule like "Aldi after 6pm = leak".'
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

export function createRecordValueClassificationsTool(ctx: ToolContext) {
  return {
    description:
      'Save the user\'s value category decisions. YOU MUST CALL THIS TOOL whenever the user ' +
      'classifies a transaction or states a merchant rule — do NOT say "Saved", "Done", or ' +
      '"Got it" without calling this first.\n\n' +
      'TWO MODES:\n' +
      '1. Specific transaction: pass `transaction_id` (a real UUID from the review queue or ' +
      'context). Use when the user is reviewing one transaction.\n' +
      '2. Merchant rule: pass `merchant_pattern` (e.g. "Aldi") plus optional `context_conditions` ' +
      '(e.g. hour_range). Use when the user states a general rule like "Aldi after 6pm = leak". ' +
      'NEVER fabricate a transaction_id like "UNKNOWN" — use merchant_pattern instead.\n\n' +
      'For contextual rules ("Aldi after 6pm = leak, before 6pm = foundation"), call this tool ' +
      'TWICE — once with hour_range {from:18,to:24} and category=leak, once with ' +
      'hour_range {from:0,to:18} and category=foundation.',
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

        // Split into the two modes
        const transactionMode = classifications.filter(
          (c) => c.transaction_id && UUID_RE.test(c.transaction_id)
        )
        const merchantMode = classifications.filter((c) => c.merchant_pattern)
        const invalid = classifications.filter(
          (c) =>
            (c.transaction_id && !UUID_RE.test(c.transaction_id)) ||
            (!c.transaction_id && !c.merchant_pattern)
        )

        for (const c of invalid) {
          errors.push(
            c.transaction_id
              ? `Invalid transaction_id "${c.transaction_id}" — use merchant_pattern for general rules`
              : 'Classification missing both transaction_id and merchant_pattern'
          )
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
          const conditions =
            c.context_conditions && Object.keys(c.context_conditions).length > 0
              ? c.context_conditions
              : null

          const { error: ruleErr } = await ctx.supabase
            .from('value_category_rules')
            .upsert(
              {
                user_id: ctx.userId,
                match_type: 'merchant_contains',
                match_value: normDesc,
                value_category: c.value_category,
                confidence: 0.9,
                source: conditions ? 'user_contextual_rule' : 'user_explicit',
                context_conditions: conditions,
              },
              { onConflict: 'user_id,match_type,match_value' }
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
