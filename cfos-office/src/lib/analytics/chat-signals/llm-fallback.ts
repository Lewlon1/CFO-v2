import { generateObject } from 'ai';
import { z } from 'zod';
import { utilityModel, utilityModelId } from '@/lib/ai/provider';
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage';
import type { ChatSignalType } from './types';

// Haiku-based fallback for ambiguous chat messages where pattern matching
// found nothing or only low-confidence hits. Best-effort: failures are
// swallowed by the caller (extract.ts).

const ExtractionSchema = z.object({
  signals: z
    .array(
      z.object({
        signal_type: z.enum([
          'regret',
          'enjoyment',
          'context_person',
          'context_event',
          'context_situation',
        ]),
        marker_phrase: z.string().describe('Verbatim text from the message that signals this.'),
        target_merchant: z.string().nullable().describe('Merchant if attribution is clear, else null.'),
        target_category: z.string().nullable().describe('Category if attribution is clear, else null.'),
        confidence: z.number().min(0).max(1),
      }),
    )
    .describe('Empty array when no clear signals are present.'),
});

export type LlmExtractedSignal = {
  signal_type: ChatSignalType;
  marker_phrase: string;
  target_merchant: string | null;
  target_category: string | null;
  confidence: number;
};

export async function llmExtractSignals(
  messageText: string,
  recentMerchants: string[],
): Promise<LlmExtractedSignal[]> {
  const result = await generateObject({
    model: utilityModel,
    schema: ExtractionSchema,
    prompt: `Extract emotional or contextual signals from this user message about their spending.

Only extract clear signals; if a signal is ambiguous, do NOT include it.

User message:
"${messageText}"

Recently discussed merchants (use for target_merchant attribution if a signal clearly relates to one):
${recentMerchants.length > 0 ? recentMerchants.map(m => `- ${m}`).join('\n') : '(none)'}

Signal types:
- regret: user expresses regret about a purchase
- enjoyment: user expresses they value or enjoyed a purchase
- context_person: who they were with (e.g. "with my mum")
- context_event: occasion (e.g. "for my birthday")
- context_situation: emotional or situational context (e.g. "after work", "stressed")

Each signal requires:
- marker_phrase: verbatim text from the message (a short phrase, not the whole message)
- confidence: 0.0-1.0; use ≥0.7 for clear cases only
- target_merchant / target_category: nullable; only set when attribution is clear

Return an empty array if the message contains no clear signals.`,
  });

  // Usage accounting (previously invisible to llm_usage_log).
  void trackLLMUsage({
    callType: 'chat_signal_fallback',
    model: utilityModelId,
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
  });

  return result.object.signals;
}
