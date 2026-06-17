import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { composeFirstRead } from '@/lib/ai/compose-first-read'
import type { PriorReadSummary } from '@/lib/ai/prompts/first-read'
import { checkReadHardRules } from '@/lib/ai/read-judge'
import {
  findLayeredFirstRead,
  appendAssistantFollowup,
  refreshMerchantAggregates,
  claimUpgradeInProgress,
  clearUpgradeInProgress,
  markUpgraded,
  UPGRADED_KEY,
} from '@/lib/insights/first-read-followup'
import { NextResponse } from 'next/server'

/**
 * Declared → actual upgrade. A declared-mode first-Read user uploaded real
 * statements in-chat; we append a sharper transaction-based Read ("declared →
 * actual delta") as a FOLLOW-UP assistant message in the SAME first_read
 * conversation:
 *
 *   declared Read (free-cash + goal pace)  →  real upload  →  transaction Read
 *
 * Everything is server-derived from the session — no body required. The route
 * is one-click and re-triggerable from the client, so it carries a server-side
 * double-tap guard (claimUpgradeInProgress) plus a cheap idempotency pre-check.
 * The appended Read closes on the Value-Map next step (start_value_map_real),
 * which the runtime close assertion enforces — read-judge is not a hard gate at
 * compose time, so we assert it here before appending (CLAUDE.md Rule 1: a Read
 * must hand into an actionable next step). No new migration: progress + final
 * stamps live on conversations.metadata jsonb (Rule 3).
 */

// The Supabase JS client is generic over the DB schema; this route hands the
// orchestrator both the user-session and service clients as untyped handles so
// the orchestration is unit-testable with a plain mock. Reuse the helper's own
// (already-untyped) client parameter type rather than re-declaring `any` here.
type AnySupabase = Parameters<typeof findLayeredFirstRead>[0]

export type UpgradeDeclaredReadResult = {
  status: number
  body: Record<string, unknown>
}

function firstSentence(message: string): string {
  const trimmed = message.trim()
  return (trimmed.split(/(?<=[.!?])\s+|\n/)[0] ?? trimmed).trim()
}

/**
 * Pure-ish orchestration of the declared→actual upgrade, with clients injected
 * so it can be unit-tested without mocking the Supabase factories or next/server.
 * Returns a `{ status, body }` pair the POST handler turns into a NextResponse.
 *
 * Invariant: every non-success exit AFTER the claim (step 5) clears the
 * in-progress flag, and markUpgraded only runs on success.
 */
