import { NextRequest, NextResponse } from 'next/server'
import { generateText } from 'ai'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { chatModel, chatModelId } from '@/lib/ai/provider'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
import { logBedrockUsage } from '@/lib/ai/usage-logger'
import { sendAlert } from '@/lib/alerts/notify'
import { PROPERTY_DECISION, PROPERTY_SLOTS } from '@/lib/models/registry'
import { MARKET_DEFAULTS } from '@/lib/models/marketDefaults'

const RequestSchema = z.object({
  runId: z.string().uuid(),
  message: z.string().min(1),
})

const InterviewerResponseSchema = z.object({
  extracted: z.array(
    z.object({
      id: z.string(),
      value: z.number(),
      origin: z.enum(['user', 'market']),
    })
  ),
  challenge: z.string().nullable(),
  reply: z.string(),
  done: z.boolean(),
})

function buildPrompt(
  filled: Record<string, number>,
  remaining: string[],
  history: string
): string {
  const schemaBrief = PROPERTY_SLOTS.map(
    (s) => `${s.id} (${s.label}, ${s.unit}${s.required ? ', REQUIRED' : ''})`
  ).join('; ')
  const defaultsBrief = Object.entries(MARKET_DEFAULTS)
    .map(([k, d]) => `${k}=${d.value} (${d.source})`)
    .join('; ')

  return `You are the interviewer inside a CFO tool modelling a property decision: keep-and-rent-out vs sell-and-invest vs sell-and-hold-cash vs sell-and-redeploy into a new home. Currency is GBP.

You NEVER do arithmetic and NEVER state results. A deterministic engine computes everything. Your only jobs: extract slot values from the user's words, challenge values that look off versus market averages, and ask the next question.

SLOT SCHEMA: ${schemaBrief}
ALREADY FILLED: ${JSON.stringify(filled)}
REMAINING (priority order): ${remaining.join(', ') || 'none — required slots complete'}
MARKET REFERENCE VALUES: ${defaultsBrief}

CONVERSATION SO FAR:
${history}

RULES:
1. Extract every slot value present in the user's latest message. Users may answer several at once, give ranges (take the midpoint and say so), use "k"/"m" shorthand, or revise earlier answers. Values must be plain numbers. Percentages as numbers, e.g. 33.3 not 0.333.
2. If a user-stated value deviates more than ~20% from a market reference, set "challenge" to ONE short sentence naming the market figure and saying you'll keep their number. Otherwise "challenge" is null.
3. Ask exactly ONE next question, targeting the first remaining slot. Plain language, one sentence. If the user seems unsure, offer to proceed with a market default.
4. If a user asks to use a default or says "you pick", extract the market reference value with origin "market".
5. After the required slots are filled, ask once: "Would selling fund another property purchase?" If yes, ask for new_property_price and current_rent_paid_monthly next. If no, treat scenario 4 as skipped and move to done.
6. If a user states they would never rent the place out, extract will_never_let_flag=1 with origin "user".
7. If nothing remains, set done=true and reply with one short line handing off to the results panel.
8. Keep replies under 45 words. Warm but flat.
9. Never say "advice" or "advise". This is decision support, not a recommendation.

Respond with ONLY raw JSON, no markdown fences, exactly this shape:
{"extracted":[{"id":"slot_id","value":123,"origin":"user"}],"challenge":null,"reply":"...","done":false}`
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsedReq = RequestSchema.safeParse(body)
  if (!parsedReq.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { runId, message } = parsedReq.data

  const { data: run, error: fetchError } = await supabase
    .from('model_runs')
    .select('assumptions, messages')
    .eq('id', runId)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  const assumptions = run.assumptions as Record<string, { value: number; origin: string }>
  const messages = run.messages as Array<{ role: string; text: string }>

  const filled: Record<string, number> = {}
  for (const [id, entry] of Object.entries(assumptions)) {
    if (entry?.value !== undefined) filled[id] = entry.value
  }
  const remaining = PROPERTY_DECISION.interview
    .flatMap((n) => n.targetSlots)
    .filter((id) => !(id in filled))

  const nextMessages = [...messages, { role: 'user', text: message }]
  const history = nextMessages
    .slice(-14)
    .map((m) => `${m.role === 'user' ? 'USER' : 'CFO'}: ${m.text}`)
    .join('\n')

  const prompt = buildPrompt(filled, remaining, history)

  let text: string
  try {
    const startTime = Date.now()
    const result = await generateText({ model: chatModel, messages: [{ role: 'user', content: prompt }] })
    text = result.text
    const durationMs = Date.now() - startTime

    void trackLLMUsage({
      userId: user.id,
      callType: 'models_interviewer',
      model: chatModelId,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      durationMs,
      metadata: { run_id: runId },
    })
    logBedrockUsage({
      callSite: 'models_interviewer',
      model: 'sonnet',
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      userId: user.id,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[models/interviewer] bedrock call failed', { error, runId })
    void sendAlert({
      severity: 'critical',
      event: 'models_interviewer_bedrock_failed',
      user_id: user.id,
      details: `Bedrock call failed for run ${runId}: ${msg}`,
      metadata: { model: chatModelId, runId },
    })
    return NextResponse.json({
      reply: "The interviewer dropped the connection — say that again, or fill the value straight into the ledger.",
      extracted: [],
      done: false,
    })
  }

  const parseAttempt = (raw: string) => {
    const cleaned = raw.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
    return InterviewerResponseSchema.safeParse(JSON.parse(cleaned))
  }

  let parsed
  try {
    parsed = parseAttempt(text)
  } catch {
    parsed = { success: false as const }
  }

  if (!parsed.success) {
    // Retry once with a stricter reminder, then apologise.
    try {
      const retry = await generateText({
        model: chatModel,
        messages: [{ role: 'user', content: `${prompt}\n\nYour previous response was not valid JSON. Return ONLY the raw JSON object, nothing else.` }],
      })
      parsed = parseAttempt(retry.text)
    } catch {
      parsed = { success: false as const }
    }
  }

  if (!parsed.success) {
    console.error('[models/interviewer] unparseable response', { runId, responsePreview: text.slice(0, 500) })
    void sendAlert({
      severity: 'warning',
      event: 'models_interviewer_unparseable',
      user_id: user.id,
      details: `Could not parse interviewer response for run ${runId}`,
      metadata: { runId, responsePreview: text.slice(0, 500) },
    })
    return NextResponse.json({
      reply: "Couldn't parse that — mind rephrasing, or fill the value straight into the ledger?",
      extracted: [],
      done: false,
    })
  }

  // Closed world — drop any slot id the registry doesn't recognise.
  const knownIds = new Set(PROPERTY_SLOTS.map((s) => s.id))
  const validExtractions = parsed.data.extracted.filter((e) => knownIds.has(e.id))

  const updatedAssumptions = { ...assumptions }
  for (const e of validExtractions) {
    updatedAssumptions[e.id] = { value: e.value, origin: e.origin }
  }

  // Profile-tier slots also seed user_financial_profile for future runs.
  const horizonExtraction = validExtractions.find((e) => e.id === 'horizon_years')
  if (horizonExtraction) {
    await supabase.from('user_financial_profile').upsert(
      { user_id: user.id, default_horizon_years: Math.round(horizonExtraction.value), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  }

  const replyParts = [parsed.data.challenge, parsed.data.reply].filter(Boolean)
  const finalMessages = [
    ...nextMessages,
    { role: 'assistant', text: replyParts.join(' ') || 'Noted.', challenge: Boolean(parsed.data.challenge), done: parsed.data.done },
  ]

  const { error: updateError } = await supabase
    .from('model_runs')
    .update({
      assumptions: updatedAssumptions,
      messages: finalMessages,
      status: parsed.data.done ? 'complete' : 'interviewing',
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
    .eq('user_id', user.id)

  if (updateError) {
    console.error('[models/interviewer] persist error:', updateError)
    return NextResponse.json({ error: 'Failed to save interview progress' }, { status: 500 })
  }

  return NextResponse.json({
    extracted: validExtractions,
    challenge: parsed.data.challenge,
    reply: parsed.data.reply,
    done: parsed.data.done,
  })
}
