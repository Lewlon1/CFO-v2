export type BedrockUsageEvent = {
  callSite: 'chat' | 'categorise' | 'portrait' | 'wow_moment_author' | string
  model: 'sonnet' | 'haiku' | 'opus'
  inputTokens: number
  outputTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  userId?: string
  conversationId?: string
  timestamp: string
}

export function logBedrockUsage(event: BedrockUsageEvent): void {
  console.log('[bedrock-usage]', JSON.stringify(event))
}
