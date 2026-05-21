/**
 * Session-resumption context.
 *
 * Loads what's outstanding for a returning user — active experiments, ones
 * that ended and are awaiting self-report, profile gaps — and renders a
 * compact `### Open items` block for the system prompt. Used in the
 * `general` conversation path so a returning user lands in a session that
 * already knows what's on their plate.
 *
 * Three queries run in parallel; the rendered block fits in well under 200
 * tokens in the worst case (3 active + 3 awaiting + 3 gaps).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Profile fields we consider "high-signal gaps" worth mentioning when natural.
 * Order matters — earlier entries are listed first. Kept small on purpose. */
const KNOWN_PROFILE_FIELDS = [
  'net_monthly_income',
  'employment_status',
  'monthly_rent',
  'housing_type',
  'relationship_status',
] as const

export interface OpenItemActiveExperiment {
  id: string
  title: string
  starts_at: string | null
  ends_at: string | null
  days_remaining: number
}

export interface OpenItemAwaitingReport {
  id: string
  title: string
  ended_at: string | null
}

export interface OpenItems {
  active_experiments: OpenItemActiveExperiment[]
  awaiting_self_report: OpenItemAwaitingReport[]
  profile_gaps: string[]
  most_recent_session_ended: string | null
  days_since_last_session: number | null
}

export async function getOpenItems(
  supabase: SupabaseClient,
  userId: string,
): Promise<OpenItems> {
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()

  const [experimentsRes, profileRes, lastConvRes] = await Promise.all([
    supabase
      .from('proposed_experiments')
      .select('id, title, status, starts_at, ends_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('starts_at', { ascending: false })
      .limit(5),
    supabase
      .from('user_profiles')
      .select(KNOWN_PROFILE_FIELDS.join(', '))
      .eq('id', userId)
      .single(),
    // Cast because last_message_at isn't in the generated types until the
    // migration is applied. The column is created by 060_conversations_last_message_at.sql.
    (supabase.from('conversations') as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          not: (col: string, op: string, val: null) => {
            order: (col: string, opts: { ascending: boolean }) => {
              limit: (n: number) => {
                maybeSingle: () => Promise<{ data: { last_message_at: string } | null }>
              }
            }
          }
        }
      }
    })
      .select('last_message_at')
      .eq('user_id', userId)
      .not('last_message_at', 'is', null)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const rows = (experimentsRes.data ?? []) as Array<{
    id: string
    title: string | null
    status: string
    starts_at: string | null
    ends_at: string | null
  }>

  const active: OpenItemActiveExperiment[] = []
  const awaiting: OpenItemAwaitingReport[] = []
  for (const e of rows) {
    if (e.ends_at && e.ends_at > nowIso) {
      active.push({
        id: e.id,
        title: e.title ?? 'Untitled experiment',
        starts_at: e.starts_at,
        ends_at: e.ends_at,
        days_remaining: Math.max(
          0,
          Math.ceil((new Date(e.ends_at).getTime() - nowMs) / (1000 * 60 * 60 * 24)),
        ),
      })
    } else if (e.ends_at) {
      awaiting.push({
        id: e.id,
        title: e.title ?? 'Untitled experiment',
        ended_at: e.ends_at,
      })
    }
  }

  const profile = (profileRes.data ?? {}) as Record<string, unknown>
  const profile_gaps = KNOWN_PROFILE_FIELDS.filter((f) => {
    const v = profile[f]
    return v == null || v === ''
  })

  const last = lastConvRes.data?.last_message_at ?? null
  const days_since_last_session = last
    ? Math.floor((nowMs - new Date(last).getTime()) / (1000 * 60 * 60 * 24))
    : null

  return {
    active_experiments: active,
    awaiting_self_report: awaiting,
    profile_gaps,
    most_recent_session_ended: last,
    days_since_last_session,
  }
}

/**
 * Compact prompt block. Three lines max plus a behavioural directive.
 * Returns '' when nothing outstanding — caller should skip injection.
 */
export function renderOpenItemsBlock(items: OpenItems): string {
  const hasAny =
    items.active_experiments.length > 0 ||
    items.awaiting_self_report.length > 0 ||
    items.profile_gaps.length > 0

  if (!hasAny) return ''

  const lines: string[] = ['### Open items']
  if (items.awaiting_self_report.length > 0) {
    const e = items.awaiting_self_report[0]
    lines.push(
      `- Experiment "${e.title}" ended ${e.ended_at ?? 'recently'}. Awaiting self-report. Open the conversation by asking how it went.`,
    )
  }
  if (items.active_experiments.length > 0) {
    const e = items.active_experiments[0]
    lines.push(`- Experiment "${e.title}" active, ${e.days_remaining} days remaining.`)
  }
  if (items.profile_gaps.length > 0 && items.profile_gaps.length <= 3) {
    lines.push(
      `- Profile gaps: ${items.profile_gaps.join(', ')}. Do not raise unprompted; surface only if natural.`,
    )
  }

  // Behavioural directive so the LLM opens with a check-in instead of a greeting.
  if (items.awaiting_self_report.length > 0 || items.active_experiments.length > 0) {
    lines.push(
      '',
      'Open this session by addressing the most pressing open item above. Do not greet, do not summarise — start with the check-in.',
    )
  }

  return lines.join('\n')
}
