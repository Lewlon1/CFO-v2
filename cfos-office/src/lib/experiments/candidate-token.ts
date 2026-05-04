import crypto from 'node:crypto'
import type { ObservationCandidate } from './types'

export interface SignedCandidatePayload {
  candidate: ObservationCandidate
  patternName: string
  question: string
  experimentText: string
  noticingTarget: string
  ts: number
}

// HMAC-signed envelope. Lets the modal echo a candidate back to
// /api/onboarding/save-experiment without us having to store pending state.
// Secret is the service-role key, which is process-local on the server.

export function signCandidatePayload(payload: SignedCandidatePayload, secret: string): string {
  const json = JSON.stringify(payload)
  const body = Buffer.from(json).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyCandidateToken(token: string, secret: string): SignedCandidatePayload {
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
