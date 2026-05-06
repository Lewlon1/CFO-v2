import { z } from 'zod'
import type { ToolContext } from './types'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createDeleteValueRuleTool(ctx: ToolContext) {
  return {
    description:
      'Delete a saved value category rule. Use this when the user says a rule is wrong, ' +
      'should be removed, or is misclassifying transactions (e.g. "stop tagging Aldi as a leak", ' +
      '"that rule is wrong", "delete my Aldi rule"). Pass either rule_id (if known from ' +
      'context) or merchant_pattern (the merchant name the user mentions). Does NOT ' +
      'touch existing transactions — only removes the rule so future transactions stop ' +
      'being auto-categorised by it. Always confirm with the user before calling.',
    inputSchema: z
      .object({
        rule_id: z
          .string()
          .optional()
          .describe('Specific rule UUID, if known from prior context.'),
        merchant_pattern: z
          .string()
          .optional()
          .describe(
            'Merchant name to delete the rule for (e.g. "Aldi"). Will be normalised the ' +
              'same way rules are stored.'
          ),
      })
      .refine((v) => Boolean(v.rule_id) !== Boolean(v.merchant_pattern), {
        message: 'Provide exactly one of rule_id or merchant_pattern',
      }),
    execute: async ({
      rule_id,
      merchant_pattern,
    }: {
      rule_id?: string
      merchant_pattern?: string
    }) => {
      try {
        if (rule_id && !UUID_RE.test(rule_id)) {
          return { error: `Invalid rule_id "${rule_id}" — must be a UUID.` }
        }

        let query = ctx.supabase
          .from('value_category_rules')
          .delete()
          .eq('user_id', ctx.userId)

        if (rule_id) {
          query = query.eq('id', rule_id)
        } else {
          const normDesc = normaliseMerchant(merchant_pattern!)
          if (!normDesc) {
            return { error: 'Merchant pattern could not be normalised.' }
          }
          query = query.eq('match_type', 'merchant').eq('match_value', normDesc)
        }

        const { data: deleted, error } = await query.select(
          'id, match_value, value_category, time_context'
        )

        if (error) {
          console.error('[tool:delete_value_rule] DB error:', error)
          return { error: 'Could not delete the rule. Please try again.' }
        }

        if (!deleted || deleted.length === 0) {
          return {
            deleted: 0,
            message: rule_id
              ? `No rule found with id ${rule_id}.`
              : `No rule found for "${merchant_pattern}".`,
          }
        }

        // Fire-and-forget audit log — symmetric with value_category_corrected.
        void ctx.supabase.from('user_events').insert({
          profile_id: ctx.userId,
          event_type: 'value_rule_deleted',
          event_category: 'correction',
          payload: {
            rule_ids: deleted.map((r) => r.id),
            merchant_pattern: merchant_pattern ?? null,
            rules: deleted.map((r) => ({
              match_value: r.match_value,
              value_category: r.value_category,
              time_context: r.time_context,
            })),
          },
        })

        return {
          deleted: deleted.length,
          rules: deleted.map((r) => ({
            id: r.id,
            match_value: r.match_value,
            value_category: r.value_category,
            time_context: r.time_context,
          })),
          message:
            deleted.length === 1
              ? `Deleted the ${deleted[0].value_category} rule for "${deleted[0].match_value}".`
              : `Deleted ${deleted.length} rules.`,
        }
      } catch (err) {
        console.error('[tool:delete_value_rule] unexpected error:', err)
        return { error: 'Something went wrong deleting the rule. Please try again.' }
      }
    },
  }
}
