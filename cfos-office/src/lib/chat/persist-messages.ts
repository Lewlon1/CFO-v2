// Stub — message persistence will be implemented in Session 2
export async function persistMessages(_params: {
  userId?: string
  profileId?: string
  sessionId?: string
  chatType?: string
  userMessage?: unknown
  messages?: { role: string; content: string }[]
  [key: string]: unknown
}): Promise<void> {
  // no-op
}
