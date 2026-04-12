import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { analyseGap } from '@/lib/analytics/gap-analyser'
import type { GapType } from '@/lib/analytics/gap-analyser'
import { TheGapClient } from './TheGapClient'

function mapGapStatus(gapType: GapType): 'aligned' | 'gap' | 'eliminated' | 'partial' {
  switch (gapType) {
    case 'aligned': return 'aligned'
    case 'leaking_despite_awareness': return 'gap'
    case 'undervalued': return 'eliminated'
    case 'over_investing':
    case 'hidden_burden':
    default: return 'partial'
  }
}

export default async function TheGapPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const result = await analyseGap(supabase, user.id, 3)

  // Get transaction count for provenance line
  const { count } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const gaps = result.gaps.map(g => ({
    trait_key: g.category_slug,
    trait_value: JSON.stringify({
      belief: `You said ${g.category} is ${g.stated_value_category} (${g.stated_confidence}/5)`,
      reality: g.narrative,
      status: mapGapStatus(g.gap_type),
    }),
    confidence: g.stated_confidence,
  }))

  return <TheGapClient gaps={gaps} transactionCount={count ?? 0} />
}
