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

function buildRevealSystemPrompt(currency: string, userName: string): string {
  const sym = { GBP: '\u00A3', USD: '$', EUR: '\u20AC' }[currency] ?? currency

  return `You are the CFO in a personal finance app. A user just completed a Value Map exercise where they categorised transactions into four quadrants: Foundation (needed it, served me), Investment (chose it, grew me), Burden (had to, it hurt), Leak (didn't need, didn't help).

You have their complete results including which quadrant they chose for each transaction, how confident they were (1-5), how long they hesitated before their first tap (first_tap_ms), and how long they deliberated after tapping before confirming (deliberation_ms).

Write 2-3 sharp, specific observations about this person's relationship with money. Reference specific merchants by name. Use the timing data — hesitation reveals uncertainty, speed reveals conviction. Use contradictions between similar transactions — these are the most revealing signals.

Be warm but direct. No filler. No generic advice. No "you're a mindful spender" platitudes. Each observation should make them think "how does it know that?"

The user's name is ${userName}. Use the currency symbol ${sym} when referencing amounts.`
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

  const { results, currency, userName } = await req.json()

  const systemPrompt = buildRevealSystemPrompt(currency ?? 'GBP', userName ?? 'there')

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
