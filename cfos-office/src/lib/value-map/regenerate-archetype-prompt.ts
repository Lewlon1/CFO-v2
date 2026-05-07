import type { ArchetypeResult } from '@/lib/onboarding/archetype-prompt'

export type RegenerationArchetype = ArchetypeResult & {
  shift_narrative?: string
}

// ── Input types ─────────────────────────────────────────────────────────

export type OnboardingInput = {
  personality_type: string
  breakdown: Record<string, { percentage: number; count: number; total: number }>
  archetype_name: string | null
  traits: string[]
  completed_at: string
} | null

export type PersonalRetakeInput = {
  session_number: number
  personality_type: string
  breakdown: Record<string, { percentage: number; count: number; total: number }>
  transaction_count: number
  completed_at: string
}

export type SignalSummary = {
  total: number
  by_value_category: Record<string, number>
  top_merchants_by_category: Record<
    string,
    Array<{ merchant: string; signal_count: number; weight_total: number }>
  >
}

export type MonthlySummary = {
  months_of_data: number
  avg_by_value_category: Record<string, number>   // pct of spend
  trend_by_value_category: Record<string, 'rising' | 'falling' | 'flat'>
}

export type PreviousArchetype = {
  name: string
  subtitle: string
  traits: string[]
  generated_at: string
} | null

export type RegenerationInput = {
  userName?: string
  onboarding: OnboardingInput
  personal_retakes: PersonalRetakeInput[]
  signals: SignalSummary
  monthly: MonthlySummary
  previous_archetype: PreviousArchetype
  trigger: 'retake_complete' | 'monthly_review' | 'manual'
}

// ── Prompt builder ──────────────────────────────────────────────────────

export function buildRegenerationPrompt(input: RegenerationInput): string {
  const name = input.userName || 'the user'
  const sections: string[] = []

  sections.push(`You are regenerating a financial personality archetype for ${name}, a user of The CFO's Office.

You have multiple weighted signals about this person. Your job is to:
1. Synthesise them into a sharp, specific archetype that reflects who they are NOW
2. Name what's changed since the previous archetype (if one exists)
3. Be specific — reference actual merchants, categories, and numbers from the data

Output ONLY a JSON object with this exact shape:
{
  "archetype_name": "short evocative title (2-4 words)",
  "archetype_subtitle": "one sentence explaining the archetype",
  "traits": ["trait 1 with specific references", "trait 2", "trait 3"],
  "shift_narrative": "1-2 sentences: what changed, what stayed true (null if no previous archetype)",
  "certainty_areas": ["thing they're certain about 1", "thing 2"],
  "conflict_areas": ["thing they're conflicted about 1", "thing 2"]
}`)

  // ── 1. Previous archetype ────────────────────────────────────────────
  if (input.previous_archetype) {
    sections.push(`--- PREVIOUS ARCHETYPE (weight: 0.70) ---
Generated: ${input.previous_archetype.generated_at}
Name: ${input.previous_archetype.name}
Subtitle: ${input.previous_archetype.subtitle}
Traits:
${input.previous_archetype.traits.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}

Compare your new archetype to this. Name ONE thing that has shifted and ONE thing that has stayed true.`)
  } else {
    sections.push(`--- PREVIOUS ARCHETYPE ---
None. This is the first regenerated archetype (shift_narrative should be null).`)
  }

  // ── 2. Onboarding baseline ───────────────────────────────────────────
  if (input.onboarding) {
    const monthsAgo = monthsBetween(new Date(input.onboarding.completed_at), new Date())
    const weight = Math.max(0.15, 0.7 - monthsAgo * 0.1).toFixed(2)
    sections.push(`--- ORIGINAL VALUE MAP (onboarding, weight: ${weight} — ${monthsAgo} months old) ---
Personality then: ${input.onboarding.personality_type}
Breakdown (self-perception from sample transactions):
${formatBreakdown(input.onboarding.breakdown)}
${input.onboarding.archetype_name ? `Archetype then: ${input.onboarding.archetype_name}` : ''}
${input.onboarding.traits.length > 0 ? `Traits then:\n${input.onboarding.traits.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}` : ''}`)
  }

  // ── 3. Personal retakes ──────────────────────────────────────────────
  if (input.personal_retakes.length > 0) {
    const retakes = input.personal_retakes
      .slice(-3) // most recent 3
      .map((r) => {
        const monthsAgo = monthsBetween(new Date(r.completed_at), new Date())
        const weight = Math.max(0.2, 0.8 - monthsAgo * 0.1).toFixed(2)
        return `  Retake v${r.session_number} (weight: ${weight}, ${monthsAgo} months old, ${r.transaction_count} txns):
  Personality: ${r.personality_type}
  Breakdown: ${formatBreakdownInline(r.breakdown)}`
      })
      .join('\n\n')
    sections.push(`--- PERSONAL RETAKES (real transactions, recent → oldest) ---
${retakes}`)
  }

  // ── 4. Correction signals summary (weight: 0.90 — real behaviour) ────
  sections.push(`--- CORRECTION SIGNALS (weight: 0.90 — real behaviour) ---
Total corrections: ${input.signals.total}
Distribution:
${Object.entries(input.signals.by_value_category)
  .map(([cat, n]) => `  ${cat}: ${n}`)
  .join('\n')}

Top merchants per value category (max 10 per category):
${formatTopMerchants(input.signals.top_merchants_by_category)}`)

  // ── 5. Monthly spending trends (weight: 0.70) ────────────────────────
  if (input.monthly.months_of_data > 0) {
    sections.push(`--- MONTHLY SPENDING TRENDS (weight: 0.70 — last ${input.monthly.months_of_data} months) ---
Average distribution:
${Object.entries(input.monthly.avg_by_value_category)
  .map(([cat, pct]) => `  ${cat}: ${pct.toFixed(0)}% of spend (${input.monthly.trend_by_value_category[cat] ?? 'flat'})`)
  .join('\n')}`)
  }

  sections.push(`--- YOUR TASK ---
Output the JSON object described at the top. Be specific. Reference actual merchants and categories from the signals data. Do NOT be generic. If you write a trait like "You value experiences," tie it to a specific merchant or pattern from the data.

The archetype name should feel fresh — not a copy of the previous one. If the user's behaviour has genuinely shifted, reflect that in the name.

Trigger: ${input.trigger}

OUTPUT ONLY VALID JSON. No markdown fences, no explanation.`)

  return sections.join('\n\n')
}

