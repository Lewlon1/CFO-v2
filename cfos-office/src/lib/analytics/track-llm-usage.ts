import { createServiceClient } from '@/lib/supabase/service';

interface LLMUsageParams {
  userId?: string;
  callType: 'categorisation' | 'post_conversation_analysis' | 'screenshot_parse' | 'value_map_reading' | 'bill_analysis';
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export async function trackLLMUsage(params: LLMUsageParams): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase.from('llm_usage_log').insert({
      user_id: params.userId ?? null,
      call_type: params.callType,
      model: params.model,
      prompt_tokens: params.inputTokens ?? null,
      completion_tokens: params.outputTokens ?? null,
      total_tokens: (params.inputTokens ?? 0) + (params.outputTokens ?? 0) || null,
      duration_ms: params.durationMs ?? null,
      metadata: params.metadata ?? {},
    });
  } catch {
    console.error('[analytics] LLM usage tracking failed');
  }
}
