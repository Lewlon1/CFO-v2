export type BedrockUsageEvent = {
  callSite: 'chat' | 'categorise' | 'portrait' | string
  model: 'sonnet' | 'haiku'
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

export function estimateCostUSD(event: BedrockUsageEvent): number {
  const rates = {
    sonnet: { input: 3.3 / 1_000_000, output: 16.5 / 1_000_000 },
    haiku: { input: 0.88 / 1_000_000, output: 4.4 / 1_000_000 },
  }
  const r = rates[event.model]

  let inputCost = event.inputTokens * r.input
  if (event.cacheReadTokens) {
    inputCost =
      (event.inputTokens - event.cacheReadTokens) * r.input +
      event.cacheReadTokens * r.input * 0.1
  }
  if (event.cacheCreationTokens) {
    inputCost += event.cacheCreationTokens * r.input * 0.25
  }

  const outputCost = event.outputTokens * r.output
  return inputCost + outputCost
}
