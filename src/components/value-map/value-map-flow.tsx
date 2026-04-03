'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CfoAvatar } from '@/components/chat/cfo-avatar'
import { ValueMapUpload } from './value-map-upload'
import { ValueMapCard } from './value-map-card'
import { ValueMapSummary } from './value-map-summary'
import { AnchoringQuestion } from './anchoring-question'
import { CutOrKeep } from './cut-or-keep'
import { OneThing } from './one-thing'
import { calculatePersonality } from '@/lib/value-map/personalities'
import { generateObservations } from '@/lib/value-map/observations'
import type { ValueMapTransaction, ValueMapResult } from '@/lib/value-map/types'
import { createClient } from '@/lib/supabase/client'
import { categoriseTransaction, type MerchantMapping } from '@/lib/categorisation/categorise-transaction'
import { normaliseMerchant } from '@/lib/categorisation/normalise-merchant'
import { aiCategoriseBatch } from '@/lib/categorisation/ai-categorise'

// ── Types ────────────────────────────────────────────────────────────────────

type FlowStep = 'intro' | 'anchoring' | 'upload' | 'exercise' | 'summary' | 'cut_or_keep' | 'one_thing'

interface ValueMapFlowProps {
  currency: string
  existingTransactions?: ValueMapTransaction[]
  mode?: 'onboarding' | 'retake'
}

// ── Component ────────────────────────────────────────────────────────────────

