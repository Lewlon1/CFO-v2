import { NextRequest, NextResponse } from 'next/server';

import { createServiceClient } from '@/lib/supabase/service';
import { computeRealisedScore } from '@/lib/wow/realised-score';
import type { WowEvent } from '@/lib/wow/event-types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const LOOKBACK_HOURS = 48;

type FirstInsightRow = {
  message_id: string;
  message_created_at: string;
  user_id: string;
  conversation_id: string;
  conversation_metadata: Record<string, unknown> | null;
};

// Daily aggregation that pairs realised behaviour signals with each first
// Read delivery. Identifies first-insight messages by joining messages →
// conversations where type = 'first_insight' AND metadata->>layered_read =
// 'true' (Session B layered path only — V1/V2 narrate-via-trigger
// conversations are excluded). Idempotent via the unique constraint on
// wow_assessments.first_insight_message_id.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  // Pull candidate first-insight messages. The join is expressed via a
  // foreign-key inner select so we get conversation metadata in the same trip.
  const { data: candidates, error: queryErr } = await supabase
    .from('messages')
    .select(
      `
      id,
      created_at,
      user_id,
      conversation_id,
      conversations!inner(id, type, status, metadata)
    `,
    )
    .eq('role', 'assistant')
    .is('deleted_at', null)
    .gt('created_at', cutoff)
    .eq('conversations.type', 'first_insight')
    .order('created_at', { ascending: true });

  if (queryErr) {
    console.error('[cron/wow-aggregate] candidate query failed:', queryErr.message);
    return NextResponse.json(
      { error: 'query_failed', detail: queryErr.message },
      { status: 500 },
    );
  }

  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ processed: 0, d2_inserted: 0 });
  }

  // Reduce to the first assistant message per conversation, and only conversations
  // flagged as layered (metadata.layered_read === true). Pre-layered first-insight
  // conversations narrate via [System: ...] trigger — they have no pre-written
  // assistant message we can score against and predate this measurement layer.
  const firstPerConv = new Map<string, FirstInsightRow>();
  for (const row of candidates as Array<{
    id: string;
    created_at: string;
    user_id: string | null;
    conversation_id: string;
    conversations:
      | { id: string; type: string | null; status: string | null; metadata: Record<string, unknown> | null }
      | Array<{ id: string; type: string | null; status: string | null; metadata: Record<string, unknown> | null }>;
  }>) {
    if (!row.user_id) continue;
    const conv = Array.isArray(row.conversations) ? row.conversations[0] : row.conversations;
    if (!conv) continue;
    const meta = (conv.metadata ?? {}) as Record<string, unknown>;
    if (meta.layered_read !== true) continue;
    if (firstPerConv.has(row.conversation_id)) continue;
    firstPerConv.set(row.conversation_id, {
      message_id: row.id,
      message_created_at: row.created_at,
      user_id: row.user_id,
      conversation_id: row.conversation_id,
      conversation_metadata: meta,
    });
  }

  let processed = 0;
  let d2Inserted = 0;

  for (const insight of firstPerConv.values()) {
    // 1. D2 return detection. The window is the *calendar day after* delivery
    //    (UTC). Only check once the window has fully closed — otherwise we
    //    might insert returned_d2 = false on a user who returns later that day.
    const deliveredAt = new Date(insight.message_created_at);
    const nextDayStart = new Date(deliveredAt);
    nextDayStart.setUTCHours(0, 0, 0, 0);
    nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);
    const nextDayEnd = new Date(nextDayStart);
    nextDayEnd.setUTCDate(nextDayEnd.getUTCDate() + 1);

    if (nextDayEnd.getTime() <= Date.now()) {
      const { data: activity } = await supabase
        .from('messages')
        .select('id')
        .eq('user_id', insight.user_id)
        .eq('role', 'user')
        .gte('created_at', nextDayStart.toISOString())
        .lt('created_at', nextDayEnd.toISOString())
        .limit(1);

      if (activity && activity.length > 0) {
        const { error: d2Err } = await supabase.from('wow_events').insert({
          user_id: insight.user_id,
          first_insight_message_id: insight.message_id,
          conversation_id: insight.conversation_id,
          event_type: 'returned_d2',
          metadata: { aggregator_source: 'wow-aggregate-cron' },
        });
        if (!d2Err) {
          d2Inserted++;
        } else if (d2Err.code !== '23505' && !d2Err.message.includes('duplicate key')) {
          // 23505 = unique violation; expected when this insight already has a
          // returned_d2 row. Anything else is a real failure worth surfacing.
          console.error(
            '[cron/wow-aggregate] returned_d2 insert failed for',
            insight.message_id,
            d2Err.message,
          );
        }
      }
    }

    // 2. Fetch all events for this insight and compute realised score.
    const { data: events } = await supabase
      .from('wow_events')
      .select('id, user_id, first_insight_message_id, conversation_id, event_type, metadata, created_at')
      .eq('first_insight_message_id', insight.message_id);

    const score = computeRealisedScore((events ?? []) as WowEvent[]);

    // 3. Snapshot composition metadata from the conversation row.
    const firstRead = (insight.conversation_metadata?.first_read_metadata ?? {}) as {
      layers_used?: unknown;
      features_cited?: unknown;
      gap_present?: unknown;
      clusters_referenced?: unknown;
    };
    const layersUsed = Array.isArray(firstRead.layers_used) ? firstRead.layers_used : [];
    const featuresCited = Array.isArray(firstRead.features_cited) ? firstRead.features_cited : [];
    const clustersReferenced = Array.isArray(firstRead.clusters_referenced)
      ? firstRead.clusters_referenced
      : [];
    const gapPresent = firstRead.gap_present === true;

    const nowIso = new Date().toISOString();
    const { error: upsertErr } = await supabase
      .from('wow_assessments')
      .upsert(
        {
          user_id: insight.user_id,
          first_insight_message_id: insight.message_id,
          conversation_id: insight.conversation_id,
          delivered_at: insight.message_created_at,
          predicted_wow_score: null,
          judge_id: null,
          realised_wow_score: score.realised_wow_score,
          in_session_score: score.in_session_score,
          overnight_score: score.overnight_score,
          last_aggregated_at: nowIso,
          gap_present: gapPresent,
          layers_used: layersUsed,
          features_cited: featuresCited,
          clusters_referenced: clustersReferenced,
          updated_at: nowIso,
        },
        { onConflict: 'first_insight_message_id' },
      );

    if (upsertErr) {
      console.error(
        '[cron/wow-aggregate] upsert failed for',
        insight.message_id,
        upsertErr.message,
      );
      continue;
    }

    processed++;
  }

  return NextResponse.json({ processed, d2_inserted: d2Inserted, candidate_count: firstPerConv.size });
}
