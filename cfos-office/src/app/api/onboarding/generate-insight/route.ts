import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createClient } from '@/lib/supabase/server'
import { computeFirstInsight } from '@/lib/analytics/insight-engine'
import { buildFirstInsightContext } from '@/lib/ai/context-builder'
import { BASE_PERSONA } from '@/lib/ai/system-prompt'
import { chatModel } from '@/lib/ai/provider'
import type { StatCard } from '@/lib/analytics/insight-types'

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

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await computeFirstInsight(supabase, user.id)

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

  const contextBlock = buildFirstInsightContext(payload)
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
