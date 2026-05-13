import { createServiceClient } from '@/lib/supabase/service';

export type LogToolCallInput = {
  userId: string;
  toolName: string;
  model: string;
  conversationId?: string | null;
  messageId?: string | null;
  stepIndex?: number;
  stepInputTokens?: number;
  stepOutputTokens?: number;
  toolsInStep?: number;
  durationMs?: number;
  extra?: Record<string, unknown>;
};

export async function logToolCall(input: LogToolCallInput): Promise<void> {
  try {
    const supabase = createServiceClient();
    // prompt_tokens / completion_tokens stay null on tool_call rows. The
    // step-level usage from streamText's onStepFinish covers every tool call
    // in that step — putting it in the top-level token columns would inflate
    // SUM(prompt_tokens) when more than one tool fires per step.
    const { error } = await supabase.from('llm_usage_log').insert({
      call_type: 'tool_call',
      tool_name: input.toolName,
      model: input.model,
      user_id: input.userId,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      duration_ms: input.durationMs ?? null,
      metadata: {
        conversation_id: input.conversationId ?? null,
        message_id: input.messageId ?? null,
        step_index: input.stepIndex ?? null,
        step_input_tokens: input.stepInputTokens ?? null,
        step_output_tokens: input.stepOutputTokens ?? null,
        tools_in_step: input.toolsInStep ?? null,
        ...(input.extra ?? {}),
      },
    });
    if (error) {
      console.error('[llm_usage_log] tool_call insert error:', error.message);
    }
  } catch (err) {
    console.error('[llm_usage_log] tool_call write failed:', err);
  }
}
