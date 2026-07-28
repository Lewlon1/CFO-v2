import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { checkRateLimit } from '@/lib/chat/rate-limit'
import { computeCostUsd, RATE_VERSION } from '@/lib/ai/rates'

/**
 * Per-user LLM cost guard — the durable ceiling on Bedrock spend.
 *
 * Layered checks, cheapest first:
 *   1. Kill switch  — LLM_DISABLED env var. Flip it in Vercel to stop ALL
 *      user-triggerable Bedrock spend in seconds, no deploy.
 *   2. User block   — user_profiles.llm_blocked_at. Set it in Supabase to stop
 *      one runaway/abusive account.
 *   3. Burst limit  — in-memory fixed window (per instance; see rate-limit.ts).
 *   4. Daily cap    — durable Postgres count of today's llm_usage_log rows for
 *      the surface's call_type (the count-since-timestamp pattern
 *      canSendNudge uses).
 *
 * The chat surface's daily count MUST come from llm_usage_log, not messages:
 * the chat route skips persisting '[System:'-prefixed user messages while
 * still running the full Bedrock turn, so a messages-based count would miss
 * legit hidden triggers AND be trivially dodged by a hostile client. The chat
 * route therefore inserts its own 'chat_turn' accounting row (via
 * recordChatTurnStart) BEFORE streaming — counting attempts, not completions,
 * which is the right semantics for cost (an aborted stream still spent
 * tokens). Non-chat surfaces count their existing post-success trackLLMUsage
 * rows: a small undercount on failed calls, acceptable behind the burst tier.
 *
 * Race note: count-then-call permits a small concurrent overshoot (bounded by
 * the burst limit per instance). Acceptable for cost control — the cap is a
 * ceiling on runaway spend, not an exact meter.
 *
 * When a check fails the caller returns LLM 429 with { error: 'limit',
 * message: LLM_LIMIT_MESSAGE } — a friendly block, no Bedrock call. Computed
 * data stays fully browsable (Rule 6): only fresh LLM turns are gated.
 */

// The Supabase JS client is generic over the DB schema; the guard only counts
// rows and reads one column, so an untyped handle keeps it reusable across
// the anon (server) and service clients.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>

/** C.-voiced friendly-block copy — single source (Rule 7). */
export const LLM_LIMIT_MESSAGE =
  "We've covered a lot today — I'll pick this up with you tomorrow."

export type LlmSurface =
  | 'chat'
  | 'first_read_compose'
  | 'archetype'
  | 'value_map_reveal'
  | 'pdf_vision'
  | 'format_detection'
  | 'upload_categorisation'
  | 'free_text_opener'

type SurfaceLimits = {
  /** Burst: max invocations per window, per instance. */
  burstLimit: number
  burstWindowMs: number
  /** Durable: max invocations per UTC day, per user. */
  dailyCap: number
  /** llm_usage_log.call_type value(s) counted toward the daily cap. */
  callTypes: string[]
}

// Generous by design: real users never touch these; a runaway loop or a
// scripted client caps at a few pounds per user per day.
export const LLM_SURFACE_LIMITS: Record<LlmSurface, SurfaceLimits> = {
  chat: { burstLimit: 10, burstWindowMs: 60_000, dailyCap: 100, callTypes: ['chat_turn'] },
  first_read_compose: {
    burstLimit: 3,
    burstWindowMs: 60_000,
    dailyCap: 15,
    callTypes: ['first_read_compose'],
  },
  archetype: {
    burstLimit: 3,
    burstWindowMs: 60_000,
    dailyCap: 10,
    callTypes: ['archetype_generation'],
  },
  value_map_reveal: {
    burstLimit: 5,
    burstWindowMs: 60_000,
    dailyCap: 20,
    callTypes: ['value_map_reveal'],
  },
  pdf_vision: {
    burstLimit: 2,
    burstWindowMs: 60_000,
    dailyCap: 10,
    callTypes: ['pdf_vision_extraction'],
  },
  format_detection: {
    burstLimit: 5,
    burstWindowMs: 60_000,
    dailyCap: 30,
    callTypes: ['format_detection'],
  },
  upload_categorisation: {
    burstLimit: 5,
    burstWindowMs: 60_000,
    dailyCap: 25,
    callTypes: ['categorisation'],
  },
  free_text_opener: {
    burstLimit: 3,
    burstWindowMs: 60_000,
    dailyCap: 10,
    callTypes: ['onboarding_v2_free_text_opener'],
  },
}

export type LlmGuardVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'disabled' | 'blocked' | 'burst' | 'daily_cap' }

function utcDayStartIso(): string {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString()
}

export function isLlmDisabled(): boolean {
  const v = process.env.LLM_DISABLED
  return v === '1' || v === 'true'
}

