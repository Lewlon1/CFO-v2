import { createServiceClient } from '@/lib/supabase/service'

interface SignupRequest {
  name: string
  email: string
  country: string
  personality: string | null
  reading_text: string | null
  results_json: Record<string, unknown> | null
  resonance_rating?: number | null
  session_id?: string | null
  consent: boolean
}

export async function POST(req: Request) {
  try {
    const body: SignupRequest = await req.json()
    const { name, email, country, personality, reading_text, results_json, resonance_rating, session_id, consent } = body

    if (!email || !name || !country) {
      return Response.json({ error: 'Name, email, and country are required' }, { status: 400 })
    }

    // Consent is required — do not store without it
    if (!consent) {
      return Response.json({ error: 'Consent is required' }, { status: 400 })
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: 'Invalid email format' }, { status: 400 })
    }

    // Validate resonance rating if provided
    if (resonance_rating != null && (resonance_rating < 1 || resonance_rating > 5 || !Number.isInteger(resonance_rating))) {
      return Response.json({ error: 'Resonance rating must be an integer between 1 and 5' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const consentTimestamp = new Date().toISOString()

    const { error } = await supabase
      .from('demo_waitlist')
      .upsert(
        {
          name,
          email,
          country,
          personality,
          reading_text,
          results_json,
          resonance_rating: resonance_rating ?? null,
          session_id: session_id ?? null,
          consent_given_at: consentTimestamp,
        },
        { onConflict: 'email' },
      )

    if (error) {
      console.error('Waitlist signup error:', error)
      return Response.json({ error: 'Failed to save signup' }, { status: 500 })
    }

    // Mark session as waitlist joined (fire-and-forget)
    if (session_id) {
      supabase
        .from('demo_sessions')
        .update({ waitlist_joined: true })
        .eq('id', session_id)
        .then(({ error: updateErr }) => {
          if (updateErr) console.error('Session waitlist update error:', updateErr)
        })
    }

    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Failed to process signup' }, { status: 500 })
  }
}
