import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { composeFirstRead } from '@/lib/ai/compose-first-read'
import type { PriorReadSummary } from '@/lib/ai/prompts/first-read'
import type { HookCandidate } from '@/lib/ai/compose-first-read-hooks'
import {
  findLayeredFirstRead,
  appendAssistantFollowup,
  snapshotConversationMetadata,
} from '@/lib/insights/first-read-followup'
import { trackFunnelEvent, trackOnboardingError } from '@/lib/events/track-funnel-event'
import { NextResponse } from 'next/server'

/**
 * Value-first onboarding — after the user completes the optional Value Map
 * on their real transactions, Layer 2 (Stated Intent) is now populated. We
 * recompose the Read as a DELTA (mode 'value_first_recompose') and insert it
 * as a FOLLOW-UP assistant message into the same first_read conversation:
 *
 *   original Read (hook close)  →  user's Value Map  →  delta recompose
 *
 * The recompose is NOT a second First Read. It leads on what the user's sorting
 * unlocked, never restates Layer 1, never re-opens a hook, and closes on a
 * directive that hands into chat. We hand it a PriorReadSummary built from the
 * original assistant message + its persisted metadata so it knows what is
 * already said and must not be restated.
 */

type FirstReadMetaShape = {
  clusters_referenced?: string[] | null
  hook_candidates?: HookCandidate[] | null
}

function firstSentence(message: string): string {
  const trimmed = message.trim()
  return (trimmed.split(/(?<=[.!?])\s+|\n/)[0] ?? trimmed).trim()
}
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find the active layered first_read conversation. (post-upload marked
  // anything stale as completed before composing, so the active one is the
  // most recent.)
  const conversation = await findLayeredFirstRead(supabase, user.id)

  if (!conversation) {
    return NextResponse.json(
      { error: 'No first_read conversation to recompose into' },
      { status: 404 },
    )
  }

  const svc = createServiceClient()

  // Fetch the prior First Read — the first assistant message in this thread —
  // to build the do-not-restate contract. Failure here is non-fatal: we fall
  // back to a permissive PriorReadSummary (still recompose mode, just without
  // the merchant exclusion list).
  const prevMeta = (conversation.metadata as Record<string, unknown> | null) ?? {}
  const frMeta = (prevMeta.first_read_metadata as FirstReadMetaShape | undefined) ?? {}

  const { data: priorMsg } = await svc
    .from('messages')
    .select('content, created_at')
    .eq('conversation_id', conversation.id)
    .eq('role', 'assistant')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const hookCandidates =
    frMeta.hook_candidates ??
    (prevMeta.hook_candidates as HookCandidate[] | undefined) ??
    null
  const hookMerchantsUsed = (hookCandidates ?? [])
    .map((h) => h.label || h.cluster_id)
    .filter((s): s is string => Boolean(s))
  const merchantsAlreadyNamed = Array.from(
    new Set([...(frMeta.clusters_referenced ?? []), ...hookMerchantsUsed]),
  )

  const priorReadSummary: PriorReadSummary = {
    layer1Stated: true,
    goalStatedAsReveal: true,
    merchantsAlreadyNamed,
    hookMerchantsUsed,
    firstSentence: priorMsg?.content ? firstSentence(priorMsg.content as string) : null,
  }

  // The merchant keys the Value Map actually presented (Phase 1 selection),
  // persisted by the value-map page, so the recompose's payoff context knows
  // exactly what the user sorted.
  const valueMapCards = (prevMeta.value_map_cards as { keys?: string[] } | undefined)?.keys ?? []

  let composed: Awaited<ReturnType<typeof composeFirstRead>>
  try {
    composed = await composeFirstRead({
      userId: user.id,
      supabase: svc,
      mode: 'value_first_recompose',
      priorReadSummary,
      valueMapCardKeys: valueMapCards,
    })
  } catch (err) {
    console.error('[recompose-first-read] composeFirstRead failed:', err)
    await trackOnboardingError(supabase, user.id, 'recompose', err, { stage: 'compose' })
    return NextResponse.json({ error: 'Failed to recompose' }, { status: 500 })
  }

  // Append the follow-up message. Use the service client because messages
  // RLS may not accept inserts with role='assistant' from the user session.
  try {
    await appendAssistantFollowup(svc, {
      conversationId: conversation.id,
      userId: user.id,
      content: composed.composedMessage,
    })
  } catch (err) {
    console.error('[recompose-first-read] message insert failed:', err)
    await trackOnboardingError(supabase, user.id, 'recompose', err, { stage: 'append' })
    return NextResponse.json({ error: 'Failed to persist message' }, { status: 500 })
  }

  // Refresh the conversation's metadata snapshot so dashboards/cron see the
  // post-Value-Map composition state. Uses the same (user-session) client the
  // route used before; merges onto current metadata (matching the prior
  // `...prevMeta` spread — no concurrent metadata write happens between the
  // lookup above and here).
  await snapshotConversationMetadata(supabase, {
    conversationId: conversation.id,
    metadata: { first_read_metadata_recomposed: composed.metadata },
  })

  await trackFunnelEvent(supabase, {
    profileId: user.id,
    eventType: 'read_recomposed',
    payload: { conversation_id: conversation.id },
  })

  return NextResponse.json({
    conversationId: conversation.id,
    message_persisted: true,
    layers_used: composed.metadata.layers_used,
  })
}
