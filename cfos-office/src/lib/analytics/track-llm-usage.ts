import { createServiceClient } from '@/lib/supabase/service';
import { computeCostUsd, RATE_VERSION } from '@/lib/ai/rates';

// call_type is free text in the DB (no enum/CHECK); this union is the TS-side
// registry. The LLM cost guard counts rows per call_type for its daily caps
// (src/lib/ai/llm-guard.ts) — keep new Bedrock call sites logging under one of
// these, or add a literal here.
export type LLMCallType =
  | 'categorisation'
  | 'post_conversation_analysis'
  | 'screenshot_parse'
  | 'value_map_reading'
  | 'bill_analysis'
  | 'balance_sheet_screenshot_parse'
  | 'balance_sheet_pdf_parse'
  | 'pdf_transaction_parse'
  | 'format_detection'
  | 'pdf_vision_extraction'
  | 'onboarding_v2_free_text_opener'
  | 'onboarding_v2_value_map_decline'
  | 'post_conversation_profile_extraction'
  // Added with the LLM cost guard (previously unlogged call sites):
  | 'chat_turn' // written by llm-guard's recordChatTurnStart, not this helper
  | 'chat_forced_retry'
  | 'chat_misc'
  | 'first_read_compose'
  | 'archetype_generation'
  | 'value_map_reveal'
  | 'persona_sanitiser'
  | 'chat_signal_fallback'
  | 'bill_extraction'
  | 'bill_alternatives_search';

interface LLMUsageParams {
  userId?: string;
  callType: LLMCallType;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export async function trackLLMUsage(params: LLMUsageParams): Promise<void> {
  try {
    const supabase = createServiceClient();
    // Cost is computed at write time from the typed rate table (Rule 2). An
    // unknown/misconfigured model id throws in computeCostUsd — caught here so
    // the row still lands with a null cost ("cost unknown", never "cost zero").
    // The daily-cap guard counts rows, so a null cost never breaks the ceiling.
    let computedCostUsd: number | null = null;
    try {
      computedCostUsd = computeCostUsd(params.model, {
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
      });
    } catch (err) {
      console.error('[analytics] cost skipped:', (err as Error).message);
    }
    await supabase.from('llm_usage_log').insert({
      user_id: params.userId ?? null,
      call_type: params.callType,
      model: params.model,
      prompt_tokens: params.inputTokens ?? null,
      completion_tokens: params.outputTokens ?? null,
      total_tokens: (params.inputTokens ?? 0) + (params.outputTokens ?? 0) || null,
      duration_ms: params.durationMs ?? null,
      metadata: params.metadata ?? {},
      computed_cost_usd: computedCostUsd,
      rate_version: computedCostUsd == null ? null : RATE_VERSION,
    });
  } catch {
    console.error('[analytics] LLM usage tracking failed');
  }
}
