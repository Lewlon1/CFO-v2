import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createHash } from 'crypto'

// POST — record one or more consent grants for the authenticated user.
// Called from the signup flow immediately after account creation.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { consents } = (await req.json()) as {
    consents?: Array<{ type: string; version: string }>
  }

  if (!Array.isArray(consents) || consents.length === 0) {
    return NextResponse.json({ error: 'consents array required' }, { status: 400 })
  }

  const headersList = await headers()
  const forwardedFor = headersList.get('x-forwarded-for') || 'unknown'
  const ipHash = createHash('sha256').update(forwardedFor).digest('hex').slice(0, 16)
  const userAgent = headersList.get('user-agent') || 'unknown'

  const rows = consents.map((c) => ({
    user_id: user.id,
    consent_type: c.type,
    consent_version: c.version,
    granted: true,
    ip_hash: ipHash,
    user_agent: userAgent,
  }))

  const { error } = await supabase.from('consent_records').insert(rows)

  if (error) {
    console.error('[account/consent] insert failed:', error)
    return NextResponse.json({ error: 'Failed to record consent' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, count: rows.length })
}

// GET — retrieve the authenticated user's consent history.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('consent_records')
    .select('consent_type, consent_version, granted, granted_at, withdrawn_at')
    .eq('user_id', user.id)
    .order('granted_at', { ascending: false })

  if (error) {
    console.error('[account/consent] fetch failed:', error)
    return NextResponse.json({ error: 'Failed to fetch consent history' }, { status: 500 })
  }

  return NextResponse.json({ consents: data ?? [] })
}
