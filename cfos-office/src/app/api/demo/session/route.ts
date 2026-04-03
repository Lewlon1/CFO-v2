import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// ── POST — Batch save session + question responses ──────────────────────────

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const {
      session_token,
      responses,
      question_responses,
      pain_point,
      persona_fit,
      score,
      score_breakdown,
      time_to_complete_ms,
      questions_skipped,
      drop_off_at,
      reached_end,
      referrer,
      device_type,
    } = body

    if (!session_token || !responses) {
      return NextResponse.json(
        { error: 'session_token and responses are required' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // Insert session
    const { data: session, error: sessionError } = await supabase
      .from('demo_sessions')
      .insert({
        session_token,
        responses,
        pain_point: pain_point ?? null,
        persona_fit: persona_fit ?? null,
        score: score ?? null,
        score_breakdown: score_breakdown ?? {},
        time_to_complete_ms: time_to_complete_ms ?? null,
        questions_skipped: questions_skipped ?? 0,
        drop_off_at: drop_off_at ?? null,
        reached_end: reached_end ?? false,
        referrer: referrer ?? null,
        device_type: device_type ?? null,
      })
      .select('id')
      .single()

    if (sessionError) {
      // Unique constraint violation on session_token
      if (sessionError.code === '23505') {
        return NextResponse.json(
          { error: 'Session already exists' },
          { status: 409 }
        )
      }
      console.error('Demo session insert error:', sessionError)
      return NextResponse.json(
        { error: 'Failed to save session' },
        { status: 500 }
      )
    }

    // Insert question responses if provided
    if (Array.isArray(question_responses) && question_responses.length > 0) {
      const rows = question_responses.map(
        (qr: {
          question_id: string
          question_text?: string
          answer?: string
          answer_index?: number
          time_spent_ms?: number
        }) => ({
          session_id: session.id,
          question_id: qr.question_id,
          question_text: qr.question_text ?? null,
          answer: qr.answer ?? null,
          answer_index: qr.answer_index ?? null,
          time_spent_ms: qr.time_spent_ms ?? null,
        })
      )

      const { error: qrError } = await supabase
        .from('demo_question_responses')
        .insert(rows)

      if (qrError) {
        console.error('Demo question responses insert error:', qrError)
        // Session was saved — don't fail the whole request
      }
    }

    return NextResponse.json({ success: true, session_id: session.id })
  } catch (error) {
    console.error('Demo session error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// ── PATCH — Update session fields (resonance rating, waitlist join) ─────────

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { session_id, ai_response_rating, ai_response_shown, waitlist_joined } = body

    if (!session_id) {
      return NextResponse.json(
        { error: 'session_id is required' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    const update: Record<string, unknown> = {}
    if (ai_response_rating !== undefined) update.ai_response_rating = ai_response_rating
    if (ai_response_shown !== undefined) update.ai_response_shown = ai_response_shown
    if (waitlist_joined !== undefined) update.waitlist_joined = waitlist_joined

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from('demo_sessions')
      .update(update)
      .eq('id', session_id)

    if (error) {
      console.error('Demo session update error:', error)
      return NextResponse.json(
        { error: 'Failed to update session' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Demo session PATCH error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
