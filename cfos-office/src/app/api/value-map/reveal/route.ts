import { generateText } from 'ai'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/chat/rate-limit'
import { logChatUsage } from '@/lib/chat/cost-tracker'
import { checkLlmAllowed, LLM_LIMIT_MESSAGE } from '@/lib/ai/llm-guard'
import { bedrock, opusModelId } from '@/lib/ai/provider'

const OPUS_MODEL = opusModelId

let cachedAgentId: string | null = null

async function getAgentId(): Promise<string> {
  if (cachedAgentId) return cachedAgentId as string
  const supabase = await createClient()
  const { data } = await supabase
    .from('agents')
    .select('id')
    .eq('slug', 'general-cfo')
    .single()
  cachedAgentId = data?.id ?? 'unknown'
  return cachedAgentId as string
}

function buildRevealSystemPrompt(
  currency: string,
  personalityName: string,
  dominantQuadrant: string,
  breakdown: Record<string, number>,
  avgConfidence: number,
): string {
  const sym = { GBP: '\u00A3', USD: '$', EUR: '\u20AC' }[currency] ?? currency
  const dominantPct = breakdown[dominantQuadrant] ?? 0

  return `You are the CFO. A user just completed a Value Map exercise where they categorised transactions into four quadrants: Foundation (needed, served), Investment (chosen, grew), Burden (had to, drained), Leak (didn't need, didn't help).

You have their complete results: merchant name, quadrant, confidence (1–5), first_tap_ms (hesitation before first tap), and deliberation_ms (time deliberating after tapping).

The system has classified this user as "${personalityName}" — ${dominantQuadrant}-dominant at ${dominantPct}%, average confidence ${avgConfidence}/5.

Write an observational reading in three short paragraphs (separated by a single blank line). No bullet points. No headers.

Paragraph 1 — Open with "${personalityName}." then one or two sentences naming the dominant pattern shown in the data. Mention the dominant quadrant percentage and average confidence as observations, not judgements. Describe what the user did, not what kind of person they are.

Paragraph 2 — Walk through the 3–4 most revealing individual decisions. Cover the most interesting of: contradictions (same category, different quadrant for two merchants), highest-confidence calls (5/5), notable hesitation spikes, and any outliers that cut against the dominant pattern. Name every merchant specifically. Say what each decision shows about the user's classification pattern — observation, not characterology.

Paragraph 3 — One sentence. A non-evaluative synthesis of the pattern the data shows. Observation, not judgement. No flattery, no roasting, no characterological labels.

Style rules:
- Second person ("you", "your"). State findings directly; don't narrate the act of observing ("I noticed…", "I can see…")
- Use *italics* (asterisks) sparingly for a single revealing word or phrase
- Warm but direct — no filler, no platitudes, no generic financial guidance
- Every sentence must earn its place
- Total length: 150–220 words
- Only use the currency symbol ${sym} when referencing a specific amount
- Never use "advice" or "advise"; use "guidance", "suggestion", or recast
- End the reading with "— C." on its own line (sign-off on a finding)`
}

export async function POST(req: Request) {
  const startTime = Date.now()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  // LLM cost guard — kill switch / per-user block / burst / daily cap. The
  // route's own 10/60s limiter below stays as an extra layer.
  const guardVerdict = await checkLlmAllowed({
    userId: user.id,
    surface: 'value_map_reveal',
    supabase,
  })
  if (!guardVerdict.allowed) {
    console.warn(`[value-map-reveal] llm-guard blocked user ${user.id}: ${guardVerdict.reason}`)
    return Response.json({ error: 'limit', message: LLM_LIMIT_MESSAGE }, { status: 429 })
  }

  const limit = await checkRateLimit(`vm-reveal:${user.id}`, { limit: 10, windowMs: 60_000 })
  if (!limit.allowed) {
    return Response.json(
      { error: 'Rate limit exceeded. Try again later.', resetAt: limit.resetAt?.toISOString() },
      {
        status: 429,
        headers: {
          'Retry-After': limit.resetAt
            ? String(Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000))
            : '3600',
        },
      },
    )
  }

  const { results, currency, personalityName, dominantQuadrant, breakdown, avgConfidence } = await req.json()

  const systemPrompt = buildRevealSystemPrompt(
    currency ?? 'GBP',
    personalityName ?? 'Your result',
    dominantQuadrant ?? 'foundation',
    breakdown ?? {},
    avgConfidence ?? 3,
  )

  const result = await generateText({
    model: bedrock(OPUS_MODEL),
    system: systemPrompt,
    messages: [{ role: 'user', content: JSON.stringify(results) }],
    maxOutputTokens: 400,
    temperature: 0.7,
  })

  const agentId = await getAgentId()

  after(async () => {
    try {
      await logChatUsage({
        profileId: user.id,
        agentId,
        action: 'value_map_reveal',
        model: OPUS_MODEL,
        tokensIn: result.usage.inputTokens ?? 0,
        tokensOut: result.usage.outputTokens ?? 0,
        durationMs: Date.now() - startTime,
      })
    } catch {
      // Best-effort logging
    }
  })

  return Response.json({ observations: result.text })
}
