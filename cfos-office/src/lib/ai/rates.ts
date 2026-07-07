/**
 * Bedrock cost rate table — the single source of truth for turning token
 * counts into money (Rule 8, Rule 2: the system computes, the LLM never does).
 *
 * Cost is computed and stored at write time from this typed table — never
 * derived later, never estimated by a model. A wrong rate silently corrupts
 * every downstream cost figure, so `computeCostUsd` THROWS on any profile it
 * doesn't recognise rather than silently returning zero: a hallucinated or
 * misconfigured model id surfaces as a logged skip, not a fabricated £0.00.
 *
 * Keys are the EXACT `eu.` cross-region inference-profile strings resolved in
 * provider.ts (Phase 0 — 2026-07-07), not model-family names. If an env var
 * overrides a model to a profile absent here, cost is left null (loud console
 * skip) until the rate is added — never guessed.
 *
 * Rates below are the published Anthropic list prices for the underlying
 * models (Bedrock Claude on-demand mirrors these): Opus 4.6 $5/$25, Sonnet 4.6
 * $3/$15, Haiku 4.5 $1/$5 per 1M tokens; prompt-cache reads bill at ~0.1x
 * input, cache writes at ~1.25x input (the 5-minute-TTL rate the chat route
 * uses). Verified against the Anthropic model catalogue this session; the AWS
 * Bedrock pricing page (https://aws.amazon.com/bedrock/pricing/) was
 * unreachable from the build environment (HTTP 403).
 *
 * TODO(Lewis): confirm these against the eu-west-1 Amazon Bedrock on-demand
 * pricing page and correct any figure that differs, then bump RATE_VERSION.
 */

export const RATE_VERSION = '2026-07-B1'

export type Rate = {
  /** USD per 1,000,000 uncached input tokens. */
  inputPerMTok: number
  /** USD per 1,000,000 output tokens. */
  outputPerMTok: number
  /** Cache-read tokens bill at this multiple of the input rate (~0.1x). */
  cacheReadMult: number
  /** Cache-write tokens bill at this multiple of the input rate (5-min TTL ~1.25x). */
  cacheWriteMult: number
}

export type Usage = {
  inputTokens?: number
  outputTokens?: number
  /** Tokens served from the prompt cache (billed at cacheReadMult x input). */
  cacheReadTokens?: number
  /** Tokens written to the prompt cache (billed at cacheWriteMult x input). */
  cacheWriteTokens?: number
}

// Exact inference-profile strings from provider.ts — NOT model-family names.
export const RATES: Record<string, Rate> = {
  'eu.anthropic.claude-sonnet-4-6': {
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    cacheReadMult: 0.1,
    cacheWriteMult: 1.25,
  },
  'eu.anthropic.claude-haiku-4-5-20251001-v1:0': {
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
    cacheReadMult: 0.1,
    cacheWriteMult: 1.25,
  },
  'eu.anthropic.claude-opus-4-6': {
    inputPerMTok: 5.0,
    outputPerMTok: 25.0,
    cacheReadMult: 0.1,
    cacheWriteMult: 1.25,
  },
}

/**
 * Compute the USD cost of one Bedrock completion from the typed rate table.
 * Throws on an unknown profile — the caller (the fire-and-forget usage logger)
 * catches it and stores a null cost, so accounting degrades to "cost unknown"
 * rather than "cost zero". Never returns a guessed or silent-zero figure.
 */
export function computeCostUsd(profile: string, u: Usage): number {
  const rate = RATES[profile]
  if (!rate) {
    throw new Error(
      `[rates] no rate for Bedrock inference profile "${profile}" ` +
        `(RATE_VERSION ${RATE_VERSION}). Add it to rates.ts before this model ` +
        `ships — cost must never be silently zeroed.`,
    )
  }
  const input = (u.inputTokens ?? 0) * rate.inputPerMTok
  const output = (u.outputTokens ?? 0) * rate.outputPerMTok
  const cacheRead = (u.cacheReadTokens ?? 0) * rate.inputPerMTok * rate.cacheReadMult
  const cacheWrite = (u.cacheWriteTokens ?? 0) * rate.inputPerMTok * rate.cacheWriteMult
  return (input + output + cacheRead + cacheWrite) / 1_000_000
}
