// HMAC-signed envelope for the wow moment candidate. Lets the modal echo
// the chosen evidence + Opus-authored beats back to /api/onboarding/save-experiment
// without us having to store pending state. Secret is the service-role key,
// which is process-local on the server.
//
// v3: signs the AuthoredWowMoment + the legacy fields needed by the
// active_experiments insert (observation_type enum, payload, etc). The v2
// shape is retained as a deprecated parallel verifier for any in-flight
// tokens at deploy boundary; new generations only emit v3.

import crypto from 'node:crypto'
import type { ObservationCandidate, ObservationType, Tier } from './types'

// ── v3 (current) ──────────────────────────────────────────────────────────

export interface SignedV3Payload {
  v: 3
  evidence_id: string
  tier: Tier
  // Mapped onto active_experiments.observation_type's enum constraint.
  legacy_observation_type: ObservationType
  // Real source captured for pattern_template_key + future Sunday callback.
  source: string
  // The four authored beats — also rendered in InsightBeat client-side, but
  // signed here so save-experiment writes EXACTLY what the user accepted.
  observed: string
  named: string
  asked: string
  proposed: string
  // Derived fields populated for active_experiments insert.
  noticing_target: string
  payload: Record<string, unknown>
  // Fallback flag so analytics can see when validation failed and we fell
  // back to the templated render.
  used_fallback: boolean
  ts: number
}

export function signV3Payload(payload: SignedV3Payload, secret: string): string {
  const json = JSON.stringify(payload)
  const body = Buffer.from(json).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `v3.${body}.${sig}`
}

export function verifyV3Token(token: string, secret: string): SignedV3Payload {
  if (!token.startsWith('v3.')) throw new Error('Not a v3 token')
  const rest = token.slice(3)
  const dot = rest.indexOf('.')
  if (dot === -1) throw new Error('Malformed candidate token')
  const body = rest.slice(0, dot)
  const sig = rest.slice(dot + 1)
  if (!body || !sig) throw new Error('Malformed candidate token')

  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid candidate token signature')
  }
  const json = Buffer.from(body, 'base64url').toString('utf-8')
  const parsed = JSON.parse(json) as SignedV3Payload
  if (parsed.v !== 3) throw new Error('Unexpected token version')
  return parsed
}

// ── v2 (deprecated — kept for in-flight tokens at deploy boundary) ────────

export interface SignedCandidatePayload {
  candidate: ObservationCandidate
  patternName: string
  question: string
  experimentText: string
  noticingTarget: string
  ts: number
}

export function signCandidatePayload(payload: SignedCandidatePayload, secret: string): string {
  const json = JSON.stringify(payload)
  const body = Buffer.from(json).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyCandidateToken(token: string, secret: string): SignedCandidatePayload {
  if (token.startsWith('v3.')) throw new Error('Use verifyV3Token for v3 tokens')
  const dot = token.indexOf('.')
  if (dot === -1) throw new Error('Malformed candidate token')
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!body || !sig) throw new Error('Malformed candidate token')

  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('Invalid candidate token signature')
  }

  const json = Buffer.from(body, 'base64url').toString('utf-8')
  return JSON.parse(json) as SignedCandidatePayload
}
