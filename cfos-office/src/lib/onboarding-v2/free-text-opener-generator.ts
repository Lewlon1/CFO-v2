import { generateText } from 'ai'
import { utilityModel, utilityModelId } from '@/lib/ai/provider'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
import { logBedrockUsage } from '@/lib/ai/usage-logger'
import { sendAlert } from '@/lib/alerts/notify'
import {
  buildFreeTextOpenerPrompt,
  FREE_TEXT_OPENER_FALLBACK,
} from './free-text-opener-prompt'

export async function generateFreeTextOpener(
  userText: string,
  userId?: string,
): Promise<string> {
  const startTime = Date.now()
  try {
    const result = await generateText({
      model: utilityModel,
      messages: [
        { role: 'user', content: buildFreeTextOpenerPrompt(userText) },
      ],
    })
    const durationMs = Date.now() - startTime

    void trackLLMUsage({
      userId,
      callType: 'onboarding_v2_free_text_opener',
      model: utilityModelId,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      durationMs,
      metadata: { user_text_length: userText.length },
    })

    logBedrockUsage({
      callSite: 'onboarding_v2_free_text_opener',
      model: 'haiku',
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      userId,
      timestamp: new Date().toISOString(),
    })

    const text = result.text.trim()
    return text.length > 0 ? text : FREE_TEXT_OPENER_FALLBACK
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[onboarding-v2.free-text-opener] bedrock call failed', {
      error,
      userId,
    })
    void sendAlert({
      severity: 'warning',
      event: 'onboarding_v2_free_text_opener_failed',
      user_id: userId,
      details: message,
      metadata: { model: utilityModelId, user_text_length: userText.length },
    })
    return FREE_TEXT_OPENER_FALLBACK
  }
}
