// Session 083 — error reports filed against a First Read.
//
// One POST per report. Unlike the ratings this replaced (MessageFeedback's
// thumbs, ResonanceTap's yes/no), a report is meant to become a diff: it lands
// with the Read's identity, the exact prose the user was looking at, and the
// computed figures that Read cited. Read back at /admin/wow/[insightId].
//
// Shape follows /api/wow/event: zod at the door, an ownership check on the
// referenced message before we accept anything about it, generic 500s.
//
// The snapshotting is the load-bearing part. citation_set and read_context are
// COPIED onto the row here rather than joined at read time, because the
// recompose and declared-upgrade paths overwrite
// conversations.metadata.first_read_metadata underneath an existing report —
// join it later and you would be reading a different Read than the one the user
// complained about.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';
import { MAX_REPORT_LENGTH } from '@/lib/reads/feedback-contract';

export const runtime = 'nodejs';

const ReportSchema = z.object({
  first_read_message_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  body: z.string().trim().min(1).max(MAX_REPORT_LENGTH),
});

/** The composition context worth keeping, so reports can be sliced by how the Read was built. */
type FirstReadMetadataShape = {
  citation_set?: unknown;
  mode?: unknown;
  read_recipe?: unknown;
  layers_used?: unknown;
  is_recompose?: unknown;
};

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = ReportSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Ownership: confirm the Read belongs to this user before storing anything
  // that references it. `content` doubles as the prose snapshot.
  const { data: read, error: readErr } = await supabase
    .from('messages')
    .select('id, user_id, content')
    .eq('id', parsed.data.first_read_message_id)
    .maybeSingle();

  if (readErr) {
    console.error('[reads/feedback] read lookup failed:', readErr.message);
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (!read || read.user_id !== user.id) {
    return NextResponse.json({ error: 'read_not_found' }, { status: 404 });
  }

  // Composition context. Every branch here degrades to an empty default rather
  // than failing: a Read composed before 083 shipped has no citation_set, and
  // losing the user's actual words to a missing metadata key would be the worst
  // possible trade.
  const { data: conversation } = await supabase
    .from('conversations')
    .select('metadata')
    .eq('id', parsed.data.conversation_id)
    .maybeSingle();

  const firstReadMeta = ((conversation?.metadata as { first_read_metadata?: unknown } | null)
    ?.first_read_metadata ?? {}) as FirstReadMetadataShape;

  const citationSet = Array.isArray(firstReadMeta.citation_set) ? firstReadMeta.citation_set : [];

  const { error: insertErr } = await supabase.from('read_feedback').insert({
    user_id: user.id,
    first_read_message_id: parsed.data.first_read_message_id,
    conversation_id: parsed.data.conversation_id,
    body: parsed.data.body,
    read_snapshot: read.content ?? null,
    citation_set: citationSet,
    read_context: {
      mode: firstReadMeta.mode ?? null,
      read_recipe: firstReadMeta.read_recipe ?? null,
      layers_used: Array.isArray(firstReadMeta.layers_used) ? firstReadMeta.layers_used : [],
      is_recompose: firstReadMeta.is_recompose ?? false,
    },
  });

  if (insertErr) {
    console.error('[reads/feedback] insert failed:', insertErr.message);
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
