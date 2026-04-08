import { z } from 'zod'
import type { ToolContext } from './types'
import { selectValueReviewCandidates } from './get-value-review-queue'

const MIN_COUNT = 5

export function createCheckValueCheckinReadyTool(ctx: ToolContext) {
  return {
    description:
      'THE tool for "value check-in" requests. Checks availability for a short batch ' +
      'card-based classification session that runs in a dedicated UI at /value-map?mode=checkin.\n\n' +
      'ALWAYS call this — and emit a [CTA:value_checkin] block — when the user says ANY of:\n' +
      '- "value check-in" / "check-in" / "check in on my values"\n' +
      '- "Value Map" / "retake the Value Map" / "let me classify some transactions"\n' +
      '- "can I review my transactions?" / "let me tell you how I feel about my spending"\n\n' +
      'Also call this proactively when you want to offer a batch session (e.g. after a user asks ' +
      'about their values view, or a few messages into a post-upload chat).\n\n' +
      'CRITICAL RULES:\n' +
      '- NEVER classify transactions inline in chat when the user asks for a check-in. Always ' +
      '  route to the CTA. The check-in endpoint saves classifications server-side — you do not ' +
      '  call record_value_classifications during or after a check-in.\n' +
      '- Do NOT call get_value_review_queue when the user asked for a check-in. That tool is only ' +
      '  for mid-conversation inline curiosity moments, not for explicit check-in requests.\n' +
      '- If available, reply with ONE casual sentence ("Yep, 12 ready — want to?") plus this exact ' +
      '  CTA block on its own line (fill in the count):\n' +
      '    [CTA:value_checkin]Start value check-in (N transactions)[/CTA]\n' +
      '- If NOT available, briefly explain why (e.g. "Not enough uncertain transactions yet — upload a ' +
      '  new statement and try again") and DO NOT fall back to inline classification.\n' +
      '- Never offer a check-in twice in the same conversation. Never offer one immediately after ' +
      '  a new upload — let the first insight land first.',
    inputSchema: z.object({}).describe('No parameters needed'),
    execute: async () => {
      try {
        const result = await selectValueReviewCandidates(ctx.supabase, ctx.userId, {
          format: 'individual',
          minCount: MIN_COUNT,
          maxCount: 12,
          maxPerMerchant: 3,
        })

        if (result.format !== 'individual') {
          return { available: false, reason: 'Unexpected selection format' }
        }

        if (result.transactions.length < MIN_COUNT) {
          return {
            available: false,
            reason: 'Not enough uncertain transactions for a check-in yet',
            transaction_count: result.transactions.length,
          }
        }

        // Look up last check-in completion
        const { data: lastEvent } = await ctx.supabase
          .from('user_events')
          .select('created_at')
          .eq('profile_id', ctx.userId)
          .eq('event_type', 'value_checkin_completed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const lastCheckinAt = lastEvent?.created_at ?? null
        const daysSinceLast = lastCheckinAt
          ? Math.floor(
              (Date.now() - new Date(lastCheckinAt).getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : null

        return {
          available: true,
          transaction_count: result.transactions.length,
          total_uncertain: result.totalCandidates,
          categories_represented: result.categoriesRepresented.length,
          last_checkin_at: lastCheckinAt,
          days_since_last_checkin: daysSinceLast,
        }
      } catch (err) {
        console.error('[tool:check_value_checkin_ready] error:', err)
        return { available: false, reason: 'Could not check availability' }
      }
    },
  }
}
