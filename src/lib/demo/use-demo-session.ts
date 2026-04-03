'use client'

import { useRef, useCallback } from 'react'
import type { ValueMapResult, ValueQuadrant } from '@/lib/value-map/types'

// ── Types ────────────────────────────────────────────────────────────────────

interface QuestionRecord {
  question_id: string
  question_text: string
  answer: string | null
  answer_index: number | null
  time_spent_ms: number
}

interface SessionPayload {
  session_token: string
  responses: Record<string, unknown>
  question_responses: QuestionRecord[]
  pain_point: string
  persona_fit: string
  score: number
  score_breakdown: Record<string, unknown>
  time_to_complete_ms: number
  questions_skipped: number
  drop_off_at: string | null
  reached_end: boolean
  referrer: string | null
  device_type: string | null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const QUADRANT_INDEX: Record<ValueQuadrant, number> = {
  foundation: 0,
  investment: 1,
  burden: 2,
  leak: 3,
}

function getDeviceType(): string {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent
  if (/iPad|Tablet/i.test(ua)) return 'tablet'
  if (/Mobi|Android/i.test(ua)) return 'mobile'
  return 'desktop'
}

function derivePainPoint(
  breakdown: Record<ValueQuadrant, { percentage: number }>
): string {
  if (breakdown.burden.percentage >= 30) return 'financial_burden'
  if (breakdown.leak.percentage >= 25) return 'spending_leaks'
  if (breakdown.foundation.percentage >= 50) return 'over_cautious'
  if (breakdown.investment.percentage >= 35) return 'growth_focused'
  return 'unclear'
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useDemoSession() {
  const tokenRef = useRef<string | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const responsesRef = useRef<QuestionRecord[]>([])
  const referrerRef = useRef<string | null>(null)
  const deviceTypeRef = useRef<string | null>(null)

  const startSession = useCallback(() => {
    if (tokenRef.current) return // already started
    tokenRef.current = crypto.randomUUID()
    startedAtRef.current = Date.now()
    referrerRef.current = typeof document !== 'undefined' ? document.referrer || null : null
    deviceTypeRef.current = getDeviceType()
  }, [])

  const recordResponse = useCallback(
    (result: ValueMapResult, questionText: string, cardIndex: number) => {
      responsesRef.current.push({
        question_id: `card_${cardIndex}`,
        question_text: questionText,
        answer: result.quadrant,
        answer_index: result.quadrant ? QUADRANT_INDEX[result.quadrant] : null,
        time_spent_ms: result.card_time_ms,
      })
    },
    []
  )

  const getSessionPayload = useCallback(
    (
      results: ValueMapResult[],
      personalityType: string,
      breakdown: Record<ValueQuadrant, { total: number; percentage: number; count: number }>,
      elapsedSeconds: number
    ): SessionPayload | null => {
      if (!tokenRef.current || !startedAtRef.current) return null

      const decided = results.filter((r) => r.quadrant !== null)
      const avgConfidence =
        decided.length > 0
          ? decided.reduce((sum, r) => sum + r.confidence, 0) / decided.length
          : 0

      return {
        session_token: tokenRef.current,
        responses: {
          results,
          elapsed_seconds: elapsedSeconds,
        },
        question_responses: responsesRef.current,
        pain_point: derivePainPoint(breakdown),
        persona_fit: personalityType,
        score: Math.round(avgConfidence * 20), // 1-5 confidence → 0-100 score
        score_breakdown: breakdown,
        time_to_complete_ms: Date.now() - startedAtRef.current,
        questions_skipped: results.filter((r) => r.hard_to_decide).length,
        drop_off_at: results.length < 10 ? `card_${results.length}` : null,
        reached_end: results.length >= 10,
        referrer: referrerRef.current,
        device_type: deviceTypeRef.current,
      }
    },
    []
  )

  return {
    get sessionToken() {
      return tokenRef.current
    },
    startSession,
    recordResponse,
    getSessionPayload,
  }
}
