import { streamText } from 'ai'
import { bedrock } from '@ai-sdk/amazon-bedrock'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/chat/rate-limit'
import { logChatUsage } from '@/lib/chat/cost-tracker'
import { persistMessages } from '@/lib/chat/persist-messages'

const BEDROCK_MODEL = process.env.BEDROCK_CLAUDE_MODEL ?? 'eu.anthropic.claude-sonnet-4-6'

let cachedAgentId: string | null = null

async function getAgentId(): Promise<string> {
  if (cachedAgentId) return cachedAgentId
  const supabase = await createClient()
  const { data } = await supabase
    .from('agents')
    .select('id')
    .eq('slug', 'general-cfo')
    .single()
  cachedAgentId = data?.id ?? 'unknown'
  return cachedAgentId as string
}

function buildValueMapSystemPrompt(currency: string, isRealData: boolean, personality: string): string {
  const sym = { GBP: '\u00A3', USD: '$', EUR: '\u20AC' }[currency] ?? currency

  return `You are the user's personal CFO. You've just watched them categorise their spending into four value quadrants:

- Foundation (blue): Necessary + Beneficial — bills, groceries, insurance
- Investment (green): Chosen + Beneficial — gym, courses, social spending
- Burden (amber): Necessary + Draining — debt, fines, unavoidable costs
- Leak (red): Chosen + Draining — impulse buys, unused subscriptions

Their Money Personality is: ${personality}
${isRealData ? 'These are their real transactions.' : 'These are example transactions — they haven\'t uploaded real data yet.'}

Write a 2-3 paragraph personalised narrative about their spending pattern. Rules:
- Reference specific merchants and amounts from their results
- Use the currency symbol ${sym} when mentioning amounts
- Be direct, warm, and specific — not generic motivational fluff
- If they have Leak spending: quantify the annual cost and suggest where to redirect it
- If Foundation is dominant: acknowledge stability but probe for optimisation
- If Burden is high: empathise and suggest concrete next steps (refinance, switch, negotiate)
- If Investment is strong: validate it but check if foundations are solid
- End with ONE clear, specific next action they should take
- Keep it under 200 words
- Do not use bullet points — write in flowing paragraphs
- Do not say "I'm an AI" or "as your AI assistant"
${!isRealData ? '- Since this is example data, encourage them to upload their own transactions for real insights' : ''}
- Sign off naturally as their CFO — no formal sign-off needed`
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
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded. Try again later.',
        resetAt: limit.resetAt?.toISOString(),
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': limit.resetAt
            ? String(Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000))
            : '3600',
        },
      },
    )
  }

  const { messages, currency, isRealData, personality } = await req.json()

  // Convert UIMessage[] to CoreMessage[]
  type UIPart = { type: string; text?: string }
  const modelMessages = (
    messages as Array<{ role: string; content?: string; parts?: UIPart[] }>
  ).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.parts
      ? m.parts
          .filter((p) => p.type === 'text')
          .map((p) => p.text ?? '')
          .join('')
      : (m.content ?? ''),
  }))

  const [systemPrompt, agentId] = await Promise.all([
    Promise.resolve(buildValueMapSystemPrompt(currency ?? 'GBP', isRealData ?? false, personality ?? 'truth_teller')),
    getAgentId(),
  ])

  const result = streamText({
    model: bedrock(BEDROCK_MODEL),
    system: systemPrompt,
    messages: modelMessages,
  })

  after(async () => {
    try {
      const [usage, fullText] = await Promise.all([result.usage, result.text])
      await logChatUsage({
        profileId: user.id,
        agentId,
        action: 'value_map_summary',
        model: BEDROCK_MODEL,
        tokensIn: usage.inputTokens ?? 0,
        tokensOut: usage.outputTokens ?? 0,
        durationMs: Date.now() - startTime,
      })
      const lastUserMsg = modelMessages.filter(m => m.role === 'user').pop()
      if (lastUserMsg) {
        await persistMessages({
          profileId: user.id,
          sessionId: `value-map-${Date.now()}`,
          chatType: 'onboarding',
          userMessage: lastUserMsg.content,
          assistantMessage: fullText,
          metadata: { type: 'value_map_summary', personality, isRealData, model: BEDROCK_MODEL },
        })
      }
    } catch {
      // Best-effort persistence
    }
  })

  return result.toUIMessageStreamResponse()
}
