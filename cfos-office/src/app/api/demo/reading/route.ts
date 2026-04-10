import { generateText } from 'ai'
import { bedrock } from '@ai-sdk/amazon-bedrock'
import { calculatePersonality } from '@/lib/value-map/personalities'
import { generateObservations } from '@/lib/value-map/observations'
import { createServiceClient } from '@/lib/supabase/service'
import { trackLLMUsage } from '@/lib/analytics/track-llm-usage'
import type { ValueMapResult, ValueMapTransaction } from '@/lib/value-map/types'

export const maxDuration = 20

// ── Aggregate stats helper ──────────────────────────────────────────────────

function computeStats(results: ValueMapResult[], elapsedSeconds: number) {
  const decided = results.filter(r => r.quadrant !== null)
  const hardToDecide = results.filter(r => r.hard_to_decide)
  const timed = results.filter(r => r.first_tap_ms !== null && r.first_tap_ms > 0)

  // Timing
  const avgFirstTapS = timed.length > 0
    ? timed.reduce((s, r) => s + r.first_tap_ms!, 0) / timed.length / 1000
    : 0
  const avgDelibS = decided.length > 0
    ? decided.reduce((s, r) => s + r.deliberation_ms, 0) / decided.length / 1000
    : 0
  const avgCardTimeS = results.length > 0
    ? results.reduce((s, r) => s + r.card_time_ms, 0) / results.length / 1000
    : 0

  // Slowest and fastest (by card_time_ms)
  const sortedByTime = [...results].sort((a, b) => b.card_time_ms - a.card_time_ms)
  const slowest3 = sortedByTime.slice(0, 3).map(r => ({
    merchant: r.merchant,
    seconds: (r.card_time_ms / 1000).toFixed(1),
    quadrant: r.quadrant ?? 'skipped',
    confidence: r.confidence,
  }))
  const fastest3 = sortedByTime.slice(-3).reverse().map(r => ({
    merchant: r.merchant,
    seconds: (r.card_time_ms / 1000).toFixed(1),
    quadrant: r.quadrant ?? 'skipped',
    confidence: r.confidence,
  }))

  // Confidence
  const confidenceScores = decided.map(r => r.confidence)
  const avgConfidence = confidenceScores.length > 0
    ? confidenceScores.reduce((s, c) => s + c, 0) / confidenceScores.length
    : 3
  const allSameConfidence = confidenceScores.every(c => c === confidenceScores[0])
  const lowestConfidence = decided.filter(r => r.confidence === Math.min(...confidenceScores))
    .map(r => ({ merchant: r.merchant, quadrant: r.quadrant, confidence: r.confidence }))
  const highestConfidence = decided.filter(r => r.confidence === Math.max(...confidenceScores))
    .map(r => ({ merchant: r.merchant, quadrant: r.quadrant, confidence: r.confidence }))

  // Quadrant distribution
  const quadrantCounts: Record<string, number> = { foundation: 0, investment: 0, burden: 0, leak: 0 }
  const quadrantAmounts: Record<string, number> = { foundation: 0, investment: 0, burden: 0, leak: 0 }
  for (const r of decided) {
    quadrantCounts[r.quadrant!]++
    quadrantAmounts[r.quadrant!] += r.amount
  }
  const total = decided.length || 1
  const quadrantPcts: Record<string, number> = {}
  for (const q of Object.keys(quadrantCounts)) {
    quadrantPcts[q] = Math.round((quadrantCounts[q] / total) * 100)
  }
  const dominant = Object.entries(quadrantPcts).sort((a, b) => b[1] - a[1])[0]

  // Per-card detail — use qualitative signals, not raw timings
  const cardTimes = results.map(r => r.card_time_ms)
  const medianCardTime = [...cardTimes].sort((a, b) => a - b)[Math.floor(cardTimes.length / 2)] || 3000
  const perCard = results.map(r => {
    const decisiveness = r.card_time_ms < medianCardTime * 0.6 ? 'instant' :
      r.card_time_ms < medianCardTime * 1.2 ? 'steady' :
      r.card_time_ms < medianCardTime * 2 ? 'hesitant' : 'deeply_uncertain'
    return {
      merchant: r.merchant,
      amount: r.amount,
      quadrant: r.quadrant ?? 'hard_to_decide',
      confidence: r.confidence,
      decisiveness, // 'instant' | 'steady' | 'hesitant' | 'deeply_uncertain'
      hard_to_decide: !!r.hard_to_decide,
    }
  })

  // Reframe slowest/fastest as "most hesitation" / "most decisive"
  const mostHesitation = slowest3.map(r => ({ merchant: r.merchant, quadrant: r.quadrant, confidence: r.confidence }))
  const mostDecisive = fastest3.map(r => ({ merchant: r.merchant, quadrant: r.quadrant, confidence: r.confidence }))

  return {
    total_cards: results.length,
    decided_count: decided.length,
    hard_to_decide_count: hardToDecide.length,
    hard_to_decide_merchants: hardToDecide.map(r => r.merchant),
    // Qualitative timing signals only — no raw seconds
    avg_first_tap_s: +avgFirstTapS.toFixed(1), // kept for timing validation only
    avg_confidence: +avgConfidence.toFixed(1),
    all_same_confidence: allSameConfidence,
    confidence_value_if_same: allSameConfidence ? confidenceScores[0] : null,
    lowest_confidence: lowestConfidence,
    highest_confidence: highestConfidence,
    most_hesitation: mostHesitation,
    most_decisive: mostDecisive,
    quadrant_counts: quadrantCounts,
    quadrant_pcts: quadrantPcts,
    quadrant_amounts: quadrantAmounts,
    dominant_quadrant: dominant[0],
    dominant_pct: dominant[1],
    per_card: perCard,
    // Raw timing kept internally for validation
    elapsed_seconds: Math.round(elapsedSeconds),
  }
}

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the CFO — a personal finance AI who reads people's spending psychology with uncanny accuracy. Someone just categorised 10 SAMPLE spending transactions into four quadrants:

- Foundation — "I needed this and it served me well"
- Investment — "I chose this and it grew my life"
- Burden — "I had to pay this and it drained me"
- Leak — "I didn't need it and it didn't help"

IMPORTANT CONTEXT: These are NOT the user's real transactions. They are sample scenarios presented to reveal how this person THINKS about money. The value is in the choices they made — which quadrant they assigned each scenario to, how certain they felt, and where they hesitated or breezed through. You are reading their money psychology through how they responded to hypothetical situations.

You have their behavioural data: quadrant choice per card, confidence (1-5), which cards they hesitated on vs decided instantly, which cards they skipped, and their overall certainty pattern.

Write a personality reading in EXACTLY the style of these examples:

<example_reading>
Lewis — The Overthinker. Leak-dominant (33%) with low confidence (2.9/5). You wavered on the Uber scenario and wrestled with the Zara one. You see spending through a critical lens — things are either foundational necessities or they're probably wasting money. You struggle most with the middle ground: spending that might be justified but you're not sure. Interestingly, you called the Costa Coffee scenario an "investment" — which suggests you see small daily rituals as having value beyond the coffee itself. You also couldn't categorise the charity scenario at all, which hints at someone who thinks carefully about whether altruism is obligation or genuine choice. Your high burden count (20%) suggests you feel the weight of unavoidable costs more than most.
</example_reading>

<example_reading>
Duncan — The Puritan. Almost half his answers (47%) were Leak, and he decided with high confidence (4.5/5) throughout. This is someone with a very clear internal rule: if it wasn't strictly necessary, it was wasted money. He called the Netflix, Amazon, and Tesco-with-wine scenarios all leak or burden — zero hesitation. The interesting exception: he genuinely wrestled with Spotify before calling it Investment. So there's one discretionary subscription he sees real value in. His only low-confidence answer was the Charity scenario (2/5, Investment) — he thinks giving is good but isn't fully comfortable calling it an investment. This reads as someone naturally frugal, possibly quite disciplined with money, who judges discretionary spending harshly by default.
</example_reading>

