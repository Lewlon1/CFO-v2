import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

// GDPR Article 17 — full account deletion.
// Requires the user to type "DELETE MY ACCOUNT" in the confirmation field.
// Calls the delete_user_account() SQL function to wipe every row across every
// table, then deletes the auth.users row via the admin API.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { confirmation } = (await req.json()) as { confirmation?: string }

  if (confirmation !== 'DELETE MY ACCOUNT') {
    return NextResponse.json(
      { error: 'Please type "DELETE MY ACCOUNT" to confirm' },
      { status: 400 }
    )
  }

  const service = createServiceClient()

  // Step 1 — wipe all user data via the SECURITY DEFINER function.
  const { data: deletionResult, error: dbError } = await service.rpc('delete_user_account', {
    p_user_id: user.id,
  })

  if (dbError) {
    console.error('[account/delete] DB deletion failed:', dbError)
    return NextResponse.json({ error: 'Failed to delete account data' }, { status: 500 })
  }

  // Step 2 — delete the auth.users row via Supabase admin API.
  const { error: authError } = await service.auth.admin.deleteUser(user.id)

  if (authError) {
    console.error('[account/delete] Auth deletion failed:', authError)
    // Data is already deleted — log this as critical.
    return NextResponse.json(
      { error: 'Account data deleted but auth cleanup failed. Contact support.' },
      { status: 500 }
    )
  }

  // Sign out the current session so the client redirects cleanly.
  await supabase.auth.signOut()

  return NextResponse.json({
    success: true,
    deleted: deletionResult,
    message: 'Your account and all associated data have been permanently deleted.',
  })
}
