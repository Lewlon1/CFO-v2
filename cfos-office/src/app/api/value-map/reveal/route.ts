import { generateText } from 'ai'
import { bedrock } from '@ai-sdk/amazon-bedrock'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/chat/rate-limit'
import { logChatUsage } from '@/lib/chat/cost-tracker'

const OPUS_MODEL = process.env.BEDROCK_OPUS_MODEL ?? 'eu.anthropic.claude-opus-4-6'

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

  return `You are the CFO in a personal finance app. A user just completed a Value Map exercise where they categorised transactions into four quadrants: Foundation (needed it, served me), Investment (chose it, grew me), Burden (had to, it hurt), Leak (didn't need, didn't help).

You have their complete results: merchant name, quadrant, confidence (1–5), first_tap_ms (hesitation before first tap), and deliberation_ms (time deliberating after tapping).

The system has classified this user as "${personalityName}" — ${dominantQuadrant}-dominant at ${dominantPct}%, average confidence ${avgConfidence}/5.

Write a psychological profile in three short paragraphs (separated by a single blank line). No bullet points. No headers.

Paragraph 1 — The headline: Start with "${personalityName}." then one or two sentences capturing the dominant pattern and the underlying psychological worldview it reveals — not just habits, but how this person *relates* to spending itself. Mention the dominant quadrant percentage and average confidence naturally.

Paragraph 2 — The evidence: Work through the 3–4 most revealing individual decisions. Cover the most interesting of: contradictions (same category, different quadrant for two merchants), highest-confidence calls (5/5), notable hesitation spikes (unusually high first_tap_ms), and any outliers that cut against the dominant pattern. Name every merchant specifically. Say what each decision reveals about values or psychology — not just "you called X a Y" but what the choice *means*.

Paragraph 3 — The synthesis: One sentence. A character sketch that captures who this person is with money. Something that makes them think "that's exactly right."

Style rules:
- Second person ("you", "your")
- Use *italics* (asterisks) sparingly for a single revealing word or phrase
- Warm but direct — no filler, no platitudes, no generic financial advice
- Every sentence must earn its place
- Total length: 150–220 words
- Only use the currency symbol ${sym} when referencing a specific amount`
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

  const limit = await checkRateLimit(user.id)
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
