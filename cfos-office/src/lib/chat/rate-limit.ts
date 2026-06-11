// In-memory fixed-window rate limiter.
//
// State is per-process. On serverless (Vercel) each instance keeps its own
// window, so this caps per-instance abuse rather than enforcing a single global
// quota. That is still a meaningful floor against scripted abuse and LLM
// cost-amplification on unauthenticated endpoints. A Redis-backed limiter is the
// eventual cross-instance upgrade; the call sites do not need to change for it.

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
let lastSweep = Date.now()

// Drop expired buckets periodically so the Map does not grow unbounded.
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export interface RateLimitOptions {
  /** Max requests permitted per window. Default 30. */
  limit?: number
  /** Window length in milliseconds. Default 60_000 (1 minute). */
  windowMs?: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
}

export async function checkRateLimit(
  identifier: string,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const limit = options.limit ?? 30
  const windowMs = options.windowMs ?? 60_000
  const now = Date.now()

  sweep(now)

  let bucket = buckets.get(identifier)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs }
    buckets.set(identifier, bucket)
  }

  bucket.count++
  const remaining = Math.max(0, limit - bucket.count)
  return { allowed: bucket.count <= limit, remaining, resetAt: new Date(bucket.resetAt) }
}

// Derive a rate-limit key from the caller's IP for unauthenticated routes.
// Vercel/most proxies set x-forwarded-for; fall back to x-real-ip.
export function ipRateLimitKey(req: Request, scope: string): string {
  const forwarded = req.headers.get('x-forwarded-for')
  const ip =
    (forwarded ? forwarded.split(',')[0]?.trim() : '') ||
    req.headers.get('x-real-ip') ||
    'unknown'
  return `${scope}:${ip}`
}
