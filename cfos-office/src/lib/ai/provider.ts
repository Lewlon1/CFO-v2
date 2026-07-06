import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'

export const bedrock = createAmazonBedrock({
  region: process.env.AWS_REGION!,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
})

/**
 * Rule 5 ("EU or nothing") enforcement. A non-`eu.` inference profile means
 * the request leaves the EU — GDPR-by-architecture is a moat, and one
 * non-EU call breaks it (the dorcas/lewis review caught this exact
 * regression: a staging env var silently overrode every default to
 * `global.anthropic.claude-sonnet-4-6`). Throws at first use so a
 * misconfigured env var fails loudly at cold start instead of silently
 * routing user data outside the EU. ALLOW_NON_EU_BEDROCK=1 is an explicit,
 * intentional escape hatch for local dev only — never set it in a deployed
 * environment.
 */
export function assertEuBedrockModel(modelId: string, label: string): string {
  if (process.env.ALLOW_NON_EU_BEDROCK === '1') return modelId
  if (!modelId.startsWith('eu.')) {
    throw new Error(
      `[provider] Rule 5 violation: ${label} resolved to a non-EU Bedrock inference profile ` +
        `("${modelId}"). Set ALLOW_NON_EU_BEDROCK=1 to override for local dev only — never in ` +
        `a deployed environment.`,
    )
  }
  return modelId
}

/**
 * Rule 5 is a runtime data-residency invariant — no user data flows anywhere
 * during `next build`. But build collects page data by importing every API
 * route, which evaluates this module with the BUILD environment's env vars,
 * so throwing here turns a runtime misconfiguration into a failed deploy
 * (exactly how the claude/remediation-plan-beta-blockers deploy died:
 * "Failed to collect page data for /api/bills/upload"). During the build
 * phase, log the violation loudly and continue; the module re-evaluates at
 * every runtime cold start with the runtime env, where the assert throws
 * before a single request is served — the failure mode the guard was
 * designed for. NEXT_PHASE is set by `next build` and inherited by its
 * page-data workers; it is absent in the deployed function runtime.
 */
export function resolveEuModel(
  envValue: string | undefined,
  fallback: string,
  label: string,
): string {
  const modelId = envValue || fallback
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    if (!modelId.startsWith('eu.') && process.env.ALLOW_NON_EU_BEDROCK !== '1') {
      console.error(
        `[provider] Rule 5 warning: ${label} resolved to a non-EU Bedrock inference profile ` +
          `("${modelId}") in the BUILD environment. If the runtime environment matches, every ` +
          `LLM route will throw at cold start — fix the BEDROCK_* env var to an eu. profile.`,
      )
    }
    return modelId
  }
  return assertEuBedrockModel(modelId, label)
}

export const chatModelId = resolveEuModel(
  process.env.BEDROCK_CLAUDE_MODEL,
  'eu.anthropic.claude-sonnet-4-6',
  'chat model',
)
export const utilityModelId = resolveEuModel(
  process.env.BEDROCK_CLAUDE_UTILITY_MODEL,
  'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
  'utility model',
)
// Opus is reserved for lifetime-once high-stakes generations: archetype
// reveal (value-map) and the onboarding wow moment. Same default as the
// existing demo/reading + value-map/reveal routes already use.
export const opusModelId = resolveEuModel(
  process.env.BEDROCK_OPUS_MODEL,
  'eu.anthropic.claude-opus-4-6',
  'opus model',
)
// The first-Read composer's model — reads its own env var (BEDROCK_COMPOSE_MODEL)
// because it's allowed to diverge from the ongoing-chat model, but it must
// resolve (and be guarded) here rather than via an unguarded process.env read
// in compose-first-read.ts — that gap is exactly how first_read_compose ran
// on a global profile while every other call site stayed EU-only.
export const composeModelId = resolveEuModel(
  process.env.BEDROCK_COMPOSE_MODEL,
  chatModelId,
  'compose model',
)
// Log the resolved model IDs once at module load so cold-start logs always
// record exactly which Bedrock inference profiles are in use. Misconfigured
// BEDROCK_CLAUDE_MODEL env vars previously surfaced as an opaque
// "Something went wrong" in the chat UI (Bedrock 400 ValidationException
// during streaming); this log makes the next occurrence diagnosable in one
// step via the Vercel function logs.
console.log(
  '[bedrock] chat model:', chatModelId,
  'utility model:', utilityModelId,
  'opus model:', opusModelId,
  'compose model:', composeModelId,
  'region:', process.env.AWS_REGION,
)
export const chatModel = bedrock(chatModelId)
export const analysisModel = bedrock(chatModelId)
export const utilityModel = bedrock(utilityModelId)
