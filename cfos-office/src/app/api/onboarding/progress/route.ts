import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { OnboardingState } from '@/lib/onboarding/types'

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const progress: OnboardingState = await req.json()

  if (!progress || !progress.beat) {
    return NextResponse.json({ error: 'Invalid progress' }, { status: 400 })
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ onboarding_progress: progress })
    .eq('id', user.id)

  if (error) {
    console.error('[onboarding] progress update failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
