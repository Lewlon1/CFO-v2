import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createClient } from '@/lib/supabase/server'
import { computeFirstInsight } from '@/lib/analytics/insight-engine'
import { buildFirstInsightContext } from '@/lib/ai/context-builder'
import { BASE_PERSONA } from '@/lib/ai/system-prompt'
import { chatModel } from '@/lib/ai/provider'
import type { StatCard, InsightPayload } from '@/lib/analytics/insight-types'
import { buildQuotableFacts } from '@/lib/ai/context-builder'
import { validateNarrative } from '@/lib/ai/insight-validator'

// First-insight endpoint for the onboarding modal.
//
// 1. Runs the PR #31 deterministic pattern-detection engine.
// 2. Asks Claude to narrate the computed payload under the anti-hallucination
//    guardrails assembled by `buildFirstInsightContext`.
// 3. Parses `[STATS]` / `[OPTIONS]` blocks out of Claude's response so the
//    client can render stat cards + tappable suggestions alongside the
//    narrative inline in the modal.

function parseStats(text: string): StatCard[] {
  const m = text.match(/\[STATS\]([\s\S]*?)\[\/STATS\]/)
  if (!m) return []
  return m[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, value] = line.split('|').map((s) => s.trim())
      if (!label || !value) return null
      return { label, value, source_pattern_id: 'llm' }
    })
    .filter((c): c is StatCard => c !== null)
}

function parseOptions(text: string): string[] {
  // Accept both closed and unclosed [OPTIONS] blocks — Claude frequently drops the closing tag.
  const open = text.match(/\[OPTIONS\]([\s\S]*?)(?:\[\/OPTIONS\]|$)/)
  if (!open) return []
  return open[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('-'))
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
}

function stripBlocks(text: string): string {
  return text
    .replace(/\[STATS\][\s\S]*?\[\/STATS\]/g, '')
    .replace(/\[OPTIONS\][\s\S]*?(?:\[\/OPTIONS\]|$)/g, '')
    .replace(/\[\/?OPTIONS\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function collectKnownMerchants(payload: InsightPayload): string[] {
  const merchants = new Set<string>()
  for (const layer of ['headline', 'gap', 'numbers', 'hidden_pattern', 'action', 'hook'] as const) {
    const pattern = payload.layers[layer]
    if (!pattern) continue
    const data = pattern.data as Record<string, unknown>
    if (typeof data.topMerchant === 'string') merchants.add(data.topMerchant.toLowerCase())
    if (Array.isArray(data.topMerchants)) {
      for (const m of data.topMerchants) {
        if (m && typeof m === 'object' && 'name' in m) {
          merchants.add(String((m as { name: unknown }).name).toLowerCase())
        }
      }
    }
  }
  return Array.from(merchants)
}

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [payload, profileResult] = await Promise.all([
    computeFirstInsight(supabase, user.id),
    supabase.from('profiles').select('onboarding_progress').eq('id', user.id).single(),
  ])

  const onboardingData = (profileResult.data?.onboarding_progress as { data?: { selectedCapabilities?: string[] } } | null)?.data
  const selectedCapabilities = onboardingData?.selectedCapabilities ?? []

  if (payload.transactionCount === 0) {
    return NextResponse.json({
      insight: {
        narrative:
          "I've logged everything, but I don't have enough data yet to spot patterns. Upload another statement and I'll have more to say.",
        statCards: [],
        suggestedResponses: [],
      },
    })
  }

  const contextBlock = buildFirstInsightContext(payload, selectedCapabilities)
  const systemPrompt = `${BASE_PERSONA}\n\n${contextBlock}`

  try {
    const result = await generateText({
      model: chatModel,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: '[System: Post-upload analysis triggered. Deliver your first insight.]',
        },
      ],
      maxOutputTokens: 800,
      temperature: 0.7,
    })

    const text = result.text
    const statCards = parseStats(text)
    const suggestedResponses = parseOptions(text)
    const narrative = stripBlocks(text)

    // Post-generation grounding check. Compare numbers/merchants in the narrative
    // against the quotable-facts allowlist. On violation, log and return the
    // deterministic fallback (no narrative) — graceful degradation keeps the
    // UX working even when the model ignores grounding guardrails.
    const facts = buildQuotableFacts(payload)
    const knownMerchants = collectKnownMerchants(payload)
    const validation = validateNarrative(narrative, facts, { knownMerchants })

    if (!validation.ok) {
      // CLAUDE.md rule: "The LLM interprets. The system computes." Any number
      // or merchant the narrative cites that is not in the quotable-facts
      // allowlist means Claude fabricated it. There is no safe threshold —
      // a single wrong number is enough to mislead a user about their own
      // money. Drop the narrative and ship the deterministic stat cards.
      console.error(
        '[generate-insight] validator violation:',
        validation.reason,
        'offenders:', validation.offenders,
        '(falling back to no-narrative)',
      )

      return NextResponse.json({
        insight: {
          narrative: '',
          statCards: payload.statCards,
          suggestedResponses: payload.suggestedResponses,
          experiment: payload.layers.action?.experiment,
        },
        validation: {
          ok: false,
          reason: validation.reason,
          offenders: validation.offenders,
          rejectedNarrative: narrative,
        },
      })
    }

    return NextResponse.json({
      insight: {
        narrative,
        statCards:
          statCards.length > 0
            ? statCards
            : payload.statCards.map((c) => ({ ...c })),
        suggestedResponses:
          suggestedResponses.length > 0 ? suggestedResponses : payload.suggestedResponses,
        experiment: payload.layers.action?.experiment,
      },
    })
  } catch (err) {
    console.error('[generate-insight] Claude narration failed:', err)
    // Fall back to the deterministic engine output without narration.
    return NextResponse.json({
      insight: {
        narrative: '',
        statCards: payload.statCards,
        suggestedResponses: payload.suggestedResponses,
        experiment: payload.layers.action?.experiment,
      },
    })
  }
}
