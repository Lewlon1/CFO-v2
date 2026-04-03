// Stub — rate limiting will be implemented with Redis in a later session
export async function checkRateLimit(
  _userId: string,
  _action?: string
): Promise<{ allowed: boolean; remaining?: number; resetAt?: Date }> {
  return { allowed: true, remaining: 100 }
}
