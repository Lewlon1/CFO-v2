import { describe, it, expect } from 'vitest'
import {
  decideUpgradeAction,
  INSUFFICIENT_DATA_NUDGE,
  NO_TRANSACTIONS_NUDGE,
} from './upgrade-response'

describe('decideUpgradeAction', () => {
  it('success (200 upgraded:true) → load_and_close with the conversationId', () => {
    const action = decideUpgradeAction(200, { upgraded: true, conversationId: 'c1' })
    expect(action).toEqual({ kind: 'load_and_close', conversationId: 'c1' })
  })

  it('success without a conversationId → falls through to retry (defensive)', () => {
    // The route always sends conversationId on success; if it somehow doesn't,
    // we must not call loadConversation(undefined). Retry is the safe default.
    const action = decideUpgradeAction(200, { upgraded: true })
    expect(action).toEqual({ kind: 'retry' })
  })

  it('insufficient_data → notify_close with the thin-upload nudge', () => {
    const action = decideUpgradeAction(200, {
      upgraded: false,
      reason: 'insufficient_data',
      conversationId: 'c1',
    })
    expect(action).toEqual({ kind: 'notify_close', message: INSUFFICIENT_DATA_NUDGE })
  })

  it('already_upgraded with conversationId → load_and_close (refresh, no scary error)', () => {
    const action = decideUpgradeAction(200, {
      upgraded: false,
      reason: 'already_upgraded',
      conversationId: 'c1',
    })
    expect(action).toEqual({ kind: 'load_and_close', conversationId: 'c1' })
  })

  it('no_transactions → notify_close with the zero-row nudge (never a silent close)', () => {
    // The user just watched "Reading your statements…" — a quiet close is
    // indistinguishable from success. The declared Read is unchanged, so no
    // reload; the nudge is the response their effort earns.
    const action = decideUpgradeAction(200, {
      upgraded: false,
      reason: 'no_transactions',
      conversationId: 'c1',
    })
    expect(action).toEqual({ kind: 'notify_close', message: NO_TRANSACTIONS_NUDGE })
  })

  it('no_layered_read (404, no conversationId) → close quietly', () => {
    const action = decideUpgradeAction(404, {
      upgraded: false,
      reason: 'no_layered_read',
    })
    expect(action).toEqual({ kind: 'close' })
  })

  it('in_progress (409) with conversationId → load_and_close (the in-flight one delivers)', () => {
    const action = decideUpgradeAction(409, {
      upgraded: false,
      reason: 'in_progress',
      conversationId: 'c1',
    })
    expect(action).toEqual({ kind: 'load_and_close', conversationId: 'c1' })
  })

  it('in_progress (409) without conversationId → close (do nothing destructive)', () => {
    const action = decideUpgradeAction(409, {
      upgraded: false,
      reason: 'in_progress',
    })
    expect(action).toEqual({ kind: 'close' })
  })

  it.each([
    'bad_close',
    'compose_failed',
    'count_failed',
  ])('500 %s → retry (transactions already imported)', (reason) => {
    const action = decideUpgradeAction(500, { upgraded: false, reason })
    expect(action).toEqual({ kind: 'retry' })
  })

  it('stamp_failed with conversationId → load_and_close (the Read is already live)', () => {
    // The route returns stamp_failed only AFTER the follow-up message appended
    // — the user's upgraded Read exists, so show it instead of a false failure.
    const action = decideUpgradeAction(500, {
      upgraded: false,
      reason: 'stamp_failed',
      conversationId: 'c1',
    })
    expect(action).toEqual({ kind: 'load_and_close', conversationId: 'c1' })
  })

  it('stamp_failed without conversationId → retry (defensive; the route always sends one)', () => {
    const action = decideUpgradeAction(500, { upgraded: false, reason: 'stamp_failed' })
    expect(action).toEqual({ kind: 'retry' })
  })

  it('unparseable body (null) → retry', () => {
    const action = decideUpgradeAction(502, null)
    expect(action).toEqual({ kind: 'retry' })
  })

  it('unrecognised reason → retry (safe default)', () => {
    const action = decideUpgradeAction(500, { upgraded: false, reason: 'who_knows' })
    expect(action).toEqual({ kind: 'retry' })
  })
})