export async function runDeclaredReadUpgrade(args: {
  supabase: AnySupabase
  svc: AnySupabase
  userId: string
}): Promise<UpgradeDeclaredReadResult> {
  const { supabase, svc, userId } = args

  // 2. Find the active layered first_read conversation. (post-upload marked
  //    anything stale completed before composing, so the active one is newest.)
  const conversation = await findLayeredFirstRead(supabase, userId)
  if (!conversation) {
    return { status: 404, body: { upgraded: false, reason: 'no_layered_read' } }
  }
  const conversationId = conversation.id

  // 3. Cheap idempotency pre-check (the atomic guard is the claim in step 5).
  const meta = conversation.metadata ?? {}
  if (meta[UPGRADED_KEY] === true) {
    return {
      status: 200,
      body: { upgraded: false, reason: 'already_upgraded', conversationId },
    }
  }

  // 4. Transaction-count guard. A 0-row / all-duplicate import still triggers
  //    the client, so confirm the user actually has transactions before
  //    composing — composing on an empty dataset would hallucinate or re-state
  //    the declared numbers. Mirrors post-upload's count query (no date / no
  //    deleted_at filter — total transactions for the user).
  const { count: txnCount, error: txnCountError } = await supabase
    .from('transactions')
    .select('id', { head: true, count: 'exact' })
    .eq('user_id', userId)
  if (txnCountError) {
    console.error('[upgrade-declared-read] transaction count failed:', txnCountError)
    return { status: 500, body: { upgraded: false, reason: 'count_failed', conversationId } }
  }
  if ((txnCount ?? 0) === 0) {
    return { status: 200, body: { upgraded: false, reason: 'no_transactions', conversationId } }
  }

  // 5. Atomic double-tap claim. After this point, EVERY non-success exit must
  //    clear the in-progress flag so a retry can succeed.
  const { claimed } = await claimUpgradeInProgress(svc, conversationId)
  if (!claimed) {
    return { status: 409, body: { upgraded: false, reason: 'in_progress', conversationId } }
  }

  try {
    // 6. Refresh aggregates so the just-imported txns are visible to the
    //    value_first breakdown. Non-fatal (logs + continues on error).
    await refreshMerchantAggregates(supabase)

    // 7. Declared PriorReadSummary — the prior here is the DECLARED Read:
    //    income / fixed costs / free cash / goal pace were all announced, and it
    //    named no merchants (it saw no transactions). firstSentence drives the
    //    repeated_opening probe, derived from the declared assistant message.
    const { data: priorMsg } = await svc
      .from('messages')
      .select('content, created_at')
      .eq('conversation_id', conversationId)
      .eq('role', 'assistant')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    const priorReadSummary: PriorReadSummary = {
      layer1Stated: true,
      goalStatedAsReveal: true,
      merchantsAlreadyNamed: [],
      hookMerchantsUsed: [],
      firstSentence: priorMsg?.content ? firstSentence(priorMsg.content as string) : null,
    }

    // 8. Compose the transaction-based delta. The composer declines on a thin
    //    upload (no usable clusters / no hook candidates) WITHOUT calling the
    //    LLM — leave the declared Read as the last word and nudge for a fuller
    //    statement. Do NOT append, do NOT markUpgraded; DO clear in-progress.
    const composed = await composeFirstRead({
      userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: svc as any,
      mode: 'declared_upgrade',
      priorReadSummary,
    })

    if (composed.insufficientData) {
      await clearUpgradeInProgress(svc, conversationId)
      return {
        status: 200,
        body: { upgraded: false, reason: 'insufficient_data', conversationId },
      }
    }

    // 9. Runtime close assertion. read-judge is NOT a compose-time gate, so
    //    assert the Read is well-formed here: exactly one start_value_map_real
    //    CTA, not a question close, within the word cap, signed off. If it
    //    fails, do NOT ship a malformed Read — clear in-progress, don't append.
    const hardRules = checkReadHardRules(composed.composedMessage, { mode: 'value_first' })
    const failed = hardRules.filter((r) => !r.passed)
    if (failed.length > 0) {
      console.error(
        '[upgrade-declared-read] composed Read failed hard rules:',
        failed.map((r) => `${r.ruleId}${r.detail ? ` (${r.detail})` : ''}`).join('; '),
      )
      await clearUpgradeInProgress(svc, conversationId)
      return { status: 500, body: { upgraded: false, reason: 'bad_close', conversationId } }
    }

    // 10. Append the follow-up assistant message (service client — RLS may
    //     reject a user-session insert with role='assistant').
    await appendAssistantFollowup(svc, {
      conversationId,
      userId,
      content: composed.composedMessage,
    })

    // 11. Stamp the final upgrade: sets value_first_upgraded=true, clears
    //     in-progress, and snapshots the upgrade composition metadata — one
    //     write (markUpgraded merges the extra in the same round-trip).
    await markUpgraded(svc, conversationId, {
      first_read_metadata_upgraded: composed.metadata,
    })

    // 13. Success.
    return { status: 200, body: { upgraded: true, conversationId } }
  } catch (err) {
    // 12. Compose / append threw. Clear the in-progress flag so a retry can
    //     succeed, and never markUpgraded on failure.
    console.error('[upgrade-declared-read] upgrade failed:', err)
    try {
      await clearUpgradeInProgress(svc, conversationId)
    } catch (clearErr) {
      console.error('[upgrade-declared-read] failed to clear in-progress flag:', clearErr)
    }
    return { status: 500, body: { upgraded: false, reason: 'compose_failed', conversationId } }
  }
}

export async function POST() {
  // 1. Auth — match post-upload (401 when no user).
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const svc = createServiceClient()
  const { status, body } = await runDeclaredReadUpgrade({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svc: svc as any,
    userId: user.id,
  })
  return NextResponse.json(body, { status })
}
