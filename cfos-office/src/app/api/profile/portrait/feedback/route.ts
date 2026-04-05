import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { traitId, accurate } = await req.json()

  if (!traitId || typeof accurate !== 'boolean') {
    return NextResponse.json(
      { error: 'traitId (string) and accurate (boolean) required' },
      { status: 400 }
    )
  }

  const { data: trait } = await supabase
    .from('financial_portrait')
    .select('id, confidence')
    .eq('id', traitId)
    .eq('user_id', user.id)
    .single()

  if (!trait) {
    return NextResponse.json({ error: 'Trait not found' }, { status: 404 })
  }

  const newConfidence = accurate
    ? Math.min(1.0, trait.confidence + 0.15)
    : Math.max(0.1, trait.confidence - 0.3)

  const { error } = await supabase
    .from('financial_portrait')
    .update({ confidence: newConfidence })
    .eq('id', traitId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    previousConfidence: trait.confidence,
    newConfidence,
  })
}
