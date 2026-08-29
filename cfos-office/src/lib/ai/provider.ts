import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'

/** The type of a model instance, i.e. the result of `bedrock(modelId)`. */
type BedrockModel = ReturnType<ReturnType<typeof createAmazonBedrock>>

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(`[provider] required env var ${name} is unset — cannot construct the Bedrock client`)
  }
  return v
}

// The Bedrock client is constructed lazily and memoised on first use, NOT at
// module load. Two reasons:
//   1. Testability — importing this module to test the pure Rule 5 helpers
//      (assertEuBedrockModel / resolveEuModel) no longer constructs a client or
//      reads AWS creds. Tests previously had to vi.mock the whole module to
//      avoid that side effect.
//   2. Defense-in-depth on region ordering — the region is read at first
//      request, not at import, so no import-order quirk can capture
//      `region: undefined` (the shape the 2026-05-14 harness bug took; the real
//      fix, not the `set -a` workaround). requireEnv throws loudly if it's unset.
let _client: ReturnType<typeof createAmazonBedrock> | null = null

function getBedrockClient(): ReturnType<typeof createAmazonBedrock> {
  if (!_client) {
    _client = createAmazonBedrock({
      region: requireEnv('AWS_REGION'),
      accessKeyId: requireEnv('AWS_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
    })
    console.log('[bedrock] client constructed — region:', process.env.AWS_REGION)
  }
  return _client
}

/**
 * Callable model factory — `bedrock(modelId)`. Unchanged call shape for the
 * five sites that build a model from a resolved id (compose-first-read,
 * regenerate-archetype, generate-archetype, demo/reading, value-map/reveal);
 * the client is built on the first call, not at import.
 */
export function bedrock(modelId: string): BedrockModel {
  return getBedrockClient()(modelId)
}

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

// Any `eu.` Bedrock inference profile works here, not just Anthropic's — e.g.
// setting BEDROCK_CLAUDE_MODEL=eu.amazon.nova-pro-v1:0 or
// BEDROCK_CLAUDE_UTILITY_MODEL=eu.amazon.nova-lite-v1:0 opts that surface into
// Amazon Nova for a cost/quality A/B. Claude stays the default. Add the
// profile's rate to rates.ts first, or cost logging degrades to null for that
// surface (see rates.ts's throw-on-unknown-profile design).
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
// record exactly which Bedrock inference profiles are in use. This does NOT
// construct the client (that is lazy — see getBedrockClient). Misconfigured
// BEDROCK_CLAUDE_MODEL env vars previously surfaced as an opaque "Something
// went wrong" in the chat UI (Bedrock 400 ValidationException during
// streaming); this log makes the next occurrence diagnosable in one step via
// the Vercel function logs.
console.log(
  '[bedrock] chat model:', chatModelId,
  'utility model:', utilityModelId,
  'opus model:', opusModelId,
  'compose model:', composeModelId,
  'region:', process.env.AWS_REGION,
)

// Model instances remain plain VALUES (`model: chatModel`) for the ~15 call
// sites that pass them straight to streamText/generateText/generateObject, but
// each is a lazy proxy: the underlying model (and therefore the client) is
// built on first property access, not at import. This keeps every call site
// unchanged while making a bare `import { ... } from './provider'` free of side
// effects. analysisModel mirrors the original — a second instance on the chat
// model id.
function lazyModel(getId: () => string): BedrockModel {
  let real: BedrockModel | null = null
  const resolve = (): BedrockModel => (real ??= getBedrockClient()(getId()))
  return new Proxy({} as BedrockModel, {
    get(_t, prop) {
      const target = resolve() as unknown as Record<PropertyKey, unknown>
      const value = target[prop]
      // Bind methods to the real model so `this` is the model, not the proxy.
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value
    },
    has(_t, prop) {
      return prop in (resolve() as object)
    },
    getPrototypeOf() {
      return Object.getPrototypeOf(resolve() as object)
    },
  })
}

export const chatModel = lazyModel(() => chatModelId)
export const analysisModel = lazyModel(() => chatModelId)
export const utilityModel = lazyModel(() => utilityModelId)