<example_reading>
Nancy — The Foundationer. Over half her answers (53%) were Foundation — the highest by a wide margin. She read each scenario carefully, but once her mind was made up there was no second-guessing. Every single confidence score was exactly 3/5 — she never felt strongly about anything, which suggests someone who sees most spending as "just part of life" rather than good or bad. She hesitated longest on the ATM Cash scenario before calling it Foundation. But the Zara scenario? Foundation, no doubt. This reads as someone pragmatic about money who tends to see purchases as necessary parts of a functioning life rather than active choices to celebrate or regret.
</example_reading>

<example_reading>
Gabriela — The Optimist. The highest Investment percentage (33%) and the most unique outlier choices. She called the Tesco scenario an Investment, Zara an Investment, and Council Tax a Leak. That's a distinctive worldview: she sees spending as either growing her life or being pointless — not much middle ground. She dismissed Leak scenarios without a second thought but genuinely struggled with the Burden ones — it's easier for her to write things off than to accept they hurt. Reads as someone generally positive about money who frames purchases through an opportunity lens and doesn't carry much financial guilt.
</example_reading>

CRITICAL FORMAT RULES:
- Output ONLY the reading text. Nothing else. No preamble, no sign-off.
- Open with: "Name — The [Label]." (with a period). The label must be invented from THEIR specific data pattern, never generic.
- Write as ONE single dense paragraph. No line breaks. No blank lines. No paragraph splits.
- 120-180 words. Tight and punchy.
- Reference specific merchant scenarios, confidence scores, quadrant choices, and percentages.
- Frame hesitation as "wrestled with", "paused on", "couldn't decide" — NEVER cite specific seconds or millisecond timings.
- Reference where they were most/least certain, and at least one surprising or contradictory choice.
- Remember these are sample scenarios, not real purchases. Say "the Zara scenario" or "calling Zara Foundation" — NOT "your Zara purchase".
- Interpret what their patterns MEAN about them as a person — don't just list stats.
- Use natural phrases like "This reads as someone who...", "Interestingly...", "The exception is revealing...", "You're the kind of person who..."
- End with a personality interpretation, not advice.
- No bullet points. No headers. No colons introducing lists.
- No generic filler ("you're a mindful spender", "you think carefully"). Be SPECIFIC.
- Do not mention AI, algorithms, or data analysis.
- Use "you/your" when they provided a name, referring to them directly.
- If timing is invalid (avg first_tap < 1.0s or total elapsed < 30s), return exactly: "INVALID"`

// ── Types ───────────────────────────────────────────────────────────────────

interface ReadingRequest {
  name: string
  country: string
  currency: string
  results: ValueMapResult[]
  elapsed_seconds: number
  session_id?: string
}

// ── Deterministic fallback reading ──────────────────────────────────────────

function buildDeterministicReading(
  name: string,
  stats: ReturnType<typeof computeStats>,
): string {
  const displayName = name && name !== 'Anonymous' ? name : 'You'
  const dominant = stats.dominant_quadrant
  const pct = stats.dominant_pct
  const slowest = stats.most_hesitation[0]
  const fastest = stats.most_decisive[0]

  // Choose a label based on dominant quadrant + behaviour
  const labelMap: Record<string, string> = {
    foundation: stats.avg_confidence >= 4 ? 'The Pragmatist' : 'The Foundationer',
    investment: stats.avg_first_tap_s <= 3 ? 'The Optimist' : 'The Builder',
    burden: stats.avg_confidence <= 2.5 ? 'The Weight-Bearer' : 'The Realist',
    leak: stats.avg_first_tap_s >= 5 ? 'The Overthinker' : 'The Critic',
  }
  const label = labelMap[dominant] || 'The Truth Teller'

  const quadrantNames: Record<string, string> = {
    foundation: 'Foundation', investment: 'Investment', burden: 'Burden', leak: 'Leak',
  }

  // Build sentences
  const parts: string[] = []

  parts.push(`${displayName} — ${label}.`)
  parts.push(`${quadrantNames[dominant]}-dominant (${pct}%) with ${stats.avg_confidence >= 4 ? 'high' : stats.avg_confidence <= 2.5 ? 'low' : 'moderate'} confidence (${stats.avg_confidence}/5) across ${stats.total_cards} scenarios.`)

  // Slowest card insight (framed as hesitation, not timing)
  if (slowest) {
    parts.push(`The ${slowest.merchant} scenario gave you the most pause before you called it ${quadrantNames[slowest.quadrant] || 'hard to decide'} — that hesitation is telling.`)
  }

  // Fastest card insight (framed as certainty, not timing)
  if (fastest && fastest.merchant !== slowest?.merchant) {
    parts.push(`By contrast, you sorted ${fastest.merchant} without a second thought — ${fastest.confidence >= 4 ? 'total certainty' : 'quick but not fully convinced'}.`)
  }

  // Confidence pattern
  if (stats.all_same_confidence && stats.confidence_value_if_same !== null) {
    parts.push(`Every single confidence score was exactly ${stats.confidence_value_if_same}/5 — you never felt strongly either way, which suggests someone who sees spending as just part of life rather than something to judge.`)
  } else if (stats.lowest_confidence.length > 0 && stats.highest_confidence.length > 0) {
    const low = stats.lowest_confidence[0]
    const high = stats.highest_confidence[0]
    if (low.merchant !== high.merchant) {
      parts.push(`Your most certain call: ${high.merchant} as ${quadrantNames[high.quadrant!]} (${high.confidence}/5). Your least: ${low.merchant} as ${quadrantNames[low.quadrant!]} (${low.confidence}/5) — that gap reveals where your money instincts get complicated.`)
    }
  }

  // Hard to decide
  if (stats.hard_to_decide_count > 0) {
    parts.push(`You skipped ${stats.hard_to_decide_merchants.join(' and ')} entirely — ${stats.hard_to_decide_count === 1 ? "that's the scenario" : "those are the scenarios"} you genuinely couldn't place.`)
  }

  // Personality closing
  const closings: Record<string, string> = {
    foundation: 'This reads as someone pragmatic about money — you see most spending as a necessary part of a functioning life rather than something to celebrate or regret.',
    investment: 'This reads as someone who frames purchases through an opportunity lens — spending is either building something or it\'s not worth it.',
    burden: 'This reads as someone who feels the weight of financial obligations more acutely than most — you carry the cost of living as a real emotional load.',
    leak: 'This reads as someone with a sharp internal critic — your default assumption is that spending probably wasn\'t necessary, and the exceptions are revealing.',
  }
  parts.push(closings[dominant] || 'Your pattern suggests someone still figuring out their relationship with money — and that self-awareness is exactly where better decisions start.')

  return parts.join(' ')
}