export function ValueMapFlow({ currency, existingTransactions, mode = 'onboarding' }: ValueMapFlowProps) {
  const router = useRouter()
  const [step, setStep] = useState<FlowStep>('intro')
  const [transactions, setTransactions] = useState<ValueMapTransaction[]>([])
  const [results, setResults] = useState<ValueMapResult[]>([])
  const [isRealData, setIsRealData] = useState(false)

  // New micro-interaction state
  const [anchoredGuess, setAnchoredGuess] = useState<number | null>(null)
  const [anchoredCategory, setAnchoredCategory] = useState('all')
  const [anchoredCategoryLabel, setAnchoredCategoryLabel] = useState('in total')
  const [cutDecisions, setCutDecisions] = useState<Array<{ transaction_id: string; cut: boolean }>>([])
  const [oneThing, setOneThing] = useState('')

  // Previous intelligence snapshot for retake comparison (fetched before overwriting)
  const [previousIntelligence, setPreviousIntelligence] = useState<{
    personality_type: string
    dominant_quadrant: string
    breakdown: Record<string, { percentage: number; count: number; total: number }>
    completedAt: string | null
  } | null>(null)

  // Read focus category from sessionStorage (set by onboarding-chat)
  useEffect(() => {
    const focus = sessionStorage.getItem('onboardingFocus')
    const focusLabel = sessionStorage.getItem('onboardingFocusLabel')
    if (focus) setAnchoredCategory(focus)
    if (focusLabel) setAnchoredCategoryLabel(focusLabel)
  }, [])

  // In retake mode, capture current user_intelligence before the exercise overwrites it
  useEffect(() => {
    if (mode !== 'retake') return
    const fetchPrevious = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const { data } = await supabase
          .from('user_intelligence')
          .select('personality_type, dominant_quadrant, value_map_insights')
          .eq('profile_id', user.id)
          .maybeSingle()
        if (data?.personality_type && data.value_map_insights) {
          const insights = data.value_map_insights as Record<string, unknown>
          setPreviousIntelligence({
            personality_type: data.personality_type,
            dominant_quadrant: data.dominant_quadrant ?? '',
            breakdown: (insights.breakdown as Record<string, { percentage: number; count: number; total: number }>) ?? {},
            completedAt: (insights.completedAt as string) ?? null,
          })
        }
      } catch {
        // Non-blocking
      }
    }
    fetchPrevious()
  }, [mode])

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleStart = useCallback(() => {
    if (mode === 'retake') {
      if (existingTransactions && existingTransactions.length >= 5) {
        setTransactions(existingTransactions)
        setIsRealData(true)
        setStep('exercise')
      } else {
        setStep('upload')
      }
    } else {
      setStep('anchoring')
    }
  }, [mode, existingTransactions])

  const handleAnchoringSubmit = useCallback((guess: number) => {
    setAnchoredGuess(guess)
    if (existingTransactions && existingTransactions.length >= 5) {
      setTransactions(existingTransactions)
      setIsRealData(true)
      setStep('exercise')
    } else {
      setStep('upload')
    }
  }, [existingTransactions])

  const handleTransactionsReady = useCallback(
    (txs: ValueMapTransaction[], real: boolean) => {
      setTransactions(txs)
      setIsRealData(real)
      setStep('exercise')
    },
    [],
  )

  const handleExerciseComplete = useCallback(
    (exerciseResults: ValueMapResult[]) => {
      setResults(exerciseResults)
      setStep('summary')
    },
    [],
  )

  const handleSummaryNext = useCallback(() => {
    setStep('cut_or_keep')
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

        // Update metadata on existing DB transactions (skip hard-to-decide)
        const existingUpdates = results.filter(
          (r) => r.quadrant !== null && !r.transaction_id.startsWith('csv-') && !r.transaction_id.startsWith('ocr-') && !r.transaction_id.startsWith('sample-'),
        )
        for (const update of existingUpdates) {
          await supabase
            .from('transactions')
            .update({ metadata: { value_quadrant: update.quadrant } })
            .eq('id', update.transaction_id)
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

    if (mode === 'retake') {
      // Retake: update user_intelligence with new personality
      try {
        const valueMapInsights = {
          breakdown: personality.breakdown,
          isRealData,
          observations: generateObservations(results, transactions).map((o) => ({
            rule: o.rule,
            text: o.text,
            merchants: o.merchants,
          })),
          completedAt: new Date().toISOString(),
        }
        await fetch('/api/value-map/retake-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personalityType: personality.personality,
            dominantQuadrant,
            valueMapInsights,
          }),
        })

        // Build comparison prefill using previous intelligence snapshot
        const fmt = (b: Record<string, { percentage: number }>) =>
          `Foundation ${b.foundation?.percentage ?? 0}%, Investment ${b.investment?.percentage ?? 0}%, Burden ${b.burden?.percentage ?? 0}%, Leak ${b.leak?.percentage ?? 0}%`

        const newLine = `New result: ${personality.personality.replace(/_/g, ' ')} — ${fmt(personality.breakdown)}`

        if (previousIntelligence) {
          const prevDate = previousIntelligence.completedAt
            ? new Date(previousIntelligence.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
            : 'previous session'
          const prevLine = `Previous (${prevDate}): ${previousIntelligence.personality_type.replace(/_/g, ' ')} — ${fmt(previousIntelligence.breakdown)}`

          sessionStorage.setItem('cfoPrefill',
            `I just retook my Value Map.\n\n${prevLine}\n${newLine}\n\nWhat does this shift tell you? How have my spending patterns changed and what should I focus on?`)
        } else {
          sessionStorage.setItem('cfoPrefill',
            `I just completed my Value Map.\n\n${newLine}\n\nWhat do these results mean and what should I focus on?`)
        }
      } catch (err) {
        console.error('Failed to complete retake:', err)
      }
    } else {
      sessionStorage.setItem('bridgePending', 'true')

      // Mark onboarding complete — send personality + micro-interaction data
      try {
        const res = await fetch('/api/onboarding-chat/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            painPoint: 'value_map',
            personalityType: personality.personality,
            dominantQuadrant,
            valueMapInsights: {
              breakdown: personality.breakdown,
              isRealData,
              observations: generateObservations(results, transactions).map((o) => ({
                rule: o.rule,
                text: o.text,
                merchants: o.merchants,
              })),
              completedAt: new Date().toISOString(),
            },
            anchoredGuess,
            anchoredCategory,
            oneThing: oneThing || undefined,
          }),
        })
        if (!res.ok) {
          console.error('Failed to complete onboarding:', await res.text())
        }
      } catch (err) {
        console.error('Failed to complete onboarding:', err)
      }
    }

    router.push('/chat')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRealData, results, router, anchoredGuess, anchoredCategory, cutDecisions, oneThing, mode, previousIntelligence])

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
      <div className="flex flex-col items-center justify-center h-full px-6 gap-6 text-center">
        <CfoAvatar size="lg" />
        <div className="space-y-2 max-w-sm">
          <h1 className="text-xl font-semibold text-foreground">
            Your Value Map
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            In 90 seconds, you&apos;ll see what your money is actually doing for you.
            No other app does this.
          </p>
        </div>
        <Button
          onClick={handleStart}
          className="bg-[#E8A84C] hover:bg-[#d4963f] text-black font-semibold px-8 py-5 text-base"
        >
          Let&apos;s go
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    )
  }

  if (step === 'anchoring') {
    return (
      <AnchoringQuestion
        category={anchoredCategory}
        categoryLabel={anchoredCategoryLabel}
        currency={currency}
        onSubmit={handleAnchoringSubmit}
      />
    )
  }

  if (step === 'upload') {
    return (
      <ValueMapUpload
        currency={currency}
        onTransactionsReady={handleTransactionsReady}
      />
    )
  }

  if (step === 'exercise') {
    return (
      <ValueMapCard
        transactions={transactions}
        currency={currency}
        onComplete={handleExerciseComplete}
      />
    )
  }

  if (step === 'summary') {
    return (
      <ValueMapSummary
        results={results}
        transactions={transactions}
        currency={currency}
        isRealData={isRealData}
        onContinue={handleSummaryNext}
        mode={mode}
        previousIntelligence={previousIntelligence}
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

  return null
}
