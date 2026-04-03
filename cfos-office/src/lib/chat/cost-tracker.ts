// Stub — cost tracking will be implemented in a later session
export async function logChatUsage(_params: {
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
  // no-op
}
