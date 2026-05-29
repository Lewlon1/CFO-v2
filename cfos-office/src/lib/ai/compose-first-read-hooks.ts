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
import { categoriseByRules } from '@/lib/categorisation/rules-engine'

/**
 * Categories that are NEVER a value-ambiguous hook. Income is money in (a
 * "leak vs investment" question is meaningless); housing (rent / mortgage) is
 * a committed Foundation cost already surfaced verbatim in Layer 1 FINANCIAL
 * FACTS; transfers are not spend. Closing the Read on any of these reads as an
 * obvious question ("is your payroll a salary or a contractor draw?", "is your
 * rent long-term or flexible?") rather than a genuine unread. The hook must
 * stay on discretionary spend the user has a real, unresolved relationship to.
 */
const STRUCTURAL_CATEGORIES = new Set(['income', 'housing', 'transfers'])

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

/**
 * True when a cluster is structural — income/refunds/transfers-in, or a
 * committed housing/transfer outflow — and therefore never belongs in the
 * hook. Two independent signals so neither has to be perfect:
 *   1. Inflows. Spend is negative in this codebase (see ClusterBehaviour
 *      .total_amount), so any non-negative total is money in, not spend.
 *   2. Category. Category clusters carry their slug directly; merchant
 *      clusters are run through the keyword tier of the rules engine (empty
 *      categories => keyword-only), which labels rent/mortgage as `housing`,
 *      salary/payroll as `income`, and pot/bank transfers as `transfers`.
 */
function isStructuralCluster(cluster: ClusterBehaviour): boolean {
  if ((cluster.total_amount ?? 0) >= 0) return true
  const slug =
    cluster.cluster_type === 'category'
      ? cluster.cluster_id.toLowerCase()
      : categoriseByRules(cluster.cluster_id, []).categoryId
  return slug != null && STRUCTURAL_CATEGORIES.has(slug)
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
  // Real in-window spend total from the cluster, server-computed. Earlier
  // versions approximated as mean × (window / interval), which on irregular
  // merchants produced ~4-22x over-counts that leaked into the Read prompt as
  // hook-candidate `recent_amount` and got cited verbatim by the model. The
  // honest number is the one already on the cluster.
  return Math.abs(cluster.total_amount ?? 0)
}

/**
 * Pick 2-3 discretionary clusters whose quadrant the Read can't infer alone.
 * Structural clusters (income, rent/housing, transfers) are stripped first —
 * see isStructuralCluster. Among what remains, if the ambiguous-category
 * filter yields too few candidates it falls back to top-by-spend unmapped
 * clusters. Returns empty only when there is no discretionary spend to hook on
 * (e.g. a dataset of income + rent alone); the composer then falls back to the
 * default, non-value-first close.
 */
export function selectHookCandidates(
  clusters: ClusterBehaviour[],
  valueProfile: UserValueProfile,
): HookCandidate[] {
  if (clusters.length === 0) return []

  // Strip structural clusters (income, rent/housing, transfers) before any
  // ranking. They dominate by raw amount on thin datasets and would otherwise
  // win the looser/top-by-spend fallbacks, closing the Read on an obvious
  // question instead of a genuine unread. If nothing discretionary survives,
  // the hook is empty and the composer falls back to the default close.
  const discretionary = clusters.filter((c) => !isStructuralCluster(c))
  if (discretionary.length === 0) return []

  // Determine which clusters lack Layer 2 confidence so we can prefer
  // them. Merchant clusters check signal_count_by_merchant — the value-first
  // real-transactions Value Map writes merchant rules (one per merchant), so
  // any rule = mapped. Earlier versions treated merchant clusters as
  // unconditionally unmapped, which made every recompose surface the same
  // merchants the user had just classified.
  const unmappedFor = (cluster: ClusterBehaviour): boolean => {
    if (cluster.cluster_type === 'merchant') {
      const key = cluster.cluster_id.toLowerCase()
      return (valueProfile.signal_count_by_merchant[key] ?? 0) === 0
    }
    const cat = clusterCategory(cluster)
    if (!cat) return true
    const n = valueProfile.signal_count[cat] ?? 0
    return n < MIN_SIGNAL_FOR_CONFIDENCE
  }

  const ranked = discretionary
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
