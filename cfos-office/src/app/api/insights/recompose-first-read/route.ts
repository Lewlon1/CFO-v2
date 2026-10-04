import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { composeFirstRead } from '@/lib/ai/compose-first-read'
import { checkLlmAllowed, LLM_LIMIT_MESSAGE } from '@/lib/ai/llm-guard'
import type { PriorReadSummary } from '@/lib/ai/prompts/first-read'
import type { HookCandidate } from '@/lib/ai/compose-first-read-hooks'
import {
  findLayeredFirstRead,
  appendAssistantFollowup,
  snapshotConversationMetadata,
} from '@/lib/insights/first-read-followup'
import { trackFunnelEvent, trackOnboardingError } from '@/lib/events/track-funnel-event'
import { fileComposedRead } from '@/lib/memory/documents'
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

// Recompose idempotency keys on conversations.metadata (no migration —
// CLAUDE.md Rule 3). RECOMPOSED_KEY predates this guard (always written,
// never read back until now); the in-progress key mirrors the upgrade
// route's claim.
const RECOMPOSED_KEY = 'first_read_metadata_recomposed'
const RECOMPOSE_IN_PROGRESS_KEY = 'recompose_in_progress'

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

  // LLM cost guard — kill switch / per-user block / burst / daily cap.
  const guardVerdict = await checkLlmAllowed({
    userId: user.id,
    surface: 'first_read_compose',
    supabase,
  })
  if (!guardVerdict.allowed) {
    console.warn(`[recompose-first-read] llm-guard blocked user ${user.id}: ${guardVerdict.reason}`)
    return NextResponse.json({ error: 'limit', message: LLM_LIMIT_MESSAGE }, { status: 429 })
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

  const prevMeta = (conversation.metadata as Record<string, unknown> | null) ?? {}

  // Idempotency pre-check: the recompose's legit cardinality is once per
  // layered first_read conversation, and the stamp below has always been
  // written — it was just never read back, so every repeated POST re-composed
  // and appended a duplicate delta Read (a cost + UX hole). Benign 200 with
  // the conversationId keeps the client working (it only reads that field).
  if (prevMeta[RECOMPOSED_KEY] != null) {
    return NextResponse.json({
      conversationId: conversation.id,
      message_persisted: false,
      reason: 'already_recomposed',
    })
  }

  // Atomic claim for the concurrent window (two POSTs racing past the
  // pre-check). Same null-aware conditional-update shape as
  // claimUpgradeInProgress: the WHERE re-checks BOTH flags at write time, so
  // only one caller ever composes. The success path clears the claim in the
  // same write as the stamp; failures clear it best-effort below.
  const { data: claimed } = await svc
    .from('conversations')
    .update({
      metadata: { ...prevMeta, [RECOMPOSE_IN_PROGRESS_KEY]: true },
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)
    .or(
      `metadata->>${RECOMPOSE_IN_PROGRESS_KEY}.is.null,metadata->>${RECOMPOSE_IN_PROGRESS_KEY}.neq.true`,
    )
    .is(`metadata->>${RECOMPOSED_KEY}`, null)
    .select('id')
    .maybeSingle()
  if (!claimed) {
    return NextResponse.json(
      { conversationId: conversation.id, message_persisted: false, reason: 'in_progress' },
      { status: 409 },
    )
  }

  // Fetch the prior First Read — the first assistant message in this thread —
  // to build the do-not-restate contract. Failure here is non-fatal: we fall
  // back to a permissive PriorReadSummary (still recompose mode, just without
  // the merchant exclusion list).
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

  // Any failure between the claim above and the stamp below must release the
  // claim so a retry can succeed (best-effort — a failed clear self-heals only
  // via manual metadata fix, mirrored on the upgrade route's tradeoff).
  const clearClaim = async () => {
    try {
      await snapshotConversationMetadata(svc, {
        conversationId: conversation.id,
        metadata: { [RECOMPOSE_IN_PROGRESS_KEY]: false },
      })
    } catch (clearErr) {
      console.error('[recompose-first-read] failed to clear in-progress claim:', clearErr)
    }
  }

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
    await clearClaim()
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
    await clearClaim()
    await trackOnboardingError(supabase, user.id, 'recompose', err, { stage: 'append' })
    return NextResponse.json({ error: 'Failed to persist message' }, { status: 500 })
  }

  // Refresh the conversation's metadata snapshot so dashboards/cron see the
  // post-Value-Map composition state, and clear the in-progress claim in the
  // SAME write — the stamp is what the pre-check and the claim's WHERE test,
  // so from here repeated POSTs are benign no-ops.
  await snapshotConversationMetadata(supabase, {
    conversationId: conversation.id,
    metadata: {
      first_read_metadata_recomposed: composed.metadata,
      [RECOMPOSE_IN_PROGRESS_KEY]: false,
    },
  })

  await trackFunnelEvent(supabase, {
    profileId: user.id,
    eventType: 'read_recomposed',
    payload: { conversation_id: conversation.id },
  })

  // Append the rewrite to the filed Read in Values & You, so the user keeps the
  // version they first read alongside the one that replaced it.
  await fileComposedRead(supabase, user.id, {
    content: composed.composedMessage,
    variant: 'value_first_recompose',
  })

  return NextResponse.json({
    conversationId: conversation.id,
    message_persisted: true,
    layers_used: composed.metadata.layers_used,
  })
}