// ── Formatting helpers ──────────────────────────────────────────────────

function monthsBetween(from: Date, to: Date): number {
  const days = Math.max(0, (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
  return Math.floor(days / 30)
}

function formatBreakdown(
  breakdown: Record<string, { percentage: number; count: number; total: number }>,
): string {
  return Object.entries(breakdown)
    .map(([cat, data]) => `  ${cat}: ${data.percentage}% (${data.count} items)`)
    .join('\n')
}

function formatBreakdownInline(
  breakdown: Record<string, { percentage: number; count: number; total: number }>,
): string {
  return Object.entries(breakdown)
    .map(([cat, data]) => `${cat} ${data.percentage}%`)
    .join(', ')
}

function formatTopMerchants(
  byCategory: Record<
    string,
    Array<{ merchant: string; signal_count: number; weight_total: number }>
  >,
): string {
  const lines: string[] = []
  for (const [cat, merchants] of Object.entries(byCategory)) {
    if (merchants.length === 0) continue
    lines.push(
      `  ${cat}: ${merchants
        .slice(0, 10)
        .map((m) => `${m.merchant} (${m.signal_count} signal${m.signal_count === 1 ? '' : 's'})`)
        .join(', ')}`,
    )
  }
  return lines.length > 0 ? lines.join('\n') : '  (no confirmed signals yet)'
}

// ── Fallback archetype ──────────────────────────────────────────────────

export function getRegenerationFallback(
  personalityType: string,
  previous: PreviousArchetype,
): RegenerationArchetype {
  const map: Record<string, { name: string; subtitle: string; traits: [string, string, string] }> =
    {
      builder: {
        name: 'The Steady Builder',
        subtitle: "You move money with intent — it's building something specific.",
        traits: [
          'Your spending shows a clear preference for long-term value over short-term comfort.',
          'You confirm categories with high confidence — you know what your money is doing.',
          'Investment-coded spending consistently outweighs leak-coded across your recent behaviour.',
        ],
      },
      fortress: {
        name: 'The Protector',
        subtitle: 'Security first, everything else orbits that.',
        traits: [
          'Your high-confidence classifications cluster around essentials — foundation is your anchor.',
          "You treat volatility as signal, not noise — repeat uncertainty usually marks something you're quietly protecting.",
          'Leak-coded spending stays small relative to foundation and investment.',
        ],
      },
      truth_teller: {
        name: 'The Honest Critic',
        subtitle: "You're brutally clear about what's wasteful, even when it's yours.",
        traits: [
          'You label things "leak" readily — no illusions about where your money leaks out.',
          'Your high-confidence corrections are often negative judgements on your own choices.',
          "You're not avoiding the uncomfortable truth — that's what makes you easy to advise.",
        ],
      },
      drifter: {
        name: 'The Money Wanderer',
        subtitle: 'Your money moves. It just moves without a clear destination.',
        traits: [
          'Low-confidence classifications outnumber high-confidence ones — you see your own spending, you just haven\'t named it.',
          'Breakdown shifts month to month without an obvious driver.',
          'Uncategorised or "no_idea" responses crop up repeatedly for the same merchants.',
        ],
      },
      anchor: {
        name: 'The Grounded One',
        subtitle: 'Routines anchor your spending. Deviations are meaningful.',
        traits: [
          'Your foundation category dominates — bills, groceries, commute — and you rarely misclassify them.',
          "When you correct something, it tends to be the outliers — not the daily spine.",
          "The rare 'leak' you name is usually the same pattern, repeated.",
        ],
      },
    }

  const fallback = map[personalityType] ?? map.drifter
  const shift = previous
    ? `Previous archetype was "${previous.name}". Signals suggest the overall pattern has held.`
    : undefined

  return {
    archetype_name: fallback.name,
    archetype_subtitle: fallback.subtitle,
    traits: fallback.traits,
    certainty_areas: ['Core spending patterns'],
    conflict_areas: ['Occasional uncertain merchants'],
    shift_narrative: shift,
  }
}