export async function checkLlmAllowed(args: {
  userId: string
  surface: LlmSurface
  supabase: AnySupabase
}): Promise<LlmGuardVerdict> {
  const { userId, surface, supabase } = args
  const limits = LLM_SURFACE_LIMITS[surface]

  // 1. Kill switch — cheapest, checked first.
  if (isLlmDisabled()) return { allowed: false, reason: 'disabled' }

  // 2. Per-user block flag.
  try {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('llm_blocked_at')
      .eq('id', userId)
      .maybeSingle()
    if (profile?.llm_blocked_at != null) return { allowed: false, reason: 'blocked' }
  } catch (err) {
    // Fail-open on infrastructure errors: the guard protects cost, and a DB
    // blip must not take chat down. The burst tier still applies below.
    console.error('[llm-guard] block-flag read failed:', err)
  }

  // 3. Burst limit (in-memory, per instance).
  const burst = await checkRateLimit(`llm:${surface}:${userId}`, {
    limit: limits.burstLimit,
    windowMs: limits.burstWindowMs,
  })
  if (!burst.allowed) return { allowed: false, reason: 'burst' }

  // 4. Durable daily cap.
  try {
    const { count, error } = await supabase
      .from('llm_usage_log')
      .select('id', { head: true, count: 'exact' })
      .eq('user_id', userId)
      .in('call_type', limits.callTypes)
      .gte('created_at', utcDayStartIso())
    if (error) {
      console.error('[llm-guard] daily count failed:', error)
      return { allowed: true } // fail-open, same rationale as above
    }
    if ((count ?? 0) >= limits.dailyCap) return { allowed: false, reason: 'daily_cap' }
  } catch (err) {
    console.error('[llm-guard] daily count threw:', err)
  }

  return { allowed: true }
}

/**
 * Insert the chat turn's accounting row BEFORE the stream starts. This row is
 * both the Layer-4 usage record and the unit the daily cap counts — written
 * unconditionally per invocation, so hidden [System:] triggers count and a
 * disconnect mid-stream still counted the attempt. Returns the row id so
 * onFinish can backfill the aggregate token usage, or null on failure
 * (fail-open: accounting must never block the turn).
 */
export async function recordChatTurnStart(args: {
  userId: string
  conversationId: string | null
  model: string
}): Promise<string | null> {
  try {
    const svc = createServiceClient()
    const { data, error } = await svc
      .from('llm_usage_log')
      .insert({
        user_id: args.userId,
        call_type: 'chat_turn',
        model: args.model,
        metadata: { conversation_id: args.conversationId },
      })
      .select('id')
      .single()
    if (error) {
      console.error('[llm-guard] chat_turn insert failed:', error)
      return null
    }
    return (data?.id as string) ?? null
  } catch (err) {
    console.error('[llm-guard] chat_turn insert threw:', err)
    return null
  }
}

/**
 * Backfill the turn's aggregate token usage — and its computed cost — once the
 * stream finishes. `model` is the resolved inference profile (chatModelId) and
 * the cache-token counts come from the Bedrock usage metadata; cost is computed
 * at write time from the typed rate table (Rule 2). An unknown profile throws
 * in computeCostUsd — caught here so the token backfill still lands with a null
 * cost. Fire-and-forget: accounting must never block the turn.
 */
export async function completeChatTurn(args: {
  rowId: string | null
  model?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  durationMs?: number
}): Promise<void> {
  if (!args.rowId) return
  try {
    let computedCostUsd: number | null = null
    if (args.model) {
      try {
        computedCostUsd = computeCostUsd(args.model, {
          inputTokens: args.inputTokens,
          outputTokens: args.outputTokens,
          cacheReadTokens: args.cacheReadTokens,
          cacheWriteTokens: args.cacheWriteTokens,
        })
      } catch (err) {
        console.error('[llm-guard] chat_turn cost skipped:', (err as Error).message)
      }
    }
    const svc = createServiceClient()
    await svc
      .from('llm_usage_log')
      .update({
        prompt_tokens: args.inputTokens ?? null,
        completion_tokens: args.outputTokens ?? null,
        total_tokens: (args.inputTokens ?? 0) + (args.outputTokens ?? 0) || null,
        cache_read_tokens: args.cacheReadTokens ?? null,
        cache_write_tokens: args.cacheWriteTokens ?? null,
        duration_ms: args.durationMs ?? null,
        computed_cost_usd: computedCostUsd,
        rate_version: computedCostUsd == null ? null : RATE_VERSION,
      })
      .eq('id', args.rowId)
  } catch (err) {
    console.error('[llm-guard] chat_turn completion failed:', err)
  }
}
