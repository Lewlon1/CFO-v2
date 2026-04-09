import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

type DeletionTarget =
  | 'transactions'
  | 'portrait'
  | 'conversations'
  | 'goals'
  | 'value_map'
  | 'everything'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { target, confirmation } = await req.json() as {
    target: DeletionTarget
    confirmation: string
  }

  const expectedConfirmation = `DELETE_${target.toUpperCase()}`
  if (confirmation !== expectedConfirmation) {
    return NextResponse.json(
      { error: 'Confirmation required', expected: expectedConfirmation },
      { status: 400 }
    )
  }

  const serviceClient = createServiceClient()

  switch (target) {
    case 'transactions':
      await serviceClient.from('transactions').delete().eq('user_id', user.id)
      await serviceClient.from('monthly_snapshots').delete().eq('user_id', user.id)
      await serviceClient.from('recurring_expenses').delete().eq('user_id', user.id)
      break

    case 'portrait':
      await serviceClient.from('financial_portrait').delete().eq('user_id', user.id)
      break

    case 'conversations':
      await serviceClient.from('conversations').delete().eq('user_id', user.id)
      break

    case 'goals':
      await serviceClient.from('action_items').delete().eq('user_id', user.id)
      await serviceClient.from('goals').delete().eq('user_id', user.id)
      break

    case 'value_map':
      await serviceClient.from('value_map_results').delete().eq('profile_id', user.id)
      await serviceClient.from('value_map_sessions').delete().eq('profile_id', user.id)
      await serviceClient.from('value_category_rules').delete().eq('user_id', user.id)
      break

    case 'everything':
      // Full account deletion is now handled by /api/account/delete, which
      // calls the delete_user_account() SQL function for complete coverage.
      // Delegate here for backwards compatibility with any callers still
      // targeting this endpoint.
      {
        const { error: dbError } = await serviceClient.rpc('delete_user_account', {
          p_user_id: user.id,
        })
        if (dbError) {
          console.error('[delete-data] delete_user_account failed:', dbError)
          return NextResponse.json({ error: 'Failed to delete account data' }, { status: 500 })
        }
        await serviceClient.auth.admin.deleteUser(user.id)
        await supabase.auth.signOut()
        return NextResponse.json({ success: true, redirect: '/' })
      }

    default:
      return NextResponse.json({ error: 'Invalid deletion target' }, { status: 400 })
  }

  return NextResponse.json({ success: true, deleted: target })
}
