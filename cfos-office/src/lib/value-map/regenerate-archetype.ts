import type { SupabaseClient } from '@supabase/supabase-js'
import { generateText } from 'ai'
import { bedrock } from '@/lib/ai/provider'
import { logChatUsage } from '@/lib/chat/cost-tracker'
import {
  buildRegenerationPrompt,
  getRegenerationFallback,
  type RegenerationInput,
  type RegenerationArchetype,
  type OnboardingInput,
  type PersonalRetakeInput,
  type SignalSummary,
  type MonthlySummary,
  type PreviousArchetype,
} from './regenerate-archetype-prompt'

const BEDROCK_MODEL = process.env.BEDROCK_CLAUDE_MODEL ?? 'eu.anthropic.claude-sonnet-4-6'
const TIMEOUT_MS = 15_000
const MAX_MERCHANTS_PER_CATEGORY = 10

export type RegenerationTrigger = 'retake_complete' | 'monthly_review' | 'manual'

export type RegenerationResult = {
  ok: boolean
  archetype_name: string
  archetype_subtitle: string
  traits: string[]
  shift_narrative: string | null
  certainty_areas: string[]
  conflict_areas: string[]
  version: number
  used_fallback: boolean
}

// ── Main entry ──────────────────────────────────────────────────────────

/**
 * Regenerate the user's Value Map archetype from accumulated evidence.
 *
 * Pulls signals from: onboarding VM, personal retakes, correction signals,
 * monthly snapshots, and the previous archetype. Builds a weighted prompt,
 * calls Bedrock Sonnet 4.6, persists to `value_map_sessions` with
 * session_number as version and archetype_history as the evolution log.
 */
