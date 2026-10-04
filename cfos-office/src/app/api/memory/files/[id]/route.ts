import { createClient } from '@/lib/supabase/server'
import { applyUserEdit, setFileFlags } from '@/lib/memory/files'

/**
 * The user's own edits to their filing cabinet.
 *
 * PATCH — rewrite the body (and optionally the title/description). This is the
 * write that makes the file authoritative: from here on the CFO may append to
 * it but never overwrite it.
 * POST  — the switches: { action: 'archive' | 'restore' | 'pin' | 'unpin' }.
 *
 * Auth is the user's own session client throughout, so RLS is the real boundary
 * and the id in the path can only ever reach a row the caller owns.
 */

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null)

  if (!body || typeof body.content !== 'string') {
    return Response.json({ error: 'Missing content' }, { status: 400 })
  }

  const result = await applyUserEdit(supabase, user.id, id, {
    content: body.content,
    title: typeof body.title === 'string' ? body.title : undefined,
    description: typeof body.description === 'string' ? body.description : undefined,
  })

  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })

  return Response.json({ file: result.value })
}

const FLAG_ACTIONS: Record<string, { pinned?: boolean; archived?: boolean }> = {
  archive: { archived: true },
  restore: { archived: false },
  pin: { pinned: true },
  unpin: { pinned: false },
}

export async function POST(req: Request, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  const flags = typeof body?.action === 'string' ? FLAG_ACTIONS[body.action] : undefined

  if (!flags) {
    return Response.json(
      { error: "Unknown action. Expected 'archive', 'restore', 'pin' or 'unpin'." },
      { status: 400 },
    )
  }

  const result = await setFileFlags(supabase, user.id, id, flags)
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 })

  return Response.json({ file: result.value })
}
