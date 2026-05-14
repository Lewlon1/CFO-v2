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

const SYSTEM_PROMPT = `You are the CFO. Someone just categorised 10 SAMPLE spending scenarios into four quadrants:

- Foundation — "needed and served"
- Investment — "chosen and grew"
- Burden — "had to and drained"
- Leak — "didn't need, didn't help"

IMPORTANT CONTEXT: These are NOT the user's real transactions. They are sample scenarios used to surface the user's classification pattern. The value is in the choices they made — which quadrant they assigned each scenario, how certain they felt, and where they hesitated or breezed through. Read the pattern in the data; do not characterise the person.

You have their behavioural data: quadrant choice per card, confidence (1-5), which cards they hesitated on vs decided instantly, which cards they skipped, and their overall certainty pattern.

Write an observational reading in EXACTLY the style of these examples:

<example_reading>
Lewis. Leak-dominant (33%) with low average confidence (2.9/5). You wavered on the Uber scenario and wrestled with the Zara one. Two-thirds of your Leak calls came in below 3/5 confidence — the pattern shows recognition of waste alongside uncertainty about which costs count. The Costa Coffee scenario was the one item you called Investment — a small daily ritual classified as growth rather than expense. The charity scenario went unsorted: not a Leak, not a Burden, not an Investment in the data. Burden share sits at 20%, above the dataset average. Pattern: low-confidence Leak calls cluster around discretionary subscriptions; the cleanest calls are the ones tagged Foundation.
</example_reading>

<example_reading>
Duncan. Leak-dominant (47%) with high confidence (4.5/5). Netflix, Amazon, and the Tesco-with-wine scenario all classified Leak or Burden, zero hesitation. The Spotify scenario was the exception — wrestled with before being called Investment. The Charity scenario came in at 2/5 confidence, classified Investment. Pattern: a high-confidence boundary between strict necessity and everything else, with one named exception (Spotify) and one unresolved category (charity).
</example_reading>

<example_reading>
Nancy. Foundation-dominant (53%), the largest share in the dataset. Every confidence score was exactly 3/5. The ATM Cash scenario took the longest to call before being placed in Foundation. Zara was tagged Foundation without hesitation. Pattern: a flat-confidence read where most items are classified as part of standard life rather than as choices to be judged.
</example_reading>

<example_reading>
Gabriela. Investment-dominant (33%), with the most outlier classifications in the dataset. Tesco was called Investment, Zara was called Investment, Council Tax was called Leak. The Leak quadrant was decided quickly across the board; the Burden quadrant took longer. Pattern: the split between Investment and Leak is wide and confident; the Burden category sits unresolved.
</example_reading>

CRITICAL FORMAT RULES:
- Output ONLY the reading text. Nothing else. No preamble, no sign-off.
- Open with: "Name." (with a period). No characterological label. No "The X" framing.
- Write as ONE single dense paragraph. No line breaks. No blank lines. No paragraph splits.
- 120-180 words. Tight and punchy.
- Reference specific merchant scenarios, confidence scores, quadrant choices, and percentages.
- Frame hesitation as "wrestled with", "paused on", "couldn't decide" — NEVER cite specific seconds or millisecond timings.
- Reference where the user was most/least certain, and at least one outlier choice.
- Remember these are sample scenarios, not real purchases. Say "the Zara scenario" or "calling Zara Foundation" — NOT "your Zara purchase".
- Describe the pattern in the data. Do not characterise the person. No "you're the kind of person who…", no "this reads as someone who…", no labels.
- Second person only ("you", "your"). Never first person ("I", "me", "my").
- End with a one-sentence observation of the pattern, beginning with "Pattern:" or equivalent. Observation, not judgement.
- No bullet points. No headers. No colons introducing lists.
- No generic filler ("mindful spender", "thinks carefully"). Be SPECIFIC to the data.
- Do not mention AI, algorithms, or data analysis. Do not mention the product name.
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

  const quadrantNames: Record<string, string> = {
    foundation: 'Foundation', investment: 'Investment', burden: 'Burden', leak: 'Leak',
  }

  // Build sentences — observation only, no characterological label.
  const parts: string[] = []

  parts.push(`${displayName}.`)
  parts.push(`${quadrantNames[dominant]}-dominant (${pct}%) with ${stats.avg_confidence >= 4 ? 'high' : stats.avg_confidence <= 2.5 ? 'low' : 'moderate'} confidence (${stats.avg_confidence}/5) across ${stats.total_cards} scenarios.`)

  // Slowest card insight (framed as hesitation, not timing)
  if (slowest) {
    parts.push(`The ${slowest.merchant} scenario was the one you paused longest on before calling it ${quadrantNames[slowest.quadrant] || 'hard to decide'}.`)
  }

  // Fastest card insight (framed as certainty, not timing)
  if (fastest && fastest.merchant !== slowest?.merchant) {
    parts.push(`${fastest.merchant} was sorted ${fastest.confidence >= 4 ? 'with full confidence' : 'quickly but at ' + fastest.confidence + '/5'}.`)
  }

  // Confidence pattern
  if (stats.all_same_confidence && stats.confidence_value_if_same !== null) {
    parts.push(`Every confidence score was exactly ${stats.confidence_value_if_same}/5 — a flat read across the dataset.`)
  } else if (stats.lowest_confidence.length > 0 && stats.highest_confidence.length > 0) {
    const low = stats.lowest_confidence[0]
    const high = stats.highest_confidence[0]
    if (low.merchant !== high.merchant) {
      parts.push(`Most certain call: ${high.merchant} as ${quadrantNames[high.quadrant!]} (${high.confidence}/5). Least certain: ${low.merchant} as ${quadrantNames[low.quadrant!]} (${low.confidence}/5).`)
    }
  }

  // Hard to decide
  if (stats.hard_to_decide_count > 0) {
    parts.push(`${stats.hard_to_decide_merchants.join(' and ')} went unsorted — ${stats.hard_to_decide_count === 1 ? 'that scenario' : 'those scenarios'} did not fit a quadrant.`)
  }

  // Pattern closing — observation, not characterology.
  const closings: Record<string, string> = {
    foundation: 'Pattern: most items classified as part of standard life rather than as choices to evaluate.',
    investment: 'Pattern: spending sorted by whether it grew something; Burden and Leak shares sit below average.',
    burden: 'Pattern: a larger-than-average share of items classified as draining; Foundation share sits close behind.',
    leak: 'Pattern: a higher-than-average share of items classified as Leak; low-confidence calls cluster around the discretionary scenarios.',
  }
  parts.push(closings[dominant] || 'Pattern: classifications spread across all four quadrants without a dominant call.')

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
