import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'

/**
 * Change a transaction's TRADITIONAL category (e.g. "Groceries") and teach the
 * categorisation rules engine so future imports from the same merchant follow
 * suit. Driven by the Value Map card's category dropdown.
 *
 * "Correct + teach future" (the agreed behaviour):
 *   1. Update `transactions.category_id` for this transaction.
 *   2. Upsert a user-scoped `merchant_category_map` rule keyed on the normalised
 *      merchant → category NAME, which `categoriseTransaction` reads on import
 *      (user mappings beat system defaults).
 *
 * The value category (Foundation/Burden/etc.) is untouched — that lives in
 * `transactions.metadata.value_quadrant` / `value_category_rules`.
 */
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { transaction_id?: string; category_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  const transactionId = body.transaction_id?.trim()
  const categoryId = body.category_id?.trim()
  if (!transactionId || !categoryId) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }

  // Auth via the request (cookie) client above; writes via the service client
  // with explicit profile_id scoping — same pattern as the other server-side
  // mutations that need to bypass RLS while staying user-scoped.
  const svc = createServiceClient()

  // Category must exist (categories are global, slug PK).
  const { data: category } = await svc
    .from('categories')
    .select('id, name')
    .eq('id', categoryId)
    .maybeSingle()
  if (!category) {
    return NextResponse.json({ error: 'invalid_category' }, { status: 400 })
  }

  // Transaction must belong to the caller.
  const { data: tx } = await svc
    .from('transactions')
    .select('id, merchant, description')
    .eq('id', transactionId)
    .eq('profile_id', user.id)
    .maybeSingle()
  if (!tx) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // 1) Correct this transaction.
  const { error: updErr } = await svc
    .from('transactions')
    .update({ category_id: categoryId })
    .eq('id', transactionId)
    .eq('profile_id', user.id)
  if (updErr) {
    console.error('[recategorise] transaction update failed', updErr)
    return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  }

  // 2) Teach future imports. The categoriser substring-matches the normalised
  //    merchant against `merchant_pattern` (longest user mapping wins), so the
  //    pattern is the normalised merchant key and the value is the category NAME.
  //    Replace any prior user rule for this pattern so corrections don't pile up.
  const pattern = normaliseMerchant(tx.merchant ?? tx.description ?? '')
  if (pattern) {
    await svc
      .from('merchant_category_map')
      .delete()
      .eq('profile_id', user.id)
      .eq('merchant_pattern', pattern)
    const { error: mapErr } = await svc.from('merchant_category_map').insert({
      merchant_pattern: pattern,
      category_name: category.name,
      source: 'user',
      profile_id: user.id,
    })
    if (mapErr) {
      // Non-fatal: the transaction itself is corrected; future-learning is
      // best-effort and must not fail the user's correction.
      console.error('[recategorise] merchant rule upsert failed', mapErr)
    }
  }

  return NextResponse.json({
    ok: true,
    category_id: category.id,
    category_name: category.name,
  })
}
