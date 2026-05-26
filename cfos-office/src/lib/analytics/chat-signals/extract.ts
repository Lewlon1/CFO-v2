import { createServiceClient } from '@/lib/supabase/service';
import { matchPatterns } from './patterns';
import { llmExtractSignals } from './llm-fallback';
import type { ExtractedSignal } from './types';

const LLM_FALLBACK_CONFIDENCE_THRESHOLD = 0.7;
const RAW_MESSAGE_SNAPSHOT_MAX = 500;

// Attempt to attribute pattern hits to a merchant. For now we do a simple
// "first recent merchant mentioned in or alongside the message" heuristic.
// The LLM fallback path can do better attribution itself.
function attributeMerchantToPatternHits(
  hits: ReturnType<typeof matchPatterns>,
  messageText: string,
  recentMerchants: string[],
): ExtractedSignal[] {
  // Find the first recent merchant whose name appears in the message text.
  // Case-insensitive substring match against the cleaned merchant key.
  const lower = messageText.toLowerCase();
  const matched = recentMerchants.find(m => {
    // Strip common bank prefixes for matching purposes only.
    const cleaned = m.replace(/POS PURCHASE\s+/i, '').replace(/ATM WITHDRAWAL\s+/i, '').replace(/#\d+/, '').trim();
    return cleaned.length > 3 && lower.includes(cleaned.toLowerCase());
  }) ?? null;

  return hits.map(h => ({
    signal_type: h.signal_type,
    marker_phrase: h.marker_phrase,
    target_merchant: matched,
    target_category: null,
    confidence: h.confidence,
    extraction_method: 'pattern' as const,
  }));
}

export async function extractAndStoreSignals(params: {
  userId: string;
  messageId: string;
  messageText: string;
  recentMerchants: string[];
}): Promise<{ stored: number; usedLlm: boolean }> {
  const patternHits = matchPatterns(params.messageText);
  const patternSignals = attributeMerchantToPatternHits(
    patternHits,
    params.messageText,
    params.recentMerchants,
  );

  const avgPatternConfidence =
    patternSignals.length > 0
      ? patternSignals.reduce((a, h) => a + h.confidence, 0) / patternSignals.length
      : 0;
  const needsFallback =
    patternSignals.length === 0 || avgPatternConfidence < LLM_FALLBACK_CONFIDENCE_THRESHOLD;

  let allSignals: ExtractedSignal[] = patternSignals;
  let usedLlm = false;

  if (needsFallback) {
    try {
      const llmSignals = await llmExtractSignals(params.messageText, params.recentMerchants);
      usedLlm = true;
      const llmNew = llmSignals.filter(
        ls =>
          !patternSignals.some(
            ph => ph.marker_phrase.toLowerCase() === ls.marker_phrase.toLowerCase(),
          ),
      );
      allSignals = [
        ...patternSignals,
        ...llmNew.map(s => ({
          signal_type: s.signal_type,
          marker_phrase: s.marker_phrase,
          target_merchant: s.target_merchant,
          target_category: s.target_category,
          confidence: s.confidence,
          extraction_method: 'llm' as const,
        })),
      ];
    } catch (err) {
      console.error('[chat-signals] LLM fallback failed:', err);
    }
  }

  if (allSignals.length === 0) {
    return { stored: 0, usedLlm };
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from('chat_signals').insert(
    allSignals.map(s => ({
      user_id: params.userId,
      message_id: params.messageId,
      signal_type: s.signal_type,
      target_merchant: s.target_merchant ?? null,
      target_category: s.target_category ?? null,
      marker_phrase: s.marker_phrase,
      confidence: s.confidence,
      extraction_method: s.extraction_method,
      raw_message_text: params.messageText.slice(0, RAW_MESSAGE_SNAPSHOT_MAX),
    })),
  );
  if (error) {
    console.error('[chat-signals] insert failed:', error);
    return { stored: 0, usedLlm };
  }
  return { stored: allSignals.length, usedLlm };
}
