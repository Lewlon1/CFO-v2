import { createClient } from '@/lib/supabase/server'
import { selectValueReviewCandidates } from '@/lib/ai/tools/get-value-review-queue'

const MIN_COUNT = 5
const MAX_COUNT = 12

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  // Fetch user currency (best-effort; default EUR)
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('primary_currency')
    .eq('id', user.id)
    .single()
  const currency = profile?.primary_currency ?? 'EUR'

  try {
    const result = await selectValueReviewCandidates(supabase, user.id, {
      format: 'individual',
      minCount: MIN_COUNT,
      maxCount: MAX_COUNT,
      maxPerMerchant: 3,
    })

    if (result.format !== 'individual') {
      return Response.json({ available: false, reason: 'Unexpected format' }, { status: 500 })
    }

    if (result.transactions.length < MIN_COUNT) {
      return Response.json(
        {
          available: false,
          reason: 'Not enough uncertain transactions for a value check-in yet.',
          transaction_count: result.transactions.length,
        },
        { status: 404 },
      )
    }

    // Enrich with category name (single lookup for all unique category_ids)
    const categoryIds = [...new Set(result.transactions.map((t) => t.category_id).filter((c): c is string => !!c))]
    let categoryNameMap: Record<string, string> = {}
    if (categoryIds.length > 0) {
      const { data: cats } = await supabase
        .from('categories')
        .select('id, name')
        .in('id', categoryIds)
      if (cats) {
        categoryNameMap = Object.fromEntries(cats.map((c) => [c.id, c.name]))
      }
    }

    // Shape transactions for the ValueMapFlow card UI (match ValueMapTransaction)
    const transactions = result.transactions.map((t) => ({
      id: t.transaction_id,
      merchant: t.merchant,
      description: t.description,
      amount: t.amount, // positive (card UI convention — see SAMPLE_TRANSACTIONS)
      currency,
      transaction_date: t.date.slice(0, 10), // YYYY-MM-DD — matches sample format expected by ValueMapCard.formatDate
      is_recurring: false,
      category_name: t.category_id ? categoryNameMap[t.category_id] ?? null : null,
      category_id: t.category_id,
      formatted_date: t.formatted_date,
    }))

    return Response.json({
      available: true,
      transactions,
      stats: {
        total_uncertain: result.totalCandidates,
        selected_count: transactions.length,
        categories_represented: result.categoriesRepresented
          .map((id) => categoryNameMap[id])
          .filter(Boolean),
      },
      currency,
    })
  } catch (err) {
    console.error('[api/value-map/checkin GET] error:', err)
    return Response.json({ available: false, reason: 'Server error' }, { status: 500 })
  }
}
