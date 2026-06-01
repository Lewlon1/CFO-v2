import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { isLayeredReadEnabled } from '@/lib/feature-flags/layered-read';
import { WOW_EVENT_TYPES } from '@/lib/wow/event-types';

export const runtime = 'nodejs';

const EventSchema = z.object({
  event_type: z.enum(WOW_EVENT_TYPES),
  first_read_message_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export async function POST(req: NextRequest) {
  // When the flag is off (e.g. production), accept the call but no-op. This
  // keeps the client safe to ship under feature-flag gating without leaking
  // events into a table the prod schema doesn't yet have.
  if (!isLayeredReadEnabled()) {
    return NextResponse.json({ ok: true, skipped: 'flag_off' });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = EventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Ownership check: confirm the insight message belongs to this user before
  // accepting events that reference it.
  const { data: insight, error: insightErr } = await supabase
    .from('messages')
    .select('id, user_id, conversation_id')
    .eq('id', parsed.data.first_read_message_id)
    .maybeSingle();

  if (insightErr) {
    console.error('[wow/event] insight lookup failed:', insightErr.message);
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (!insight || insight.user_id !== user.id) {
    return NextResponse.json({ error: 'insight_not_found' }, { status: 404 });
  }

  const { error: insertErr } = await supabase.from('wow_events').insert({
    user_id: user.id,
    first_read_message_id: parsed.data.first_read_message_id,
    conversation_id: parsed.data.conversation_id,
    event_type: parsed.data.event_type,
    metadata: parsed.data.metadata,
  });

  // The partial unique index on (first_read_message_id, event_type) makes
  // duplicate inserts for delivered/scrolled/returned_d2/resonance_tap_*
  // collide. Swallow that — it is the intended idempotency behaviour.
  if (insertErr) {
    if (insertErr.code === '23505' || insertErr.message.includes('duplicate key')) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    console.error('[wow/event] insert failed:', insertErr.message);
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
