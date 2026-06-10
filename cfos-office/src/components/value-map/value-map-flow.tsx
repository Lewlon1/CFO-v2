'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { useTrackEvent } from '@/lib/events/use-track-event'
import { Button } from '@/components/ui/button'
import { CFOAvatar } from '@/components/brand/CFOAvatar'
import { CfoThinking } from '@/components/brand/CfoThinking'
import { ValueMapCard } from './value-map-card'
import { ValueMapSummary } from './value-map-summary'
import { CutOrKeep } from './cut-or-keep'
import { OneThing } from './one-thing'
import { RetakeImpact } from './retake-impact'
import { calculatePersonality } from '@/lib/value-map/personalities'
import { SAMPLE_TRANSACTIONS, QUADRANTS, QUADRANT_ORDER } from '@/lib/value-map/constants'
import {
  VALUE_MAP_INTRO_HERO,
  VALUE_MAP_INTRO_SUBHEADS,
  VALUE_MAP_INTRO_EXPLAINER,
  VALUE_MAP_INTRO_HOW,
  VALUE_MAP_INTRO_UNSURE_BUCKET,
} from '@/lib/value-map/copy'
import type { ValueMapTransaction, ValueMapResult } from '@/lib/value-map/types'
import { createClient } from '@/lib/supabase/client'
import { VCR_ON_CONFLICT } from '@/lib/prediction/types'
import { categoriseTransaction, type MerchantMapping } from '@/lib/categorisation/categorise-transaction'
import { cardConvictionToRuleConfidence } from '@/lib/categorisation/value-config'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { aiCategoriseBatch } from '@/lib/categorisation/ai-categorise'

// ── Types ────────────────────────────────────────────────────────────────────

type FlowStep =
  | 'intro'
  | 'exercise'
  | 'summary'
  | 'cut_or_keep'
  | 'one_thing'
  | 'checkin_loading'
  | 'checkin_empty'
  | 'checkin_saving'
  | 'personal_loading'
  | 'personal_empty'
  | 'personal_saving'
  | 'impact_summary'

interface ValueMapFlowProps {
  currency: string
  mode?: 'onboarding' | 'checkin' | 'personal'
  returnTo?: 'archetype' | null
  onComplete?: (personalityType: string, dominantQuadrant: string, breakdown: Record<string, { total: number; percentage: number; count: number }>, results?: ValueMapResult[]) => void
  onTransactionResult?: (result: ValueMapResult, index: number, total: number) => void
  /**
   * Value-first onboarding: real flagged transactions derived from the First
   * Read's hook candidates. When provided in onboarding mode, replaces the
   * curated SAMPLE_TRANSACTIONS so the user maps the exact items the CFO
   * said it couldn't read without them — the engagement linchpin of the
   * value-first flow. Empty array or undefined falls back to samples.
   */
  realTransactions?: ValueMapTransaction[]
}

// ── Component ────────────────────────────────────────────────────────────────

