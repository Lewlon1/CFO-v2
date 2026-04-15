import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const specificId = searchParams.get('id')
  const listAll = searchParams.get('list')

  // List all conversations (for the conversation picker)
  if (listAll) {
    const { data: allConversations } = await supabase
      .from('conversations')
      .select('id, title, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(30)

    return NextResponse.json({ conversations: allConversations ?? [] })
  }

  // Fetch a specific conversation or the most recent active one
  let conversationQuery = supabase
    .from('conversations')
    .select('id, title, type, metadata')
    .eq('user_id', user.id)

  if (specificId) {
    conversationQuery = conversationQuery.eq('id', specificId)
  } else {
    conversationQuery = conversationQuery
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1)
  }

  const { data: conversations } = await conversationQuery

  const conversation = conversations?.[0] ?? null

  if (!conversation) {
    return NextResponse.json({ conversation: null, messages: [] })
  }

  // Fetch messages for this conversation (most recent 20)
  const { data: messages } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversation.id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  // Reverse to chronological order
  const orderedMessages = (messages ?? []).reverse()

  // Map to UIMessage format expected by useChat
  const uiMessages = orderedMessages.map((m) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant',
    content: m.content ?? '',
    createdAt: new Date(m.created_at),
    parts: [{ type: 'text', text: m.content ?? '' }],
  }))

  return NextResponse.json({
    conversation,
    messages: uiMessages,
  })
}
