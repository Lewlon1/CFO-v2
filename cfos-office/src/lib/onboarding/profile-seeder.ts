import type { SupabaseClient } from '@supabase/supabase-js'
import type { OnboardingData, ArchetypeData } from './types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SeedOptions {
  userId: string
  data: OnboardingData
}

// ── Main seeder ───────────────────────────────────────────────────────────────

/**
 * Seeds the progressive profiling system with everything learned during onboarding.
 * Called when onboarding completes. Must be idempotent — safe to call multiple times.
 */
export async function seedFromOnboarding(
  supabase: SupabaseClient,
  { userId, data }: SeedOptions,
): Promise<void> {
  const promises: Promise<unknown>[] = []

  // 1. Store archetype in financial_portrait (if LLM archetype was generated)
  if (data.archetypeData) {
    promises.push(seedArchetype(supabase, userId, data.archetypeData))
  }

  // 2. Mark Value Map as completed in financial_portrait
  if (data.personalityType) {
    promises.push(
      upsertPortrait(supabase, userId, {
        trait_type: 'onboarding',
        trait_key: 'onboarding_value_map_completed',
        trait_value: data.personalityType,
        confidence: 1.0,
        evidence: `Completed Value Map with personality type: ${data.personalityType}`,
        source: 'onboarding',
      }),
    )
  }

  // 3. Store capability preferences in financial_portrait
  if (data.selectedCapabilities && data.selectedCapabilities.length > 0) {
    promises.push(
      upsertPortrait(supabase, userId, {
        trait_type: 'onboarding',
        trait_key: 'onboarding_capabilities',
        trait_value: data.selectedCapabilities.join(','),
        confidence: 1.0,
        evidence: `User selected focus areas: ${data.selectedCapabilities.join(', ')}`,
        source: 'onboarding',
      }),
    )
  }

  // 4. Store dominant quadrant as a behavioral signal
  if (data.dominantQuadrant) {
    promises.push(
      upsertPortrait(supabase, userId, {
        trait_type: 'behavioral',
        trait_key: 'dominant_value_quadrant',
        trait_value: data.dominantQuadrant,
        confidence: 0.7,
        evidence: 'From Value Map exercise (sample data, not real spending)',
        source: 'value_map',
      }),
    )
  }

  // Execute all in parallel
  const results = await Promise.allSettled(promises)
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[profile-seeder] Failed to seed:', result.reason)
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function seedArchetype(
  supabase: SupabaseClient,
  userId: string,
  archetype: ArchetypeData,
): Promise<void> {
  const entries = [
    {
      user_id: userId,
      trait_type: 'archetype' as const,
      trait_key: 'archetype_name',
      trait_value: archetype.archetype_name,
      confidence: 0.9,
      evidence: archetype.archetype_subtitle,
      source: 'value_map' as const,
    },
    ...archetype.traits.map((trait, i) => ({
      user_id: userId,
      trait_type: 'archetype' as const,
      trait_key: `archetype_trait_${i + 1}`,
      trait_value: trait,
      confidence: 0.85,
      evidence: `From Value Map archetype: ${archetype.archetype_name}`,
      source: 'value_map' as const,
    })),
    {
      user_id: userId,
      trait_type: 'archetype' as const,
      trait_key: 'archetype_certainty_areas',
      trait_value: archetype.certainty_areas.join(', '),
      confidence: 0.8,
      evidence: `Areas of high certainty from Value Map`,
      source: 'value_map' as const,
    },
    {
      user_id: userId,
      trait_type: 'archetype' as const,
      trait_key: 'archetype_conflict_areas',
      trait_value: archetype.conflict_areas.join(', '),
      confidence: 0.8,
      evidence: `Areas of conflict/hesitation from Value Map`,
      source: 'value_map' as const,
    },
  ]

  for (const entry of entries) {
    await supabase
      .from('financial_portrait')
      .upsert(entry, { onConflict: 'user_id,trait_key' })
  }
}

async function upsertPortrait(
  supabase: SupabaseClient,
  userId: string,
  entry: {
    trait_type: string
    trait_key: string
    trait_value: string
    confidence: number
    evidence: string
    source: string
  },
): Promise<void> {
  const { error } = await supabase
    .from('financial_portrait')
    .upsert(
      { user_id: userId, ...entry },
      { onConflict: 'user_id,trait_key' },
    )

  if (error) {
    console.error(`[profile-seeder] Failed to upsert ${entry.trait_key}:`, error)
  }
}
