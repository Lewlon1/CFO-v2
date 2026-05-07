import { createServiceClient } from '@/lib/supabase/service'
import { extractFromConversation } from '@/lib/ai/portrait-extraction'
import { sendAlert } from '@/lib/alerts/notify'

// Thin wrapper around `extractFromConversation`. Preserved as an HTTP entry
// point for any external triggers (cron with Bearer auth, future webhooks).
// In-process callers (chat, review/start, cron) should call the library
// function directly via Next.js `after()` instead of round-tripping HTTP.
export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { conversation_id, user_id } = await req.json()
  if (!conversation_id || !user_id) {
    return Response.json({ error: 'Missing params' }, { status: 400 })
  }

  const supabase = createServiceClient()

  try {
    const result = await extractFromConversation(supabase, {
      conversationId: conversation_id,
      userId: user_id,
    })
    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[analyze-conversation] extraction failed:', message)
    void sendAlert({
      severity: 'critical',
      event: 'portrait_extraction_failed',
      user_id,
      details: message,
      metadata: { conversation_id, source: 'analyze-conversation_route' },
    })
    return Response.json({ error: 'Analysis failed' }, { status: 500 })
  }
}