export function ValueMapFlow({
  currency,
  mode = 'onboarding',
  returnTo = null,
  onComplete,
  onTransactionResult,
  realTransactions,
}: ValueMapFlowProps) {
  const router = useRouter()
  const trackEvent = useTrackEvent()
  // Same signal handleStart uses to choose real transactions over samples: a
  // value-first journey passes the user's own flagged transactions. When it
  // does, the "you'll start with samples" expectation-setting in the intro is
  // false, so that section is dropped (see the intro render below).
  const hasRealTransactions = !!(realTransactions && realTransactions.length > 0)
  const [step, setStep] = useState<FlowStep>(
    mode === 'checkin' ? 'checkin_loading' : mode === 'personal' ? 'personal_loading' : 'intro',
  )
  const [transactions, setTransactions] = useState<ValueMapTransaction[]>([])
  const [results, setResults] = useState<ValueMapResult[]>([])
  const [isRealData, setIsRealData] = useState(false)
  const [checkinError, setCheckinError] = useState<string | null>(null)
  const [personalError, setPersonalError] = useState<string | null>(null)
  const [retakeId, setRetakeId] = useState<string | null>(null)

  const [cutDecisions, setCutDecisions] = useState<Array<{ transaction_id: string; cut: boolean }>>([])
  const [oneThing, setOneThing] = useState('')

  // Guard against handleExerciseComplete being invoked more than once per
  // session. Independent of the useTrackEvent memoisation fix, the Value Map
  // card flow has several async transitions and this ref guarantees the
  // funnel events fire exactly once even if a late re-render triggers the
  // callback again.
  const completionTrackedRef = useRef(false)

  // Rotating hero subhead on the onboarding intro (mirrors demo-flow).
  const [introSubhead, setIntroSubhead] = useState<string>(VALUE_MAP_INTRO_SUBHEADS[0])
  useEffect(() => {
    const i = Math.floor(Math.random() * VALUE_MAP_INTRO_SUBHEADS.length)
    setIntroSubhead(VALUE_MAP_INTRO_SUBHEADS[i])
  }, [])


  // Check-in mode: fetch uncertain transactions on mount (exactly once per mount)
  const checkinLoadedRef = useRef(false)
  useEffect(() => {
    if (mode !== 'checkin') return
    if (checkinLoadedRef.current) return
    checkinLoadedRef.current = true
    const load = async () => {
      try {
        const res = await fetch('/api/value-map/checkin', { cache: 'no-store' })
        if (res.status === 404 || !res.ok) {
          const body = await res.json().catch(() => ({}))
          setCheckinError(body?.reason ?? 'No uncertain transactions to review right now.')
          setStep('checkin_empty')
          return
        }
        const body = await res.json()
        if (!body.transactions || body.transactions.length === 0) {
          setCheckinError('No uncertain transactions to review right now.')
          setStep('checkin_empty')
          return
        }
        setTransactions(body.transactions as ValueMapTransaction[])
        setIsRealData(true)
        setStep('exercise')
        trackEvent('value_checkin_started', { transaction_count: body.transactions.length })
      } catch (err) {
        console.error('[value-map checkin] load error:', err)
        setCheckinError('Could not load your value check-in. Please try again.')
        setStep('checkin_empty')
      }
    }
    load()
    // NOTE: no cancellation flag. The ref guard already prevents the double-fetch
    // that React 18 StrictMode would otherwise cause (mount → unmount → mount).
    // Using a `cancelled` flag alongside the ref guard was a bug: StrictMode's
    // simulated unmount would set cancelled = true, the second mount would bail
    // out of the effect due to the ref, and the in-flight first fetch would then
    // be ignored on resolve — leaving the UI stuck on "Picking the transactions…".
    //
    // trackEvent is a fresh function on every render — intentionally excluded.
    // The ref guard also prevents re-fetching on re-renders caused by state
    // updates like setStep('checkin_saving'), which would otherwise remount
    // ValueMapCard mid-save and cycle through the cards again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Check-in mode: save + navigate back to chat when exercise finishes
  const handleCheckinComplete = useCallback(
    async (exerciseResults: ValueMapResult[]) => {
      setStep('checkin_saving')
      try {
        const actionable = exerciseResults.filter((r) => r.quadrant !== null)
        const res = await fetch('/api/value-map/checkin/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            results: actionable.map((r) => ({
              transaction_id: r.transaction_id,
              quadrant: r.quadrant,
              confidence: r.confidence,
              hard_to_decide: r.hard_to_decide,
            })),
          }),
        })
        const body = await res.json().catch(() => ({}))
        const classified = body?.classified ?? actionable.length
        trackEvent('value_checkin_completed', {
          classified,
          propagated: body?.propagated ?? 0,
        })
        router.push(`/chat?checkin_done=${encodeURIComponent(String(classified))}`)
      } catch (err) {
        console.error('[value-map checkin] save error:', err)
        // Fall back: still navigate home so user isn't stuck
        router.push('/chat')
      }
    },
    [router, trackEvent],
  )

  // Personal mode: fetch CFO-selected low-confidence transactions on mount (once)
  const personalLoadedRef = useRef(false)
  useEffect(() => {
    if (mode !== 'personal') return
    if (personalLoadedRef.current) return
    personalLoadedRef.current = true
    const load = async () => {
      try {
        const res = await fetch('/api/value-map/personal', { cache: 'no-store' })
        if (res.status === 404 || !res.ok) {
          const reasonBody = await res.json().catch(() => ({}))
          const reason = reasonBody?.reason as string | undefined
          setPersonalError(
            reason === 'insufficient_merchants'
              ? "Your categorisation is looking good — I don't have enough uncertain spending to make a retake worthwhile yet."
              : reason === 'no_low_confidence_spend'
                ? 'No uncertain transactions to retake yet.'
                : 'Could not prepare a retake right now.',
          )
          setStep('personal_empty')
          return
        }
        const reasonBody = await res.json()
        const txns = reasonBody.transactions as ValueMapTransaction[] | undefined
        if (!txns || txns.length === 0) {
          setPersonalError('No uncertain transactions to retake right now.')
          setStep('personal_empty')
          return
        }
        setTransactions(txns)
        setIsRealData(true)
        setStep('exercise')
        trackEvent('value_map_personal_started', { transaction_count: txns.length })
      } catch (err) {
        console.error('[value-map personal] load error:', err)
        setPersonalError('Could not load your retake. Please try again.')
        setStep('personal_empty')
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Personal mode: save retake, wait for impact screen
  const handlePersonalComplete = useCallback(
    async (exerciseResults: ValueMapResult[]) => {
      setStep('personal_saving')
      try {
        const actionable = exerciseResults.filter((r) => r.quadrant !== null)
        const personality = calculatePersonality(exerciseResults)
        const dominantQuadrant = (
          Object.entries(personality.breakdown) as [string, { percentage: number }][]
        ).sort((a, b) => b[1].percentage - a[1].percentage)[0][0]

        // Build merchants_by_quadrant lookup
        const merchantsByQuadrant: Record<string, string[]> = {}
        for (const r of exerciseResults) {
          if (r.quadrant) {
            if (!merchantsByQuadrant[r.quadrant]) merchantsByQuadrant[r.quadrant] = []
            if (!merchantsByQuadrant[r.quadrant].includes(r.merchant)) {
              merchantsByQuadrant[r.quadrant].push(r.merchant)
            }
          }
        }

        const res = await fetch('/api/value-map/personal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            results: actionable.map((r) => ({
              transaction_id: r.transaction_id,
              quadrant: r.quadrant,
              confidence: r.confidence,
              first_tap_ms: r.first_tap_ms,
              card_time_ms: r.card_time_ms,
              deliberation_ms: r.deliberation_ms,
              hard_to_decide: r.hard_to_decide,
            })),
            personalityType: personality.personality,
            dominantQuadrant,
            breakdown: personality.breakdown,
            merchantsByQuadrant,
          }),
        })
        const saved = await res.json().catch(() => ({}))
        trackEvent('value_map_personal_completed', {
          classified: saved?.classified ?? actionable.length,
          merchants_affected: saved?.merchants_affected ?? 0,
        })
        if (saved?.retake_id) {
          setRetakeId(saved.retake_id as string)
        }
        setResults(exerciseResults)
        setStep('impact_summary')
      } catch (err) {
        console.error('[value-map personal] save error:', err)
        // Fall back — navigate to chat
        router.push('/chat')
      }
    },
    [router, trackEvent],
  )

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    trackEvent('value_map_started', { mode })
    // Onboarding is the only mode that reaches the intro step; checkin and
    // personal skip it via the initial step state. Value-first onboarding
    // (post-Read opt-in from the hook CTA) passes realTransactions — the
    // exact items the First Read named as "I can see this but can't read
    // it without you." When realTransactions is provided we use those; the
    // legacy onboarding path falls back to SAMPLE_TRANSACTIONS (curated
    // narrative arc — selectTransactions() sorts by amount descending,
    // which would destroy that arc).
    if (realTransactions && realTransactions.length > 0) {
      setTransactions(realTransactions)
      setIsRealData(true)
    } else {
      setTransactions([...SAMPLE_TRANSACTIONS])
      setIsRealData(false)
    }
    setStep('exercise')
  }, [mode, trackEvent, realTransactions])

  const handleExerciseComplete = useCallback(
    (exerciseResults: ValueMapResult[]) => {
      const personality = calculatePersonality(exerciseResults)
      // Funnel events must fire exactly once per session.
      if (!completionTrackedRef.current) {
        completionTrackedRef.current = true
        trackEvent('value_map_completed', {
          mode,
          card_count: exerciseResults.length,
          is_real_data: isRealData,
        })
        trackEvent('value_map_reading_shown', { archetype: personality.personality })
      }
      setResults(exerciseResults)
      setReadyToFinish(true)
    },
    [trackEvent, mode, isRealData],
  )

  const handleSummaryNext = useCallback(() => {
    // Summary is only reached from onboarding — skip cut_or_keep / one_thing
    setReadyToFinish(true)
  }, [])

  const handleCutOrKeepComplete = useCallback((decisions: Array<{ transaction_id: string; cut: boolean }>) => {
    setCutDecisions(decisions)
    setStep('one_thing')
  }, [])

  // Track when flow is ready to finalize (after one_thing step)
  const [readyToFinish, setReadyToFinish] = useState(false)

  const handleOneThingSubmit = useCallback((text: string) => {
    setOneThing(text)
    setReadyToFinish(true)
  }, [])

  const handleContinue = useCallback(async () => {
    // Real-transaction classifications (value-first onboarding) go through the
    // server so they get the SAME learning persistence as the personal retake
    // path: weighted correction_signals, a synchronous merchant rule (Layer 2
    // by_merchant — the recompose reads this), a hard transaction confirm, and
    // async processSignals + backfill. One source of truth for "the user
    // classified these real transactions". The client keeps only the onboarding
    // bookkeeping (session + value_map_results below). Awaited so the rule +
    // confirm have landed before onComplete fires the recompose.
    if (isRealData && results.length > 0) {
      const realClassified = results.filter((r) => r.quadrant !== null)
      if (realClassified.length > 0) {
        try {
          await fetch('/api/value-map/classify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              results: realClassified.map((r) => ({
                transaction_id: r.transaction_id,
                quadrant: r.quadrant,
                confidence: r.confidence,
              })),
            }),
          })
        } catch (err) {
          console.error('[value-map] classify POST failed:', err)
          // Non-fatal — session + value_map_results still persist below; a
          // later check-in / retake can recover the learning pass.
        }
      }
    }

    if (results.length > 0) {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('Not authenticated')

        // Insert CSV/OCR transactions as real transactions (skip hard-to-decide)
        const newTxs = results.filter(
          (r) => r.quadrant !== null && (r.transaction_id.startsWith('csv-') || r.transaction_id.startsWith('ocr-')),
        )

        if (newTxs.length > 0) {
          // Resolve bank account — use first existing or auto-create
          let accountId: string
          const { data: accounts } = await supabase
            .from('bank_accounts')
            .select('id')
            .eq('profile_id', user.id)
            .eq('is_active', true)
            .limit(1)

          if (accounts && accounts.length > 0) {
            accountId = accounts[0].id
          } else {
            const { data: newAccount } = await supabase
              .from('bank_accounts')
              .insert({ profile_id: user.id, name: 'Main Account', institution: null, account_type: 'checking', iban: null, current_balance: 0, currency, is_active: true, last_synced_at: null })
              .select('id')
              .single()
            accountId = newAccount!.id
          }

          // Load merchant mappings + categories for auto-categorisation
          const [{ data: mappingsData }, { data: categoriesData }] = await Promise.all([
            supabase
              .from('merchant_category_map')
              .select('merchant_pattern, category_name, source, profile_id')
              .or(`profile_id.is.null,profile_id.eq.${user.id}`),
            supabase
              .from('categories')
              .select('id, name'),
          ])
          const mappings = (mappingsData ?? []) as MerchantMapping[]
          const categories = categoriesData ?? []

          const txLookup = new Map(transactions.map((t) => [t.id, t]))
          const dbRows = newTxs
            .map((r) => {
              const tx = txLookup.get(r.transaction_id)
              if (!tx) return null

              // Auto-categorise using merchant mappings + keyword heuristics
              const merchantText = tx.merchant || tx.description || ''
              const normalised = normaliseMerchant(merchantText)
              const categoryName = categoriseTransaction(normalised, mappings)
              const category = categoryName !== 'Uncategorised'
                ? categories.find((c) => c.name === categoryName)
                : null

              return {
                profile_id: user.id,
                bank_account_id: accountId,
                merchant: tx.merchant,
                description: tx.description,
                amount: tx.amount,
                currency: tx.currency,
                transaction_date: tx.transaction_date,
                type: 'expense' as const,
                source: r.transaction_id.startsWith('csv-') ? 'csv_import' as const : 'ocr_import' as const,
                is_recurring: false,
                frequency: null,
                next_due_date: null,
                recurrence_end: null,
                external_id: null,
                metadata: { value_quadrant: r.quadrant },
                category_id: category?.id ?? null,
                _normalised: normalised,
              }
            })
            .filter((r): r is NonNullable<typeof r> => r !== null)

          // AI categorisation for any still uncategorised
          const uncategorised = dbRows.filter((r) => !r.category_id)
          if (uncategorised.length > 0) {
            const uniqueMerchants = new Map<string, { text: string; amount: number; type: string }>()
            for (const row of uncategorised) {
              if (!uniqueMerchants.has(row._normalised)) {
                uniqueMerchants.set(row._normalised, { text: row._normalised, amount: row.amount, type: 'expense' })
              }
            }
            const aiResults = await aiCategoriseBatch(
              Array.from(uniqueMerchants.values()),
              categories.map((c) => c.name),
            )
            for (const row of uncategorised) {
              const aiResult = aiResults.get(row._normalised)
              if (aiResult) {
                const cat = categories.find((c) => c.name === aiResult.categoryName)
                if (cat) row.category_id = cat.id
              }
            }
          }

          if (dbRows.length > 0) {
            // Strip internal _normalised field before insert
            const insertRows = dbRows.map(({ _normalised, ...rest }) => rest)
            await supabase.from('transactions').insert(insertRows)
          }
        }

        // Update metadata on existing DB transactions (skip hard-to-decide).
        // Real-data classifications are confirmed server-side (/classify sets
        // value_category + value_confirmed_by_user, the load-bearing fields);
        // this write-only metadata flag is the legacy sample/CSV path only.
        if (!isRealData) {
          const existingUpdates = results.filter(
            (r) => r.quadrant !== null && !r.transaction_id.startsWith('csv-') && !r.transaction_id.startsWith('ocr-') && !r.transaction_id.startsWith('sample-'),
          )
          for (const update of existingUpdates) {
            await supabase
              .from('transactions')
              .update({ metadata: { value_quadrant: update.quadrant } })
              .eq('id', update.transaction_id)
          }
        }
      } catch (err) {
        console.error('Failed to persist value map results:', err)
        // Continue anyway — don't block the user
      }
    }

    // Calculate personality early — needed for session record and onboarding endpoint
    const personality = calculatePersonality(results)
    const dominantQuadrant = (Object.entries(personality.breakdown) as [string, { percentage: number }][])
      .sort((a, b) => b[1].percentage - a[1].percentage)[0][0]

    // Persist per-card results with timing data to value_map_results
    try {
      const supabase2 = createClient()
      const { data: { user: currentUser } } = await supabase2.auth.getUser()
      if (currentUser && results.length > 0) {
        // Count existing sessions to determine session_number
        const { count: existingSessions } = await supabase2
          .from('value_map_sessions')
          .select('*', { count: 'exact', head: true })
          .eq('profile_id', currentUser.id)

        // Build merchants_by_quadrant lookup
        const merchantsByQuadrant: Record<string, string[]> = {}
        for (const r of results) {
          if (r.quadrant) {
            if (!merchantsByQuadrant[r.quadrant]) merchantsByQuadrant[r.quadrant] = []
            if (!merchantsByQuadrant[r.quadrant].includes(r.merchant)) {
              merchantsByQuadrant[r.quadrant].push(r.merchant)
            }
          }
        }

        // Create session record
        const { data: session } = await supabase2
          .from('value_map_sessions')
          .insert({
            profile_id: currentUser.id,
            session_number: (existingSessions ?? 0) + 1,
            personality_type: personality.personality,
            dominant_quadrant: dominantQuadrant,
            breakdown: personality.breakdown,
            transaction_count: results.length,
            is_real_data: isRealData,
            merchants_by_quadrant: merchantsByQuadrant,
          })
          .select('id')
          .single()

        const sessionId = session?.id ?? null

        const resultRows = results.map((r) => ({
          profile_id: currentUser.id,
          transaction_id: r.transaction_id,
          quadrant: r.quadrant,
          merchant: r.merchant,
          amount: r.amount,
          confidence: r.confidence,
          hard_to_decide: r.hard_to_decide ?? false,
          first_tap_ms: r.first_tap_ms,
          card_time_ms: r.card_time_ms,
          deliberation_ms: r.deliberation_ms,
          cut_intent: null,
          session_id: sessionId,
        }))
        await supabase2.from('value_map_results').insert(resultRows)

        // Seed value_category_rules from the quadrant assignments.
        //
        // SAMPLE-card onboarding only. Real-transaction classifications
        // (value-first onboarding, isRealData) are persisted server-side by
        // /api/value-map/classify — which writes the merchant rule with the
        // canonical normalised key, plus correction_signals + confirm +
        // learning. Doing it here too would mint a duplicate rule under a
        // different match_value (r.merchant.toLowerCase() vs normaliseMerchant)
        // and re-introduce the drift this consolidation removes.
        //
        // Sample cards carry sample labels, not real merchants. Only
        // category-precise cards (granularity: 'category') seed — as
        // match_type: 'category' against the DB slug. Intent cards (e.g.
        // takeaway / dinner-friends inside eat_drinking_out) don't seed; their
        // quadrant doesn't generalise. Rows with quadrant === null ("Unsure")
        // don't seed. onConflict matches the canonical 4-col unique index
        // (vcr_unique_match).
        const cardLookup = new Map(SAMPLE_TRANSACTIONS.map((c) => [c.id, c]))

        const decidedForRules = isRealData
          ? []
          : results.filter(
              (r): r is ValueMapResult & { quadrant: NonNullable<ValueMapResult['quadrant']> } =>
                r.quadrant !== null,
            )

        type VcrInsert = {
          user_id: string
          match_type: 'category'
          match_value: string
          value_category: NonNullable<ValueMapResult['quadrant']>
          confidence: number
          source: string
          last_signal_at: string
          updated_at: string
        }

        if (decidedForRules.length > 0) {
          const rules: VcrInsert[] = decidedForRules.flatMap((r): VcrInsert[] => {
            const card = cardLookup.get(r.transaction_id)

            // Sample card path (onboarding): only category-precise cards seed.
            if (card && card.granularity === 'category') {
              return [{
                user_id: currentUser.id,
                match_type: 'category',
                match_value: card.category_id!,
                value_category: r.quadrant,
                // VM-3: shared conviction→confidence map (legacy /5 retired)
                confidence: cardConvictionToRuleConfidence(r.confidence),
                source: 'value_map',
                last_signal_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }]
            }

            // Non-category sample cards and any stray real cards don't seed here.
            // Real-transaction merchant rules are owned by the server path
            // (/api/value-map/classify -> persistRealValueClassifications).
            // VM-3 originally seeded them from the browser here too; that is the
            // exact dual-write the 2026-06-16 "one persistence path" session
            // removed (client upsert had no correction_signals, no learning
            // pipeline, no hard confirm, and keyed the merchant differently).
            return []
          })

          if (rules.length > 0) {
            const { error: rulesError } = await supabase2
              .from('value_category_rules')
              .upsert(rules, {
                onConflict: VCR_ON_CONFLICT,
              })
            if (rulesError) {
              console.error('[value-map] value_category_rules upsert error:', rulesError)
            }
          }

          // Back-propagate the user's call onto the transactions themselves.
          // The rule above teaches the predictor for FUTURE imports; without
          // this the existing transaction keeps its category-default value
          // (often 'leak'), so the classification never reaches the
          // category-level value profile the first Read reads. Real-transaction
          // cards only — sample onboarding cards have synthetic ids with no
          // transaction row. Mirrors api/value-map/personal/route.ts.
          const txnConfirms = decidedForRules.filter((r) => !cardLookup.has(r.transaction_id))
          if (txnConfirms.length > 0) {
            const confirmedAt = new Date().toISOString()
            const confirmResults = await Promise.all(
              txnConfirms.map((r) =>
                supabase2
                  .from('transactions')
                  .update({
                    value_category: r.quadrant,
                    value_confidence: 1.0,
                    value_confirmed_by_user: true,
                    prediction_source: 'user_confirmed',
                    confirmed_at: confirmedAt,
                  })
                  .eq('id', r.transaction_id)
                  .eq('user_id', currentUser.id),
              ),
            )
            const failed = confirmResults.find((res) => res.error)
            if (failed?.error) {
              console.error('[value-map] transaction confirm error:', failed.error)
            }
          }
        }

        // Persist cut_intent decisions from cut-or-keep exercise
        if (cutDecisions.length > 0) {
          for (const decision of cutDecisions) {
            await supabase2
              .from('value_map_results')
              .update({ cut_intent: decision.cut })
              .eq('profile_id', currentUser.id)
              .eq('transaction_id', decision.transaction_id)
          }
        }
      }
    } catch (err) {
      console.error('Failed to persist value map results:', err)
    }

    // Store personality in sessionStorage for chat to reference
    sessionStorage.setItem('valueMapPersonality', personality.personality)
    sessionStorage.setItem('valueMapCompleted', 'true')

    if (onComplete && mode === 'onboarding') {
      onComplete(personality.personality, dominantQuadrant, personality.breakdown, results)
    } else {
      router.push('/chat?type=onboarding')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRealData, results, router, cutDecisions, mode, onComplete])

  // Trigger final persistence when one_thing step completes
  useEffect(() => {
    if (readyToFinish) {
      handleContinue()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyToFinish])

  // ── Render by step ─────────────────────────────────────────────────────────

  if (step === 'intro') {
    return (
      <div className="flex flex-col px-6 pt-10 pb-12 gap-8 overflow-y-auto">
        {/* Hero */}
        <div className="flex flex-col items-center text-center gap-6">
          <CFOAvatar size={48} />
          <div className="space-y-3 max-w-sm">
            <h1 className="text-[28px] leading-[1.15] text-text-primary">
              {VALUE_MAP_INTRO_HERO}
            </h1>
            <p className="text-sm text-text-secondary leading-relaxed">
              {introSubhead}
            </p>
          </div>
        </div>

        {/* What the Value Map is — frames the unique way of thinking about
            spending and the no-sacrifice optimisation before the bucket list. */}
        <div className="space-y-3">
          <p className="text-caption font-medium uppercase tracking-wide text-text-muted">The idea</p>
          {VALUE_MAP_INTRO_EXPLAINER.map((bullet) => (
            <div
              key={bullet.title}
              className="rounded-card border border-[var(--border-subtle)] bg-bg-elevated px-4 py-3"
            >
              <h3 className="text-[17px] leading-[1.25] text-text-primary">
                {bullet.title}
              </h3>
              <p className="mt-1 text-[13.5px] leading-[1.5] text-text-secondary">
                {bullet.body}
              </p>
            </div>
          ))}
        </div>

        {/* Category overview — four quadrants plus the Unsure escape hatch */}
        <div className="space-y-3">
          <p className="text-caption font-medium uppercase tracking-wide text-text-muted">The buckets</p>
          <p className="text-[13px] leading-[1.5] text-text-secondary">
            You&apos;ll sort a handful of transactions into one of these. Trust
            your gut — we can refine later.
          </p>
          <div className="grid grid-cols-1 gap-2">
            {QUADRANT_ORDER.map((qId) => {
              const q = QUADRANTS[qId]
              return (
                <div
                  key={q.id}
                  className="rounded-card border border-[var(--border-subtle)] bg-bg-elevated px-4 py-3 flex items-start gap-3"
                >
                  <span
                    className="text-2xl leading-none shrink-0"
                    aria-hidden="true"
                  >
                    {q.emoji}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <h3
                        className="text-[17px] leading-[1.2]"
                        style={{ color: q.colour }}
                      >
                        {q.name}
                      </h3>
                      <span className="italic text-[13px] text-text-secondary">
                        &ldquo;{q.tagline}&rdquo;
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] leading-[1.45] text-text-secondary">
                      {q.description}
                    </p>
                  </div>
                </div>
              )
            })}

            {/* Fifth option — Unsure. Same card layout as the buckets above
                but de-emphasised: muted heading (no brand colour), dashed
                border to signal it's the escape hatch rather than a real
                quadrant. */}
            <div className="rounded-card border border-dashed border-[var(--border-subtle)] bg-bg-elevated px-4 py-3 flex items-start gap-3">
              <span
                className="text-2xl leading-none shrink-0"
                aria-hidden="true"
              >
                {VALUE_MAP_INTRO_UNSURE_BUCKET.emoji}
              </span>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="text-[17px] leading-[1.2] text-text-secondary">
                    {VALUE_MAP_INTRO_UNSURE_BUCKET.name}
                  </h3>
                  <span className="italic text-[13px] text-text-secondary">
                    &ldquo;{VALUE_MAP_INTRO_UNSURE_BUCKET.tagline}&rdquo;
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-[1.45] text-text-secondary">
                  {VALUE_MAP_INTRO_UNSURE_BUCKET.description}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* How the exercise works — sets expectations about samples seeding a
            baseline + the Unsure escape hatch. Skipped in the value-first
            journey: those cards are the user's own real transactions, so the
            "you'll start with samples" framing would be false. */}
        {!hasRealTransactions && (
          <div className="space-y-3">
            <p className="text-caption font-medium uppercase tracking-wide text-text-muted">How it works</p>
            {VALUE_MAP_INTRO_HOW.map((bullet) => (
              <div
                key={bullet.title}
                className="rounded-card border border-[var(--border-subtle)] bg-bg-elevated px-4 py-3"
              >
                <h3 className="text-[17px] leading-[1.25] text-text-primary">
                  {bullet.title}
                </h3>
                <p className="mt-1 text-[13.5px] leading-[1.5] text-text-secondary">
                  {bullet.body}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="flex justify-center pt-2">
          <Button
            onClick={handleStart}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-8 py-5 text-base"
          >
            Let&apos;s start
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'exercise') {
    return (
      <div className="flex flex-col h-full">
        {mode === 'checkin' && (
          <div className="px-6 pt-6 pb-2 text-center">
            <h2 className="text-base font-semibold text-text-primary">Value check-in</h2>
            <p className="text-xs text-text-secondary mt-1">
              {transactions.length} transactions I&apos;m not sure about
            </p>
          </div>
        )}
        {mode === 'personal' && (
          <div className="px-6 pt-6 pb-2 text-center">
            <h2 className="text-base font-semibold text-text-primary">Your retake</h2>
            <p className="text-xs text-text-secondary mt-1">
              {transactions.length} transactions I want to learn about
            </p>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <ValueMapCard
            transactions={transactions}
            currency={currency}
            onComplete={
              mode === 'checkin'
                ? handleCheckinComplete
                : mode === 'personal'
                  ? handlePersonalComplete
                  : handleExerciseComplete
            }
            onTransactionResult={mode === 'onboarding' ? onTransactionResult : undefined}
          />
        </div>
        {(mode === 'checkin' || mode === 'personal') && (
          <div className="flex justify-center pb-6 pt-2">
            <button
              onClick={() => router.push('/chat')}
              className="text-sm text-text-secondary underline min-h-[44px] px-4"
            >
              Done for now
            </button>
          </div>
        )}
      </div>
    )
  }

  if (step === 'checkin_loading') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <CfoThinking
          variant="block"
          labels={[
            'Picking the transactions I\u2019m least sure about\u2026',
            'Pulling the ones worth a second look\u2026',
          ]}
        />
      </div>
    )
  }

  if (step === 'checkin_empty') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 gap-6 text-center">
        <CFOAvatar size={48} />
        <div className="space-y-2 max-w-sm">
          <h1 className="text-xl font-semibold text-text-primary">Nothing to check in on</h1>
          <p className="text-sm text-text-secondary leading-relaxed">
            {checkinError ?? "You've already told me how you feel about most of your spending. Upload more transactions and come back."}
          </p>
        </div>
        <Button
          onClick={() => router.push('/chat')}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-8 py-5 text-base"
        >
          Back to chat
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    )
  }

  if (step === 'checkin_saving') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <CfoThinking
          variant="block"
          labels={[
            'Learning from your answers\u2026',
            'Updating what I know about you\u2026',
          ]}
        />
      </div>
    )
  }

  if (step === 'summary') {
    // Summary step is only reached from onboarding
    return (
      <ValueMapSummary
        results={results}
        transactions={transactions}
        currency={currency}
        isRealData={isRealData}
        onContinue={handleSummaryNext}
        mode="onboarding"
      />
    )
  }

  if (step === 'cut_or_keep') {
    return (
      <CutOrKeep
        results={results}
        currency={currency}
        onComplete={handleCutOrKeepComplete}
      />
    )
  }

  if (step === 'one_thing') {
    return (
      <OneThing
        onSubmit={handleOneThingSubmit}
        onSkip={() => handleOneThingSubmit('')}
      />
    )
  }

  if (step === 'personal_loading') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <CfoThinking
          variant="block"
          labels={[
            'Pulling the transactions I\u2019m least sure about\u2026',
            'Gathering a fresh set for you\u2026',
          ]}
        />
      </div>
    )
  }

  if (step === 'personal_empty') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 gap-6 text-center">
        <CFOAvatar size={48} />
        <div className="space-y-2 max-w-sm">
          <h1 className="text-xl font-semibold text-text-primary">Nothing to retake yet</h1>
          <p className="text-sm text-text-secondary leading-relaxed">
            {personalError ??
              "Your categorisation is looking good. I'll let you know when I could use your help."}
          </p>
        </div>
        <Button
          onClick={() => router.push('/chat')}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-8 py-5 text-base"
        >
          Back to chat
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    )
  }

  if (step === 'personal_saving') {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <CfoThinking
          variant="block"
          labels={[
            'Learning from your answers\u2026',
            'Rebuilding your reading\u2026',
          ]}
        />
      </div>
    )
  }

  if (step === 'impact_summary') {
    return (
      <RetakeImpact
        retakeId={retakeId}
        onContinue={() => {
          const n = results.filter((r) => r.quadrant !== null).length
          if (returnTo === 'archetype') {
            router.push(`/office/values/archetype?retake_done=${encodeURIComponent(String(n))}`)
          } else {
            router.push(`/chat?retake_done=${encodeURIComponent(String(n))}`)
          }
        }}
      />
    )
  }

  return null
}
