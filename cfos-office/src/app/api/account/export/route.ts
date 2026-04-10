import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

// GDPR Article 20 — full data portability export.
// Returns every row the system holds for the authenticated user across all tables.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const { data, error } = await service.rpc('export_user_data', { p_user_id: user.id })

  if (error) {
    console.error('[account/export] failed:', error)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }

  const filename = `cfos-office-export-${new Date().toISOString().slice(0, 10)}.json`

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
