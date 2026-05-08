import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateFreeTextOpener } from '@/lib/onboarding-v2/free-text-opener-generator'

export const maxDuration = 30

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const { conversationId } = (await req.json()) as { conversationId?: string }
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
  }

  const { data: conv } = await supabase
    .from('conversations')
    .select('id, user_id, type')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .single()
  if (!conv || conv.type !== 'onboarding_v2_chat') {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const { data: existing } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (!existing || existing.length === 0) {
    return new NextResponse('No user message found', { status: 400 })
  }
  const assistant = existing.find((m) => m.role === 'assistant')
  if (assistant) {
    return NextResponse.json({
      message: { role: 'assistant', content: assistant.content, id: assistant.id },
      generated: false,
    })
  }
  const userMsg = existing.find((m) => m.role === 'user')
  if (!userMsg) {
    return new NextResponse('No user message found', { status: 400 })
  }

  const openerText = await generateFreeTextOpener(userMsg.content, user.id)

  const { data: inserted, error: insertErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      user_id: user.id,
      role: 'assistant',
      content: openerText,
    })
    .select('id, content')
    .single()
  if (insertErr || !inserted) {
    console.error('[onboarding-v2.free-text-opener] insert failed', insertErr)
    return new NextResponse('Failed to save opener', { status: 500 })
  }

  return NextResponse.json({
    message: { role: 'assistant', content: inserted.content, id: inserted.id },
    generated: true,
  })
}
