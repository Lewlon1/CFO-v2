import { createClient } from '@/lib/supabase/server'
import { applyValueClassification } from '@/lib/categorisation/value-classification'
import {
  refreshMonthlySnapshots,
  extractAffectedMonths,
} from '@/lib/analytics/monthly-snapshot'

type IncomingResult = {
  transaction_id: string
  quadrant: 'foundation' | 'investment' | 'burden' | 'leak' | null
  confidence?: number
  hard_to_decide?: boolean
}

const VALID_QUADRANTS = new Set(['foundation', 'investment', 'burden', 'leak'])

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  let body: { results?: IncomingResult[] }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const results = Array.isArray(body.results) ? body.results : []
  // Skip hard-to-decide and invalid quadrants
  const actionable = results.filter(
    (r) => r.transaction_id && r.quadrant && VALID_QUADRANTS.has(r.quadrant),
  ) as Array<IncomingResult & { quadrant: 'foundation' | 'investment' | 'burden' | 'leak' }>

  if (actionable.length === 0) {
    return Response.json({
      success: true,
      classified: 0,
      propagated: 0,
      rules_created: 0,
      message: 'Nothing to save.',
    })
  }

  // Fetch transaction details in one query
  const ids = actionable.map((r) => r.transaction_id)
  const { data: transactions, error: fetchError } = await supabase
    .from('transactions')
    .select('id, description, date, amount, category_id')
    .eq('user_id', user.id)
    .in('id', ids)

  if (fetchError) {
    console.error('[api/value-map/checkin/save] fetch error:', fetchError)
    return Response.json({ error: 'Could not load transactions' }, { status: 500 })
  }

  const txnMap = new Map((transactions ?? []).map((t) => [t.id, t]))

  let classified = 0
  let propagated = 0
  const affectedDates: string[] = []
  const errors: string[] = []

  for (const r of actionable) {
    const txn = txnMap.get(r.transaction_id)
    if (!txn) {
      errors.push(`Transaction ${r.transaction_id} not found`)
      continue
    }

    const result = await applyValueClassification(supabase, user.id, {
      transactionId: r.transaction_id,
      newValue: r.quadrant,
      applyToSimilar: true,
      description: txn.description,
      date: txn.date,
      amount: txn.amount,
      categoryId: txn.category_id,
    })

    if (result.ok) {
      classified++
      propagated += result.propagatedCount
      affectedDates.push(txn.date)
    } else {
      errors.push(`Failed to classify ${r.transaction_id}: ${result.error}`)
    }
  }

  // Refresh affected monthly snapshots (fire and forget, but awaited so snapshots
  // are fresh before the client navigates back to /chat)
  if (affectedDates.length > 0) {
    const months = extractAffectedMonths(affectedDates)
    try {
      await refreshMonthlySnapshots(supabase, user.id, months)
    } catch (err) {
      console.error('[api/value-map/checkin/save] snapshot refresh failed:', err)
    }
  }

  // Log completion event for nudge cooldown tracking
  void supabase.from('user_events').insert({
    profile_id: user.id,
    event_type: 'value_checkin_completed',
    event_category: 'value_classification',
    payload: {
      classified,
      propagated,
      skipped: results.length - actionable.length,
    },
  })

  return Response.json({
    success: true,
    classified,
    propagated,
    ...(errors.length > 0 ? { errors } : {}),
  })
}
