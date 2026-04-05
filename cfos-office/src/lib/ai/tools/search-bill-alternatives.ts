import { z } from 'zod'
import { generateObject } from 'ai'
import { analysisModel } from '@/lib/ai/provider'
import { braveSearch } from '@/lib/bills/brave-search'
import { matchProvider, KNOWN_PROVIDERS } from '@/lib/bills/provider-registry'
import { normaliseToMonthly } from '@/lib/bills/normalise'
import type { ToolContext } from './types'

const alternativesSchema = z.object({
  alternatives: z.array(
    z.object({
      provider: z.string(),
      plan_name: z.string(),
      monthly_cost_estimate: z.number(),
      key_features: z.array(z.string()),
      url: z.string().nullable(),
      notes: z.string().nullable(),
    })
  ),
  market_summary: z.string().describe('Brief summary of current market conditions'),
  recommended_action: z.enum([
    'switch_now',
    'switch_at_renewal',
    'stay_current',
    'need_more_info',
  ]),
  potential_monthly_saving: z.number(),
  confidence: z.enum(['high', 'medium', 'low']),
})

export function createSearchBillAlternativesTool(ctx: ToolContext) {
  return {
    description:
      'Research better deals for one of the user\'s recurring bills. Use when the user asks about switching providers, when a bill seems high, or when you notice an optimisation opportunity. Returns current market alternatives with potential savings.',
    inputSchema: z.object({
      bill_type: z
        .enum([
          'electricity',
          'gas',
          'water',
          'internet',
          'mobile',
          'insurance',
        ])
        .describe('Type of bill to research'),
      current_provider: z.string().describe('Current provider name'),
      current_amount: z.number().describe('Current cost per billing period'),
      current_frequency: z.string().default('monthly').describe('Billing frequency'),
      usage_details: z
        .string()
        .optional()
        .describe('Usage details: kWh, Mbps, plan name, etc.'),
      country: z.string().default('ES').describe('Country code'),
    }),
    execute: async ({
      bill_type,
      current_provider,
      current_amount,
      current_frequency,
      usage_details,
      country,
    }: {
      bill_type: string
      current_provider: string
      current_amount: number
      current_frequency: string
      usage_details?: string
      country: string
    }) => {
      try {
        // Water is usually a municipal monopoly — skip research
        if (bill_type === 'water') {
          return {
            current: { provider: current_provider, monthly_cost: normaliseToMonthly(current_amount, current_frequency) },
            alternatives: [],
            recommendation: 'stay_current',
            potential_saving: 0,
            market_summary: 'Water supply is typically a municipal monopoly and cannot be switched.',
            confidence: 'high',
            note: 'Water is provided by your local municipality. There are no alternative providers to compare.',
          }
        }

        const monthlyAmount = normaliseToMonthly(current_amount, current_frequency)
        const countryName = country === 'ES' ? 'Spain' : country === 'UK' ? 'the UK' : country

        // Check for permanencia on this bill
        const { data: billRecord } = await ctx.supabase
          .from('recurring_expenses')
          .select('id, contract_end_date, has_permanencia, current_plan_details')
          .eq('user_id', ctx.userId)
          .ilike('provider', `%${current_provider}%`)
          .limit(1)
          .single()

        // Build search query
        const searchQuery = buildSearchQuery(bill_type, current_provider, countryName, usage_details)
        const searchResults = await braveSearch(searchQuery)

        // Build analysis prompt
        let analysisPrompt = `Analyse alternatives to ${current_provider} for ${bill_type} in ${countryName}.

Current situation:
- Provider: ${current_provider}
- Monthly cost: €${monthlyAmount.toFixed(2)}${current_frequency !== 'monthly' ? ` (billed ${current_frequency}: €${current_amount})` : ''}`

        if (usage_details) {
          analysisPrompt += `\n- Usage details: ${usage_details}`
        }

        if (billRecord?.current_plan_details) {
          const details = billRecord.current_plan_details as Record<string, unknown>
          if (details.tariff_type) analysisPrompt += `\n- Tariff: ${details.tariff_type}`
          if (details.power_contracted_kw) analysisPrompt += `\n- Contracted power: ${details.power_contracted_kw} kW`
          if (details.consumption_kwh) analysisPrompt += `\n- Last consumption: ${details.consumption_kwh} kWh`
          if (details.speed_mbps) analysisPrompt += `\n- Internet speed: ${details.speed_mbps} Mbps`
        }

        if (billRecord?.has_permanencia && billRecord?.contract_end_date) {
          analysisPrompt += `\n- ⚠️ Has permanencia (lock-in) until ${billRecord.contract_end_date}`
        }

        // Add known alternatives from provider registry
        const knownAlternatives = KNOWN_PROVIDERS.filter(
          (p) =>
            p.type === bill_type &&
            p.country === country &&
            p.name.toLowerCase() !== current_provider.toLowerCase()
        )
        if (knownAlternatives.length > 0) {
          analysisPrompt += `\n\nKnown alternative providers in this market: ${knownAlternatives.map((p) => p.name).join(', ')}`
        }

        if (searchResults && searchResults.length > 0) {
          analysisPrompt += `\n\nWeb search results for current market data:\n`
          for (const r of searchResults.slice(0, 6)) {
            analysisPrompt += `- ${r.title}: ${r.description} (${r.url})\n`
          }
        } else {
          analysisPrompt += `\n\nNo web search results available. Base your analysis on your knowledge of the ${countryName} ${bill_type} market.`
        }

        analysisPrompt += `\n\nProvide 2-4 realistic alternative providers/plans. For each, estimate the monthly cost for similar usage. Be conservative — don't invent prices, use known market ranges. Today's date is ${new Date().toISOString().split('T')[0]}.`

        const result = await generateObject({
          model: analysisModel,
          schema: alternativesSchema,
          prompt: analysisPrompt,
        })

        const analysis = result.object

        // Store results on the recurring_expenses row if we found it
        if (billRecord?.id) {
          const existingDetails = (billRecord.current_plan_details || {}) as Record<string, unknown>
          await ctx.supabase
            .from('recurring_expenses')
            .update({
              last_optimisation_check: new Date().toISOString(),
              potential_saving_monthly: analysis.potential_monthly_saving,
              switch_recommendation: analysis.recommended_action,
              current_plan_details: {
                ...existingDetails,
                last_research: {
                  date: new Date().toISOString().split('T')[0],
                  alternatives: analysis.alternatives,
                  market_summary: analysis.market_summary,
                  confidence: analysis.confidence,
                },
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', billRecord.id)
            .eq('user_id', ctx.userId)
        }

        return {
          current: {
            provider: current_provider,
            monthly_cost: monthlyAmount,
            usage: usage_details || 'Not specified',
          },
          alternatives: analysis.alternatives,
          recommendation: analysis.recommended_action,
          potential_saving: analysis.potential_monthly_saving,
          market_summary: analysis.market_summary,
          confidence: analysis.confidence,
          permanencia_warning:
            billRecord?.has_permanencia && billRecord?.contract_end_date
              ? `Contract lock-in until ${billRecord.contract_end_date}. Check early termination fees before switching.`
              : null,
        }
      } catch (err) {
        console.error('[tool:search_bill_alternatives] error:', err)
        return {
          error: 'Could not research alternatives right now. Please try again later.',
        }
      }
    },
  }
}

function buildSearchQuery(
  billType: string,
  currentProvider: string,
  country: string,
  usageDetails?: string
): string {
  const year = new Date().getFullYear()

  switch (billType) {
    case 'electricity':
      return `best ${billType} tariff ${country} ${year} compare ${currentProvider} alternatives${usageDetails ? ` ${usageDetails}` : ''}`
    case 'gas':
      return `cheapest gas provider ${country} ${year} compare ${currentProvider}`
    case 'internet':
    case 'mobile':
      return `best fibra internet mobile deals ${country} ${year} compare ${currentProvider}${usageDetails ? ` ${usageDetails}` : ''}`
    case 'insurance':
      return `best private health insurance ${country} ${year} compare ${currentProvider} price`
    default:
      return `best ${billType} provider ${country} ${year} compare ${currentProvider}`
  }
}
