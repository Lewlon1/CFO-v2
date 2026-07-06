import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { composeFirstRead, type DeclaredReadFacts } from '@/lib/ai/compose-first-read'
import { checkLlmAllowed, LLM_LIMIT_MESSAGE } from '@/lib/ai/llm-guard'
import type { PriorReadSummary } from '@/lib/ai/prompts/first-read'
import { checkReadHardRules } from '@/lib/ai/read-judge'
import {
  findLayeredFirstRead,
  appendAssistantFollowup,
  refreshMerchantAggregates,
  claimUpgradeInProgress,
  clearUpgradeInProgress,
  markUpgraded,
  setDeclaredReadPending,
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
 * Defensive parse of the declared-facts snapshot off conversation metadata.
 * Snapshot-only by design: conversations from before the snapshot shipped
 * (or a malformed value) return null and the upgrade composes without a
 * numeric delta — never a throw, never a guessed figure.
 */
export function parseDeclaredFactsSnapshot(value: unknown): DeclaredReadFacts | null {
  if (value == null || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (
    typeof v.income !== 'number' ||
    typeof v.totalFixedCosts !== 'number' ||
    typeof v.freeCash !== 'number' ||
    typeof v.currency !== 'string'
  ) {
    return null
  }
  return {
    income: v.income,
    totalFixedCosts: v.totalFixedCosts,
    freeCash: v.freeCash,
    goalName: typeof v.goalName === 'string' ? v.goalName : null,
    goalTargetAmount: typeof v.goalTargetAmount === 'number' ? v.goalTargetAmount : null,
    goalCurrentAmount: typeof v.goalCurrentAmount === 'number' ? v.goalCurrentAmount : null,
    goalTargetDate: typeof v.goalTargetDate === 'string' ? v.goalTargetDate : null,
    goalType: typeof v.goalType === 'string' ? v.goalType : null,
    // On-track/funded-at-plan framing needs explicit evidence in the snapshot —
    // older snapshots predate these fields, and false/null is the safe default
    // (the prompt then simply skips the on-track branch).
    fundedAtPlan: v.fundedAtPlan === true,
    planRatePct: typeof v.planRatePct === 'number' ? v.planRatePct : null,
    stressRatePct: typeof v.stressRatePct === 'number' ? v.stressRatePct : null,
    stressMonthly: typeof v.stressMonthly === 'number' ? v.stressMonthly : null,
    stressCovered: typeof v.stressCovered === 'boolean' ? v.stressCovered : null,
    monthlyRequiredSaving:
      typeof v.monthlyRequiredSaving === 'number' ? v.monthlyRequiredSaving : null,
    percentOfIncome: typeof v.percentOfIncome === 'number' ? v.percentOfIncome : null,
    unallocated: typeof v.unallocated === 'number' ? v.unallocated : null,
    currency: v.currency,
  }
}

// How many times to attempt markUpgraded before giving up. It's a single
// metadata update on a conversation we've already claimed, so a transient blip
// (network/DB hiccup) is worth a couple of cheap retries rather than failing the
// whole upgrade after the Read has already been delivered to the chat.
const MARK_UPGRADED_ATTEMPTS = 3

/**
 * Pure-ish orchestration of the declared→actual upgrade, with clients injected
 * so it can be unit-tested without mocking the Supabase factories or next/server.
 * Returns a `{ status, body }` pair the POST handler turns into a NextResponse.
 *
 * Invariant: every non-success exit AFTER the claim clears the in-progress flag
 * so a retry can succeed — EXCEPT the one case where the follow-up message was
 * already appended but the final stamp failed (see the catch). markUpgraded only
 * runs on success.
 */
export async function runDeclaredReadUpgrade(args: {
  supabase: AnySupabase
  svc: AnySupabase
  userId: string
}): Promise<UpgradeDeclaredReadResult> {
  const { supabase, svc, userId } = args

  // Clearing the in-progress flag must never mask the real outcome. If a clear
  // throws (e.g. on the insufficient_data / bad_close paths) and propagates, the
  // client gets the wrong reason code. Swallow + log here so the caller's chosen
  // exit status is the one that ships.
  const safeClear = async (conversationId: string): Promise<void> => {
    try {
      await clearUpgradeInProgress(svc, conversationId)
    } catch (clearErr) {
      console.error('[upgrade-declared-read] failed to clear in-progress flag:', clearErr)
    }
  }

  // Find the active layered first_read conversation. (post-upload marked
  // anything stale completed before composing, so the active one is newest.)
  const conversation = await findLayeredFirstRead(supabase, userId)
  if (!conversation) {
    return { status: 404, body: { upgraded: false, reason: 'no_layered_read' } }
  }
  const conversationId = conversation.id

  // Cheap idempotency pre-check (the atomic guard is the claim below).
  const meta = conversation.metadata ?? {}
  if (meta[UPGRADED_KEY] === true) {
    return {
      status: 200,
      body: { upgraded: false, reason: 'already_upgraded', conversationId },
    }
  }

  // Transaction-count guard. A 0-row / all-duplicate import still triggers
  // the client, so confirm the user actually has transactions before
  // composing — composing on an empty dataset would hallucinate or re-state
  // the declared numbers. Mirrors post-upload's count query (no date / no
  // deleted_at filter — total transactions for the user).
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

  // Atomic double-tap claim. After this point, EVERY non-success exit must
  // clear the in-progress flag so a retry can succeed — with one deliberate
  // exception once the follow-up message is appended (see the catch).
  const { claimed } = await claimUpgradeInProgress(svc, conversationId)
  if (!claimed) {
    return { status: 409, body: { upgraded: false, reason: 'in_progress', conversationId } }
  }

  // Tracks whether the follow-up assistant message has been appended. Once true,
  // the failure path must NOT clear the in-progress flag (a retry would append a
  // second Read). See the catch for the full reasoning.
  let appended = false

  try {
    // Refresh aggregates so the just-imported txns are visible to the
    // value_first breakdown. Non-fatal (logs + continues on error).
    await refreshMerchantAggregates(supabase)

    // Declared PriorReadSummary — the prior here is the DECLARED Read:
    // income / fixed costs / free cash / goal pace were all announced, and it
    // named no merchants (it saw no transactions). firstSentence drives the
    // repeated_opening probe, derived from the declared assistant message.
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

    // The declared-facts snapshot (persisted by post-upload when the declared
    // Read composed) is the BEFORE side of the numeric delta. Snapshot-only:
    // pre-snapshot conversations parse to null and the delta stays qualitative.
    const declaredPriorFacts = parseDeclaredFactsSnapshot(meta.declared_facts)

    // Compose the transaction-based delta. The composer declines on a thin
    // upload (no usable clusters / no hook candidates) WITHOUT calling the
    // LLM — leave the declared Read as the last word and nudge for a fuller
    // statement. Do NOT append, do NOT markUpgraded; DO clear in-progress.
    const composed = await composeFirstRead({
      userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: svc as any,
      mode: 'declared_upgrade',
      priorReadSummary,
      declaredPriorFacts,
    })

    if (composed.insufficientData) {
      await safeClear(conversationId)
      return {
        status: 200,
        body: { upgraded: false, reason: 'insufficient_data', conversationId },
      }
    }

    // Runtime close assertion. read-judge is NOT a compose-time gate, so
    // assert the Read is well-formed here: exactly one start_value_map_real
    // CTA, not a question close, within the word cap, signed off. If it
    // fails, do NOT ship a malformed Read — clear in-progress, don't append.
    const hardRules = checkReadHardRules(composed.composedMessage, { mode: 'value_first' })
    const failed = hardRules.filter((r) => !r.passed)
    if (failed.length > 0) {
      console.error(
        '[upgrade-declared-read] composed Read failed hard rules:',
        failed.map((r) => `${r.ruleId}${r.detail ? ` (${r.detail})` : ''}`).join('; '),
      )
      await safeClear(conversationId)
      return { status: 500, body: { upgraded: false, reason: 'bad_close', conversationId } }
    }

    // Append the follow-up assistant message (service client — RLS may
    // reject a user-session insert with role='assistant'). From this point the
    // Read is live in the chat: mark `appended` so the failure path knows not to
    // clear the claim and re-open a duplicate-append window.
    await appendAssistantFollowup(svc, {
      conversationId,
      userId,
      content: composed.composedMessage,
    })
    appended = true

    // The upgrade Read is delivered — clear the profile's declared-pending
    // flag NOW (not after the stamp), so a stamp_failed exit can't leave the
    // pinned meter / re-offer banner advertising an upgrade that already
    // landed. Non-fatal by construction; the conversation-level stamps below
    // stay the source of truth for the upgrade itself.
    await setDeclaredReadPending(svc, userId, null)

    // Stamp the final upgrade: sets value_first_upgraded=true, clears
    // in-progress, and snapshots the upgrade composition metadata — one
    // write (markUpgraded merges the extra in the same round-trip). Retry a
    // small number of times: the message is already delivered, so a transient
    // blip here must not be the thing that decides we couldn't finish. If every
    // attempt fails we fall through to the catch with `appended` already true.
    let stampErr: unknown = null
    for (let attempt = 1; attempt <= MARK_UPGRADED_ATTEMPTS; attempt++) {
      try {
        await markUpgraded(svc, conversationId, {
          first_read_metadata_upgraded: composed.metadata,
        })
        stampErr = null
        break
      } catch (err) {
        stampErr = err
        console.error(
          `[upgrade-declared-read] markUpgraded attempt ${attempt}/${MARK_UPGRADED_ATTEMPTS} failed:`,
          err,
        )
      }
    }
    if (stampErr) throw stampErr

    // Success.
    return { status: 200, body: { upgraded: true, conversationId } }
  } catch (err) {
    console.error('[upgrade-declared-read] upgrade failed:', err)

    if (appended) {
      // The follow-up Read is already in the chat but the final stamp didn't
      // land (value_first_upgraded is still false). DO NOT clear the in-progress
      // flag: leaving the conversation claimed makes any client retry 409 here,
      // which is exactly what we want — the alternative (clearing it) lets the
      // retry pass the idempotency pre-check, re-compose, and append a SECOND
      // in-chat Read, since the only dedup for the append is the post-append
      // stamp that just failed.
      //
      // Tradeoff (documented deliberately): a delivered-but-unstamped Read
      // intentionally blocks retries. This is rare (markUpgraded already retried
      // and is a single metadata write on a row we hold), strictly preferable to
      // duplicating an in-chat Read, and trivially resolvable by clearing the
      // in-progress flag on the conversation. The loud log above is the signal to
      // do so.
      return { status: 500, body: { upgraded: false, reason: 'stamp_failed', conversationId } }
    }

    // Nothing was appended (compose/judge/append itself threw before delivery):
    // clear the in-progress flag so a retry can succeed, and never markUpgraded.
    await safeClear(conversationId)
    return { status: 500, body: { upgraded: false, reason: 'compose_failed', conversationId } }
  }
}

export async function POST() {
  // Auth — match post-upload (401 when no user).
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // LLM cost guard — kill switch / per-user block / burst / daily cap. Lives
  // in this thin wrapper (not runDeclaredReadUpgrade) so the orchestration
  // stays unit-testable without the guard's real in-memory burst limiter.
  const guardVerdict = await checkLlmAllowed({
    userId: user.id,
    surface: 'first_read_compose',
    supabase,
  })
  if (!guardVerdict.allowed) {
    console.warn(`[upgrade-declared-read] llm-guard blocked user ${user.id}: ${guardVerdict.reason}`)
    return NextResponse.json({ error: 'limit', message: LLM_LIMIT_MESSAGE }, { status: 429 })
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
