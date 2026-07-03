import { trackLLMUsage, type LLMCallType } from '@/lib/analytics/track-llm-usage'

/**
 * Thin adapter over trackLLMUsage for the older call sites (value-map reveal,
 * archetype generation/regeneration) that predate the analytics helper. Was a
 * no-op stub — which meant those Bedrock calls were invisible to
 * llm_usage_log and therefore uncountable by the LLM cost guard's daily caps.
 *
 * The free-form `action` string is normalised to a closed call_type (the
 * guard counts per call_type) and preserved verbatim in metadata.
 */
export async function logChatUsage(params: {
  userId?: string
  profileId?: string
  agentId?: string
  action?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  tokensIn?: number
  tokensOut?: number
  durationMs?: number
  [key: string]: unknown
}): Promise<void> {
  const action = params.action ?? 'unknown'
  const callType: LLMCallType = action.startsWith('archetype_')
    ? 'archetype_generation'
    : action === 'value_map_reveal'
      ? 'value_map_reveal'
      : 'chat_misc'
  await trackLLMUsage({
    userId: params.userId ?? params.profileId,
    callType,
    model: params.model ?? 'unknown',
    inputTokens: params.inputTokens ?? params.tokensIn,
    outputTokens: params.outputTokens ?? params.tokensOut,
    durationMs: params.durationMs,
    metadata: { action },
  })
}
