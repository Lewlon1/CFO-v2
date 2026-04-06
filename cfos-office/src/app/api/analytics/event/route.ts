import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { event_name, metadata, session_id } = await req.json();

  if (!event_name || typeof event_name !== 'string') {
    return NextResponse.json({ error: 'event_name required' }, { status: 400 });
  }

  // Derive category from event name
  const category = metadata?.event_category as string | undefined;
  const eventCategory = category
    ?? (event_name.includes('corrected') || event_name.includes('feedback') ? 'correction'
      : event_name.includes('upload') ? 'upload'
      : event_name.includes('value_map') ? 'funnel'
      : event_name === 'sign_in' ? 'session'
      : 'engagement');

  const { error } = await supabase.from('user_events').insert({
    profile_id: user.id,
    event_type: event_name,
    event_category: eventCategory,
    payload: metadata ?? {},
    session_id: session_id ?? null,
  });

  if (error) {
    console.error('[analytics] event insert failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