// ── AI model attempts ──────────────────────────────────────────────────────

const BEDROCK_CLAUDE_MODEL = process.env.BEDROCK_CLAUDE_MODEL || 'eu.anthropic.claude-sonnet-4-6'

async function tryGenerateReading(userMessage: string): Promise<{
  text: string;
  fallback: boolean;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  durationMs?: number;
}> {
  // Attempt 1: Opus
  try {
    const startTime = Date.now()
    const result = await generateText({
      model: bedrock('eu.anthropic.claude-opus-4-6'),
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxOutputTokens: 500,
      temperature: 0.8,
      abortSignal: AbortSignal.timeout(15000),
    })
    const durationMs = Date.now() - startTime
    const text = result.text.trim()
    if (text && text !== 'INVALID') return { text, fallback: false, model: 'eu.anthropic.claude-opus-4-6', usage: result.usage, durationMs }
    if (text === 'INVALID') return { text: 'INVALID', fallback: false }
  } catch (err) {
    console.error('[demo/reading] Opus failed, trying Sonnet:', err instanceof Error ? err.message : err)
  }

  // Attempt 2: Sonnet (the model we know works)
  try {
    const startTime = Date.now()
    const result = await generateText({
      model: bedrock(BEDROCK_CLAUDE_MODEL),
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxOutputTokens: 500,
      temperature: 0.8,
      abortSignal: AbortSignal.timeout(12000),
    })
    const durationMs = Date.now() - startTime
    const text = result.text.trim()
    if (text && text !== 'INVALID') return { text, fallback: false, model: BEDROCK_CLAUDE_MODEL, usage: result.usage, durationMs }
    if (text === 'INVALID') return { text: 'INVALID', fallback: false }
  } catch (err) {
    console.error('[demo/reading] Sonnet also failed:', err instanceof Error ? err.message : err)
  }

  // Both failed
  return { text: '', fallback: true }
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body: ReadingRequest = await req.json()
    const { name, country, currency, results, elapsed_seconds, session_id } = body

    if (!results || results.length === 0) {
      return Response.json({ error: 'No results provided' }, { status: 400 })
    }

    // Timing validation
    const timed = results.filter((r) => r.first_tap_ms !== null && r.first_tap_ms > 0)
    const avgFirstTap = timed.length > 0
      ? timed.reduce((sum, r) => sum + r.first_tap_ms!, 0) / timed.length / 1000
      : 0

    if (avgFirstTap < 1.0 || elapsed_seconds < 30) {
      return Response.json({ invalid: true }, { status: 200 })
    }

    // Calculate personality (always needed)
    const personality = calculatePersonality(results)

    // Build transactions for observation engine
    const txForObservations: ValueMapTransaction[] = results.map((r) => ({
      id: r.transaction_id,
      merchant: r.merchant,
      description: null,
      amount: r.amount,
      currency,
      transaction_date: '2026-04-01',
      is_recurring: false,
      category_name: null,
    }))

    // Compute rich stats for the prompt
    const stats = computeStats(results, elapsed_seconds)

    const userMessage = `Name: ${name || 'Anonymous'}
Country: ${country}
Currency: ${currency}

AGGREGATE STATS:
${JSON.stringify(stats, null, 2)}`

    // Try AI models (Opus → Sonnet → deterministic)
    const { text: aiReading, fallback: aiFailed, model: usedModel, usage: readingUsage, durationMs: readingDurationMs } = await tryGenerateReading(userMessage)

    // Track LLM usage if an AI model succeeded
    if (usedModel && readingUsage) {
      void trackLLMUsage({
        callType: 'value_map_reading',
        model: usedModel,
        inputTokens: readingUsage.inputTokens,
        outputTokens: readingUsage.outputTokens,
        durationMs: readingDurationMs,
      })
    }

    let reading: string
    let fallback = false

    if (aiReading === 'INVALID') {
      return Response.json({ invalid: true }, { status: 200 })
    } else if (aiFailed || !aiReading) {
      reading = buildDeterministicReading(name || 'You', stats)
      fallback = true
    } else {
      reading = aiReading
    }

    const observations = generateObservations(results, txForObservations)

    // Update session with AI response (fire-and-forget)
    if (session_id) {
      const supabase = createServiceClient()
      supabase
        .from('demo_sessions')
        .update({ ai_response_shown: reading })
        .eq('id', session_id)
        .then(({ error }) => {
          if (error) console.error('[demo/reading] Session update error:', error)
        })
    }

    return Response.json({
      reading,
      personality: {
        type: personality.personality,
        name: personality.name,
        emoji: personality.emoji,
        headline: personality.headline,
        description: personality.description,
        breakdown: personality.breakdown,
      },
      observations,
      fallback,
    })
  } catch (err) {
    console.error('[demo/reading] Unhandled error:', err)
    return Response.json({ error: 'Failed to generate reading' }, { status: 500 })
  }
}