export async function regenerateArchetype(
  supabase: SupabaseClient,
  userId: string,
  trigger: RegenerationTrigger,
): Promise<RegenerationResult | null> {
  const startTime = Date.now()

  try {
    // ── 1. Gather inputs (parallel) ────────────────────────────────────
    const [
      onboardingInput,
      personalRetakes,
      signalSummary,
      monthlySummary,
      previousArchetype,
      userName,
    ] = await Promise.all([
      fetchOnboardingInput(supabase, userId),
      fetchPersonalRetakes(supabase, userId),
      fetchSignalSummary(supabase, userId),
      fetchMonthlySummary(supabase, userId),
      fetchPreviousArchetype(supabase, userId),
      fetchUserName(supabase, userId),
    ])

    // If there's no onboarding AND no retakes, nothing to regenerate from
    if (!onboardingInput && personalRetakes.length === 0 && signalSummary.total < 5) {
      return null
    }

    // ── 2. Build prompt ────────────────────────────────────────────────
    const regenInput: RegenerationInput = {
      userName,
      onboarding: onboardingInput,
      personal_retakes: personalRetakes,
      signals: signalSummary,
      monthly: monthlySummary,
      previous_archetype: previousArchetype,
      trigger,
    }

    const prompt = buildRegenerationPrompt(regenInput)

    // ── 3. Bedrock call with retry + fallback ──────────────────────────
    const personalityType =
      personalRetakes[personalRetakes.length - 1]?.personality_type ??
      onboardingInput?.personality_type ??
      'drifter'

    let archetype: RegenerationArchetype | null = null
    let usedFallback = false

    try {
      const result = await Promise.race([
        generateText({
          model: bedrock(BEDROCK_MODEL),
          prompt,
          maxOutputTokens: 1024,
          temperature: 0.7,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Bedrock timeout')), TIMEOUT_MS),
        ),
      ])
      archetype = parseJSON(result.text)

      if (!archetype) {
        const retry = await Promise.race([
          generateText({
            model: bedrock(BEDROCK_MODEL),
            prompt:
              prompt +
              '\n\nIMPORTANT: Your response must be ONLY a valid JSON object. No markdown, no explanation. Start with { and end with }.',
            maxOutputTokens: 1024,
            temperature: 0.5,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Bedrock retry timeout')), TIMEOUT_MS),
          ),
        ])
        archetype = parseJSON(retry.text)
      }

      if (!archetype) {
        archetype = getRegenerationFallback(personalityType, previousArchetype)
        usedFallback = true
      }
    } catch (err) {
      console.error('[regenerate-archetype] Bedrock error:', err instanceof Error ? err.message : err)
      archetype = getRegenerationFallback(personalityType, previousArchetype)
      usedFallback = true
    }

    // ── 4. Persist to the latest value_map_sessions row ────────────────
    // We update the LATEST session (the just-created personal retake session
    // when trigger='retake_complete', or create a dedicated "regeneration"
    // session for monthly_review/manual triggers).
    const { data: latestSession } = await supabase
      .from('value_map_sessions')
      .select('id, session_number, archetype_history, archetype_name, archetype_subtitle, archetype_traits')
      .eq('profile_id', userId)
      .is('deleted_at', null)
      .order('session_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    let persistedVersion = 1
    if (latestSession) {
      const history: unknown[] = Array.isArray(latestSession.archetype_history)
        ? latestSession.archetype_history
        : []
      // Append previous archetype to history if it had one
      if (latestSession.archetype_name) {
        history.push({
          version: latestSession.session_number,
          name: latestSession.archetype_name,
          subtitle: latestSession.archetype_subtitle,
          traits: latestSession.archetype_traits,
          archived_at: new Date().toISOString(),
        })
      }

      await supabase
        .from('value_map_sessions')
        .update({
          archetype_name: archetype.archetype_name,
          archetype_subtitle: archetype.archetype_subtitle,
          archetype_traits: archetype.traits,
          archetype_analysis: JSON.stringify(archetype.traits),
          shift_narrative: archetype.shift_narrative ?? null,
          certainty_areas: archetype.certainty_areas,
          conflict_areas: archetype.conflict_areas,
          archetype_history: history,
          used_fallback: usedFallback,
          trigger_reason: trigger,
          source_signal_summary: {
            total_signals: signalSummary.total,
            personal_retakes: personalRetakes.length,
            months_of_data: monthlySummary.months_of_data,
          },
        })
        .eq('id', latestSession.id)
        .eq('profile_id', userId)

      persistedVersion = latestSession.session_number
    }

    // ── 5. Upsert archetype traits to financial_portrait ──────────────
    const portraitEntries = [
      {
        user_id: userId,
        trait_type: 'archetype',
        trait_key: 'archetype_name',
        trait_value: archetype.archetype_name,
        confidence: usedFallback ? 0.5 : 0.9,
        evidence: archetype.archetype_subtitle,
        source: 'value_map',
      },
      ...archetype.traits.map((trait, i) => ({
        user_id: userId,
        trait_type: 'archetype',
        trait_key: `archetype_trait_${i + 1}`,
        trait_value: trait,
        confidence: usedFallback ? 0.5 : 0.85,
        evidence: `From archetype regeneration v${persistedVersion} (${archetype!.archetype_name})`,
        source: 'value_map',
      })),
    ]

    for (const entry of portraitEntries) {
      await supabase
        .from('financial_portrait')
        .upsert(entry, { onConflict: 'user_id,trait_key' })
        .then(() => undefined, (err) => {
          console.error('[regenerate-archetype] portrait upsert failed:', entry.trait_key, err)
        })
    }

    // ── 6. Log usage ──────────────────────────────────────────────────
    await logChatUsage({
      profileId: userId,
      action: `archetype_regeneration_${trigger}${usedFallback ? '_fallback' : ''}`,
      model: BEDROCK_MODEL,
      durationMs: Date.now() - startTime,
    }).catch(() => {})

    return {
      ok: true,
      archetype_name: archetype.archetype_name,
      archetype_subtitle: archetype.archetype_subtitle,
      traits: archetype.traits,
      shift_narrative: archetype.shift_narrative ?? null,
      certainty_areas: archetype.certainty_areas,
      conflict_areas: archetype.conflict_areas,
      version: persistedVersion,
      used_fallback: usedFallback,
    }
  } catch (err) {
    console.error('[regenerate-archetype] unexpected error:', err)
    return null
  }
}

// ── Input gathering ─────────────────────────────────────────────────────

async function fetchOnboardingInput(
  supabase: SupabaseClient,
  userId: string,
): Promise<OnboardingInput> {
  const { data } = await supabase
    .from('value_map_sessions')
    .select('personality_type, dominant_quadrant, breakdown, archetype_name, archetype_traits, created_at, type')
    .eq('profile_id', userId)
    .eq('type', 'onboarding')
    .is('deleted_at', null)
    .order('session_number', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!data) return null

  return {
    personality_type: data.personality_type,
    breakdown: (data.breakdown as Record<string, { percentage: number; count: number; total: number }>) ?? {},
    archetype_name: data.archetype_name ?? null,
    traits: Array.isArray(data.archetype_traits) ? data.archetype_traits as string[] : [],
    completed_at: data.created_at,
  }
}

async function fetchPersonalRetakes(
  supabase: SupabaseClient,
  userId: string,
): Promise<PersonalRetakeInput[]> {
  const { data } = await supabase
    .from('value_map_sessions')
    .select('session_number, personality_type, breakdown, transaction_count, created_at')
    .eq('profile_id', userId)
    .eq('type', 'personal')
    .is('deleted_at', null)
    .order('session_number', { ascending: true })

  if (!data) return []

  return data.map((r) => ({
    session_number: r.session_number,
    personality_type: r.personality_type,
    breakdown: (r.breakdown as Record<string, { percentage: number; count: number; total: number }>) ?? {},
    transaction_count: r.transaction_count,
    completed_at: r.created_at,
  }))
}

async function fetchSignalSummary(
  supabase: SupabaseClient,
  userId: string,
): Promise<SignalSummary> {
  const { data } = await supabase
    .from('correction_signals')
    .select('merchant_clean, value_category, weight_multiplier')
    .eq('user_id', userId)

  if (!data || data.length === 0) {
    return {
      total: 0,
      by_value_category: {},
      top_merchants_by_category: {},
    }
  }

  const byCategory: Record<string, number> = {}
  const perMerchantByCategory = new Map<
    string,
    Map<string, { signal_count: number; weight_total: number }>
  >()

  for (const sig of data as Array<{ merchant_clean: string; value_category: string; weight_multiplier: number | null }>) {
    byCategory[sig.value_category] = (byCategory[sig.value_category] ?? 0) + 1

    if (!perMerchantByCategory.has(sig.value_category)) {
      perMerchantByCategory.set(sig.value_category, new Map())
    }
    const mm = perMerchantByCategory.get(sig.value_category)!
    const existing = mm.get(sig.merchant_clean) ?? { signal_count: 0, weight_total: 0 }
    existing.signal_count += 1
    existing.weight_total += Number(sig.weight_multiplier) || 1
    mm.set(sig.merchant_clean, existing)
  }

  // Truncate to top N per category (by weight_total desc, signal_count desc)
  const topMerchants: Record<string, Array<{ merchant: string; signal_count: number; weight_total: number }>> = {}
  for (const [cat, mm] of perMerchantByCategory) {
    const sorted = [...mm.entries()]
      .map(([merchant, m]) => ({ merchant, ...m }))
      .sort((a, b) => {
        if (b.weight_total !== a.weight_total) return b.weight_total - a.weight_total
        return b.signal_count - a.signal_count
      })
      .slice(0, MAX_MERCHANTS_PER_CATEGORY)
    topMerchants[cat] = sorted
  }

  return {
    total: data.length,
    by_value_category: byCategory,
    top_merchants_by_category: topMerchants,
  }
}

async function fetchMonthlySummary(
  supabase: SupabaseClient,
  userId: string,
): Promise<MonthlySummary> {
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  const { data } = await supabase
    .from('monthly_snapshots')
    .select('month, spending_by_value_category')
    .eq('user_id', userId)
    .gte('month', sixMonthsAgo.toISOString().slice(0, 10))
    .order('month', { ascending: true })

  if (!data || data.length === 0) {
    return {
      months_of_data: 0,
      avg_by_value_category: {},
      trend_by_value_category: {},
    }
  }

  // Collect value-category percentages per month
  const perMonth: Array<Record<string, number>> = []
  for (const m of data as Array<{ month: string; spending_by_value_category: Record<string, number> | null }>) {
    const categoryTotals = m.spending_by_value_category ?? {}
    const total = Object.values(categoryTotals).reduce((s, n) => s + Number(n || 0), 0) || 1
    const pcts: Record<string, number> = {}
    for (const [cat, amt] of Object.entries(categoryTotals)) {
      pcts[cat] = (Number(amt || 0) / total) * 100
    }
    perMonth.push(pcts)
  }

  // Compute averages
  const allCats = new Set<string>()
  for (const m of perMonth) for (const k of Object.keys(m)) allCats.add(k)
  const avg: Record<string, number> = {}
  for (const cat of allCats) {
    const vals = perMonth.map((m) => m[cat] ?? 0)
    avg[cat] = vals.reduce((s, n) => s + n, 0) / vals.length
  }

  // Compute trend: compare first half to second half
  const trend: Record<string, 'rising' | 'falling' | 'flat'> = {}
  const halfway = Math.floor(perMonth.length / 2)
  if (halfway >= 1) {
    for (const cat of allCats) {
      const firstHalf =
        perMonth.slice(0, halfway).reduce((s, m) => s + (m[cat] ?? 0), 0) / halfway
      const secondHalf =
        perMonth.slice(halfway).reduce((s, m) => s + (m[cat] ?? 0), 0) / (perMonth.length - halfway)
      const delta = secondHalf - firstHalf
      trend[cat] = delta > 3 ? 'rising' : delta < -3 ? 'falling' : 'flat'
    }
  } else {
    for (const cat of allCats) trend[cat] = 'flat'
  }

  return {
    months_of_data: perMonth.length,
    avg_by_value_category: avg,
    trend_by_value_category: trend,
  }
}

async function fetchPreviousArchetype(
  supabase: SupabaseClient,
  userId: string,
): Promise<PreviousArchetype> {
  const { data } = await supabase
    .from('value_map_sessions')
    .select('archetype_name, archetype_subtitle, archetype_traits, created_at')
    .eq('profile_id', userId)
    .not('archetype_name', 'is', null)
    .is('deleted_at', null)
    .order('session_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data?.archetype_name) return null

  return {
    name: data.archetype_name,
    subtitle: data.archetype_subtitle ?? '',
    traits: Array.isArray(data.archetype_traits) ? (data.archetype_traits as string[]) : [],
    generated_at: data.created_at,
  }
}

async function fetchUserName(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase
    .from('user_profiles')
    .select('display_name, first_name')
    .eq('id', userId)
    .maybeSingle()
  return (data?.display_name as string) ?? (data?.first_name as string) ?? 'there'
}

// ── JSON parsing (same pattern as generate-archetype) ──────────────────

function parseJSON(text: string): RegenerationArchetype | null {
  const validate = (data: unknown): data is RegenerationArchetype => {
    if (!data || typeof data !== 'object') return false
    const d = data as Record<string, unknown>
    return (
      typeof d.archetype_name === 'string' &&
      typeof d.archetype_subtitle === 'string' &&
      Array.isArray(d.traits) &&
      d.traits.length >= 3 &&
      d.traits.every((t: unknown) => typeof t === 'string') &&
      Array.isArray(d.certainty_areas) &&
      Array.isArray(d.conflict_areas)
    )
  }

  try {
    const parsed = JSON.parse(text)
    if (validate(parsed)) return parsed
  } catch {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch?.[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim())
        if (validate(parsed)) return parsed
      } catch {
        // fall through
      }
    }
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1))
        if (validate(parsed)) return parsed
      } catch {
        // fall through
      }
    }
  }
  return null
}
