// ── Types ─────────────────────────────────────────────────────────────────────

export interface FirstInsightData {
  type: 'gap' | 'confirmation' | 'discovery' | 'summary' | 'needs_categorisation'
  merchant_or_category: string
  user_believed?: {
    category: string
    confidence: number
  }
  reality: {
    description: string
    monthly_amount?: number
    frequency?: string
    trend?: 'increasing' | 'decreasing' | 'stable' | 'inactive'
  }
  financial_impact?: {
    annual_amount: number
    description: string
  }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

export function buildInsightPrompt(
  insightData: FirstInsightData,
  userName: string,
  archetypeName: string,
  currencySymbol: string,
): string {
  let dataBlock: string

  if (insightData.type === 'gap' && insightData.user_believed) {
    dataBlock = `## Insight data (all numbers pre-computed — do NOT recalculate)

Type: Gap (contradiction between belief and reality)
Merchant/Category: ${insightData.merchant_or_category}
User believed: categorised as "${insightData.user_believed.category}" with ${insightData.user_believed.confidence}/5 confidence
Reality: ${insightData.reality.description}
${insightData.reality.monthly_amount ? `Monthly spend: ${currencySymbol}${insightData.reality.monthly_amount.toFixed(2)}` : ''}
${insightData.financial_impact ? `Annual financial impact: ${insightData.financial_impact.description}` : ''}
${insightData.reality.trend ? `Trend: ${insightData.reality.trend}` : ''}`
  } else if (insightData.type === 'confirmation') {
    dataBlock = `## Insight data (all numbers pre-computed)

Type: Confirmation (belief matches reality)
Category: ${insightData.merchant_or_category}
Reality: ${insightData.reality.description}
${insightData.reality.monthly_amount ? `Monthly spend: ${currencySymbol}${insightData.reality.monthly_amount.toFixed(2)}` : ''}`
  } else if (insightData.type === 'needs_categorisation') {
    dataBlock = `## Insight data

Type: Most of the user's transactions aren't categorised yet, so the usual "biggest category" insight isn't useful on its own.
Reality: ${insightData.reality.description}

Guidance for this type:
- Acknowledge warmly that you can't give proper insight until these are categorised
- Offer to review them together — one merchant at a time, with the user in charge
- Don't lecture; treat categorisation as a quick shared task
- Keep energy forward-looking: the review unlocks everything else`
  } else {
    dataBlock = `## Insight data (all numbers pre-computed)

Type: ${insightData.type === 'discovery' ? 'Discovery (new pattern found)' : 'Spending summary'}
Category: ${insightData.merchant_or_category}
Reality: ${insightData.reality.description}
${insightData.reality.monthly_amount ? `Monthly spend: ${currencySymbol}${insightData.reality.monthly_amount.toFixed(2)}` : ''}
${insightData.financial_impact ? `Annual financial impact: ${insightData.financial_impact.description}` : ''}`
  }

  return `You are ${userName}'s personal CFO. Their Money Personality archetype is "${archetypeName}".

You've just finished analysing their first bank statement. Write a 2-3 sentence insight about what stood out most.

${dataBlock}

## Rules

- Write as the CFO speaking directly to ${userName}
- Use the pre-computed numbers exactly as provided — do NOT calculate or estimate any amounts
- Reference their Value Map categorisation if this is a gap-type insight
- Be specific and direct — reference the actual merchant or category by name
- Use the currency symbol ${currencySymbol} for any amounts
- If it's a gap: name the contradiction clearly but without judgement
- If it's a confirmation: acknowledge their self-awareness positively
- If it's a summary: highlight the most notable pattern
- End with a brief forward-looking note connecting to the CFO relationship
- Keep it to 2-3 sentences maximum. Concise, punchy, specific.
- Output plain text (no markdown, no HTML). Just the narrative.`
}

// ── Template-based fallback (no LLM) ──────────────────────────────────────

export function buildTemplateFallback(
  insightData: FirstInsightData,
  currencySymbol: string,
): string {
  const { type, merchant_or_category, user_believed, reality, financial_impact } = insightData

  if (type === 'gap' && user_believed) {
    const impact = financial_impact
      ? ` That's ${financial_impact.description} a year.`
      : ''
    return `You called ${merchant_or_category} ${user_believed.category} with ${user_believed.confidence}/5 confidence. ${reality.description}.${impact} The gap between how you see it and what the numbers say — that's where I'm most useful.`
  }

  if (type === 'confirmation') {
    return `${merchant_or_category}: ${reality.description}. Your instinct matched the data — that's a strong foundation to build on.`
  }

  if (type === 'needs_categorisation') {
    return `${reality.description} Let's run through them together — tell me about a few merchants and I'll take care of the rest.`
  }

  if (reality.monthly_amount) {
    const annual = reality.monthly_amount * 12
    return `Your biggest spending area is ${merchant_or_category} at ${currencySymbol}${reality.monthly_amount.toFixed(0)}/month — that's ${currencySymbol}${annual.toFixed(0)} a year. Worth knowing, even if it's not a surprise.`
  }

  return `${merchant_or_category}: ${reality.description}. There's more to dig into, but this is a good place to start.`
}
