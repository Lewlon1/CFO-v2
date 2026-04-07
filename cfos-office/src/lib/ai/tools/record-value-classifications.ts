import { z } from 'zod'
import type { ToolContext } from './types'
import { applyValueClassification } from '@/lib/categorisation/value-classification'

export function createRecordValueClassificationsTool(ctx: ToolContext) {
  return {
    description:
      'Save the user\'s value category decisions for reviewed transactions. ' +
      'YOU MUST CALL THIS TOOL whenever the user classifies a transaction or merchant — ' +
      'do NOT say "Saved", "Done", or "Got it" without calling this first. ' +
      'Confirm with the user what you understood (e.g. "Underground = Investment — saving that") ' +
      'then immediately call this tool. If the call fails, tell the user. ' +
      'Each classification triggers contextual learning — the system remembers ' +
      'not just WHAT the user chose, but the CONTEXT of the transaction. ' +
      'Include context_note when the user explains their reasoning.',
    inputSchema: z.object({
      classifications: z
        .array(
          z.object({
            transaction_id: z.string().describe('Transaction ID to classify'),
            value_category: z
              .enum(['foundation', 'investment', 'burden', 'leak'])
              .describe('The value category the user chose'),
            apply_to_similar: z
              .boolean()
              .optional()
              .describe(
                'Whether to propagate to similar unconfirmed transactions from the same merchant. Default: true.'
              ),
            context_note: z
              .string()
              .optional()
              .describe(
                'Optional user explanation, e.g. "solo delivery = leak, dinner with friends = investment"'
              ),
          })
        )
        .min(1)
        .max(25)
        .describe('Array of value classification decisions'),
    }),
    execute: async ({
      classifications,
    }: {
      classifications: Array<{
        transaction_id: string
        value_category: 'foundation' | 'investment' | 'burden' | 'leak'
        apply_to_similar?: boolean
        context_note?: string
      }>
    }) => {
      try {
        // Batch-fetch all referenced transactions
        const ids = classifications.map((c) => c.transaction_id)
        const { data: transactions, error } = await ctx.supabase
          .from('transactions')
          .select('id, description, date, amount, category_id')
          .eq('user_id', ctx.userId)
          .in('id', ids)

        if (error) {
          console.error('[tool:record_value_classifications] DB error:', error)
          return { error: 'Could not fetch transactions. Please try again.' }
        }

        if (!transactions || transactions.length === 0) {
          return { error: 'No matching transactions found for this user.' }
        }

        const txnMap = new Map(transactions.map((t) => [t.id, t]))

        let classified = 0
        let propagated = 0
        const merchantsLearned = new Set<string>()
        const errors: string[] = []

        for (const c of classifications) {
          const txn = txnMap.get(c.transaction_id)
          if (!txn) {
            errors.push(`Transaction ${c.transaction_id} not found`)
            continue
          }

          const result = await applyValueClassification(ctx.supabase, ctx.userId, {
            transactionId: c.transaction_id,
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

        const merchantList = [...merchantsLearned]
        const summary = buildSummary(classified, propagated, merchantList.length)

        return {
          classified,
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
  merchantCount: number
): string {
  const parts: string[] = []
  parts.push(
    `Classified ${classified} transaction${classified !== 1 ? 's' : ''}`
  )
  if (merchantCount > 1) {
    parts.push(`across ${merchantCount} merchants`)
  }
  if (propagated > 0) {
    parts.push(
      `Updated ${propagated} similar transaction${propagated !== 1 ? 's' : ''} automatically`
    )
  }
  return parts.join('. ') + '.'
}
