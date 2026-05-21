import { z } from 'zod'
import type { ToolContext } from './types'

interface ThesisLine {
  text: string
  confidence: number
  status: 'open' | 'contradicted' | 'confirmed'
}

export function createMarkHypothesisLineContradictedTool(ctx: ToolContext) {
  return {
    description:
      'Mark one line of your working hypothesis as contradicted by the user. ' +
      'Call this when the user says something that directly invalidates a line ' +
      'shown in the "## Working hypothesis" block — e.g. you assumed dining sits ' +
      'in Foundation and they say it is actually a Leak, or you read their goal ' +
      'as unsculpted and they reveal a target amount and date. Provide the ' +
      'line_number (1, 2, or 3) and a one-sentence reason in your own words. ' +
      'Subsequent turns will see the line marked "contradicted" — do not rescue ' +
      'or repeat it.',
    inputSchema: z.object({
      line_number: z
        .number()
        .int()
        .min(1)
        .max(3)
        .describe('Which line of the working hypothesis the user contradicted (1, 2, or 3).'),
      reason: z
        .string()
        .min(10)
        .max(200)
        .describe('One short sentence describing what the user said that contradicts the line.'),
    }),
    execute: async ({ line_number, reason }: { line_number: number; reason: string }) => {
      try {
        const { data: hypothesis } = await ctx.supabase
          .from('user_hypotheses')
          .select('id, thesis_lines')
          .eq('user_id', ctx.userId)
          .is('superseded_at', null)
          .order('generated_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (!hypothesis) {
          return { ok: false, error: 'no_active_hypothesis' }
        }

        const lines = hypothesis.thesis_lines as ThesisLine[]
        const idx = line_number - 1
        if (idx < 0 || idx >= lines.length) {
          return { ok: false, error: 'line_out_of_range' }
        }

        const updated: ThesisLine[] = lines.map((l, i) =>
          i === idx ? { ...l, status: 'contradicted' as const } : l,
        )

        const { error: updateError } = await ctx.supabase
          .from('user_hypotheses')
          .update({ thesis_lines: updated })
          .eq('id', hypothesis.id)

        if (updateError) {
          console.error('[tool:mark_hypothesis_line_contradicted] DB error:', updateError)
          return { ok: false, error: 'db_error' }
        }

        void ctx.supabase.from('user_events').insert({
          profile_id: ctx.userId,
          event_type: 'hypothesis_line_contradicted',
          event_category: 'hypothesis',
          payload: { line_number, reason, line_text: lines[idx].text },
          context: { conversation_id: ctx.conversationId },
        })

        return { ok: true, line_number, status: 'contradicted' as const }
      } catch (err) {
        console.error('[tool:mark_hypothesis_line_contradicted] unexpected:', err)
        return { ok: false, error: 'unexpected' }
      }
    },
  }
}
