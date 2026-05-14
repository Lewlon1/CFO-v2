import { generateText } from 'ai'
import { utilityModel, utilityModelId } from '@/lib/ai/provider'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
import { logBedrockUsage } from '@/lib/ai/usage-logger'
import { sendAlert } from '@/lib/alerts/notify'

/**
 * After the CFO has offered the Value Map in chat, classify whether the
 * user's reply is a decline/defer ("not now", "later", "skip", "maybe later").
 *
 * Synchronous Haiku call, gating the next assistant reply. Fail-open: on
 * any error, return false so the offer can still appear naturally and we
 * don't accidentally suppress a willing user.
 */
export async function classifyValueMapDecline(
  userText: string,
  userId?: string,
): Promise<boolean> {
  const trimmed = userText.trim()
  if (!trimmed) return false

  const startTime = Date.now()
  try {
    const result = await generateText({
      model: utilityModel,
      messages: [
        {
          role: 'user',
          content:
            `The CFO just offered the user a "Value Map" exercise.\n` +
            `The user's reply was:\n"${trimmed}"\n\n` +
            `Did the user decline or defer the Value Map (e.g. "no thanks", "later", "not now", "skip", "maybe another time")?\n` +
            `Reply with exactly one word: "yes" or "no". Nothing else.`,
        },
      ],
    })
    const durationMs = Date.now() - startTime

    void trackLLMUsage({
      userId,
      callType: 'onboarding_v2_value_map_decline',
      model: utilityModelId,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      durationMs,
      metadata: { user_text_length: trimmed.length },
    })

    logBedrockUsage({
      callSite: 'onboarding_v2_value_map_decline',
      model: 'haiku',
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      userId,
      timestamp: new Date().toISOString(),
    })

    const answer = result.text.trim().toLowerCase()
    return answer.startsWith('yes')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[onboarding-v2.decline-classifier] bedrock call failed', error)
    void sendAlert({
      severity: 'warning',
      event: 'onboarding_v2_value_map_decline_failed',
      user_id: userId,
      details: message,
      metadata: { model: utilityModelId, user_text_length: trimmed.length },
    })
    return false
  }
}
