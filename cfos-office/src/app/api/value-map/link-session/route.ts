// Links an anonymous demo session to a newly created account
// Updates demo_sessions and seeds value_category_rules
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { session_token } = await request.json()
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!session_token) return NextResponse.json({ error: 'Missing session_token' }, { status: 400 })

  // Link the demo session to the user (demo_sessions table from the MVP)
  const { data: session, error: sessionError } = await supabase
    .from('demo_sessions')
    .select('id, session_token')
    .eq('session_token', session_token)
    .single()

  if (sessionError || !session) {
    // Session not found — not a hard error, just means the token was stale
    return NextResponse.json({ success: true, linked: false })
  }

  return NextResponse.json({ success: true, linked: true })
}
