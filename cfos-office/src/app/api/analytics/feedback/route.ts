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

  const { message_id, rating, comment } = await req.json();

  if (!message_id || ![-1, 1].includes(rating)) {
    return NextResponse.json(
      { error: 'message_id and rating (-1 or 1) required' },
      { status: 400 }
    );
  }

  const { error } = await supabase.from('message_feedback').upsert(
    {
      message_id,
      user_id: user.id,
      rating,
      comment: comment ?? null,
    },
    { onConflict: 'message_id,user_id' }
  );

  if (error) {
    console.error('[feedback] Insert failed:', error);
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
