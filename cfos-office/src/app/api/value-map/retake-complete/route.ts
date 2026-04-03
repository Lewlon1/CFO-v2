import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { personalityType, dominantQuadrant, valueMapInsights } = await req.json()

  // Upsert user_intelligence with the new personality (requires service role)
  if (personalityType) {
    const serviceClient = createServiceClient()
    const now = new Date().toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (serviceClient as any).from('user_intelligence').upsert(
      {
        profile_id: user.id,
        personality_type: personalityType,
        dominant_quadrant: dominantQuadrant ?? null,
        value_map_insights: valueMapInsights ?? {},
        updated_at: now,
        last_interaction_at: now,
      },
      { onConflict: 'profile_id' },
    )
  }

  return Response.json({ success: true })
}
