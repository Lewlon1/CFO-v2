// Hook-candidate selection for the value-first First Read.
//
// The hook is the engagement linchpin of the value-first onboarding flow:
// the Read ends by naming 2-3 specific transactions or clusters the CFO
// genuinely can't interpret without the user. Those exact items become the
// real-transactions input to the optional Value Map step that follows. If
// the hook lands flat, the optional Value Map dies and Layer 2 never
// activates.
//
// The selector is heuristic and deliberately small. It picks clusters
// where (a) the user has high recent spend, (b) Layer 2 has no confident
// rule yet, and (c) the category is in a known-ambiguous set where the
// quadrant — leak vs investment — is a genuine question. With sparse
// data it falls back to top unmapped clusters by spend so the hook is
// never empty.

import type { ClusterBehaviour } from '@/lib/analytics/cluster-behaviour/types'
import type { UserValueProfile } from '@/lib/value-map/value-profile'
import { MIN_SIGNAL_FOR_CONFIDENCE } from '@/lib/value-map/value-profile'
import { normaliseMerchantDescription } from '@/lib/analytics/merchant-normalise'

/** Categories where the quadrant question is genuinely open and worth surfacing. */
const AMBIGUOUS_CATEGORIES = new Set([
  'dining',
  'restaurants',
  'eating-out',
  'takeaway',
  'food-delivery',
  'subscriptions',
  'streaming',
  'entertainment',
  'shopping',
  'leisure',
  'fitness',
])

const MAX_HOOKS = 3
const MIN_HOOKS = 2
const MIN_RECENT_AMOUNT = 25

export type HookCandidate = {
  /** Normalised merchant key, matches the cluster's cluster_id. */
  cluster_id: string
  /** User-facing display label. */
  label: string
  /** Sum of amounts in the window covered by the cluster behaviour. */
  recent_amount: number
  /** A short hint string for the prompt body: "14 hits, climbing 18%/mo". */
  period_hint: string
  /** Quadrants the Value Map step will offer. Always investment/leak today. */
  candidate_quadrants: Array<'investment' | 'leak'>
}

function clusterCategory(cluster: ClusterBehaviour): string | null {
  // For merchant-type clusters we don't have a category here; the prompt
  // composer uses cluster_id naming. The Layer 2 confidence gate uses
  // category_slug; for merchant clusters we let the unmapped-by-default
  // path govern.
  return cluster.cluster_type === 'category' ? cluster.cluster_id : null
}

function periodHint(cluster: ClusterBehaviour): string {
  const parts: string[] = []
  if (cluster.recurrence?.pattern_label && cluster.recurrence.pattern_label !== 'sparse') {
    parts.push(cluster.recurrence.pattern_label)
  }
  const slope = cluster.trend?.slope_percent_per_month
  if (slope != null && Math.abs(slope) >= 5) {
    parts.push(`${slope >= 0 ? '+' : ''}${Math.round(slope)}%/mo`)
  }
  if (cluster.lifecycle?.appeared_within_window) {
    parts.push('new')
  }
  return parts.join(', ') || 'visible but unread'
}

function recentAmountFor(cluster: ClusterBehaviour): number {
  // amount_profile.mean_amount is per-occurrence; scale by an approximate
  // occurrence count within the window using recurrence pattern hints.
  // Cheap approximation — the hook decision doesn't need precision, just
  // relative ranking across clusters.
  const mean = Math.abs(cluster.amount_profile?.mean_amount ?? 0)
  const interval = cluster.recurrence?.median_interval_days
  const window = cluster.window_days || 90
  const approxN = interval && interval > 0 ? Math.max(1, Math.floor(window / interval)) : 1
  return mean * approxN
}

/**
 * Pick 2-3 clusters whose quadrant the Read can't infer alone. The selector
 * never returns empty when `clusters.length >= 1` — if the ambiguous-category
 * filter yields too few candidates, it falls back to top-by-spend
 * unmapped clusters.
 */
export function selectHookCandidates(
  clusters: ClusterBehaviour[],
  valueProfile: UserValueProfile,
): HookCandidate[] {
  if (clusters.length === 0) return []

  // Determine which clusters lack Layer 2 confidence so we can prefer
  // them. A merchant cluster has no direct category mapping here — treat
  // it as unmapped by default and let the ambiguous-category gate handle
  // categories proper.
  const unmappedFor = (cluster: ClusterBehaviour): boolean => {
    const cat = clusterCategory(cluster)
    if (!cat) return true
    const n = valueProfile.signal_count[cat] ?? 0
    return n < MIN_SIGNAL_FOR_CONFIDENCE
  }

  const ranked = clusters
    .filter((c) => recentAmountFor(c) >= MIN_RECENT_AMOUNT)
    .map((c) => ({
      cluster: c,
      score: recentAmountFor(c),
      ambiguous: AMBIGUOUS_CATEGORIES.has(clusterCategory(c) ?? ''),
      unmapped: unmappedFor(c),
    }))
    .sort((a, b) => {
      // Prefer ambiguous + unmapped first, then by recent spend.
      const aRank = (a.ambiguous ? 2 : 0) + (a.unmapped ? 1 : 0)
      const bRank = (b.ambiguous ? 2 : 0) + (b.unmapped ? 1 : 0)
      if (aRank !== bRank) return bRank - aRank
      return b.score - a.score
    })

  // Strict pass: ambiguous + unmapped.
  const strict = ranked.filter((r) => r.ambiguous && r.unmapped).slice(0, MAX_HOOKS)
  if (strict.length >= MIN_HOOKS) {
    return strict.map(({ cluster, score }) => toHookCandidate(cluster, score))
  }

  // Looser pass: any unmapped cluster by spend, capped.
  const looser = ranked.filter((r) => r.unmapped).slice(0, MAX_HOOKS)
  if (looser.length >= MIN_HOOKS) {
    return looser.map(({ cluster, score }) => toHookCandidate(cluster, score))
  }

  // Last-resort fallback: just take top by spend.
  return ranked.slice(0, MAX_HOOKS).map(({ cluster, score }) =>
    toHookCandidate(cluster, score),
  )
}

function toHookCandidate(cluster: ClusterBehaviour, recent: number): HookCandidate {
  const label =
    cluster.cluster_type === 'merchant'
      ? normaliseMerchantDescription(cluster.cluster_id)
      : cluster.cluster_id
  return {
    cluster_id: cluster.cluster_id,
    label,
    recent_amount: Math.round(recent * 100) / 100,
    period_hint: periodHint(cluster),
    candidate_quadrants: ['investment', 'leak'],
  }
}
